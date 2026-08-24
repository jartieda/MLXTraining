-- ============================================================================
-- T030, T030b, T030c — the privileged surface
--
-- These functions are the ENTIRE privileged surface of the system. Principle II
-- forbids a project-operated server, so provisioning privilege lives here,
-- inside the database the BaaS already runs, rather than in an Edge Function
-- holding a service_role key (R15).
--
-- That makes every one of them a security boundary, so G5 applies with full
-- force:
--
--   * every function sets `search_path = public, pg_temp` explicitly — omitting
--     it is a privilege-escalation vector;
--   * every function re-derives its caller from auth.uid() and NEVER trusts an
--     argument that names the caller;
--   * every function validates its own arguments and assumes the client hostile.
--
-- The three irreversible actions — delete_learner, deactivate_educator,
-- reassign_classroom — each append their audit_log row in the SAME TRANSACTION
-- as their effect (T030c, FR-058). Writing it afterwards would let the deletion
-- succeed while the record is lost, which is the one failure the log exists to
-- rule out. Because a function body is one transaction, that is automatic here
-- as long as the insert stays inside the function, which is why none of them
-- delegates its logging to a trigger or a caller.
-- ============================================================================

-- ─────────────────────────────────────────────────── invitation code mechanics

-- T030b / FR-028 / I6: 6 characters over a 32-symbol alphabet with the visually
-- ambiguous characters removed — no O or 0, no I, 1 or l. A learner types this
-- off a whiteboard or a slip of paper, and "was that a one or an ell?" is a
-- support call that costs an educator more than the two bits of entropy saved.
--
-- 32 symbols ^ 6 = 2^30, about a billion. That is small, and the redemption rate
-- limit below is therefore the primary defence rather than a secondary one (I5).
create or replace function public.invitation_alphabet()
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- 24 letters (A-Z without I and O) + 8 digits (2-9) = exactly 32 symbols.
  -- Uppercase L is kept and is unambiguous precisely because 1 is gone; the
  -- lowercase l that FR-028 also excludes cannot occur in an uppercase alphabet.
  select 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$$;

comment on function public.invitation_alphabet() is
  'FR-028 / I6: exactly 32 unambiguous symbols. Excludes O, 0, I and 1.';

create or replace function public.generate_invitation_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  alphabet text := public.invitation_alphabet();
  size integer := char_length(alphabet);
  code text := '';
  i integer;
begin
  for i in 1..6 loop
    -- gen_random_bytes, not random(): random() is a seeded PRNG whose sequence is
    -- predictable from previous outputs, and this value is a bearer credential
    -- for creating an account inside a named classroom.
    code := code || substr(
      alphabet,
      1 + (get_byte(extensions.gen_random_bytes(1), 0) % size),
      1
    );
  end loop;
  return code;
end;
$$;

-- SHA-256 with a database-held pepper, not bcrypt.
--
-- Redemption must find an invitation BY ITS CODE in one index lookup, because
-- the RPC signature in contracts/database.md takes no target — a per-row salt
-- would force a verify-every-live-invitation scan. A bare digest of a 30-bit
-- code is trivially reversible, so the pepper is what makes the stored hash
-- useless to anyone who obtains the table. It lives in `code_pepper`, which has
-- RLS on and no policy, so nothing outside a definer function can read it.
create or replace function public.hash_invitation_code(code text)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select encode(
    extensions.digest(upper(trim(code)) || (select pepper from public.code_pepper limit 1), 'sha256'),
    'hex'
  )
$$;

-- ─────────────────────────────────────────────────── caller identity helpers

-- SECURITY DEFINER is REQUIRED on every helper that reads `profiles`, because
-- these are called FROM policies on `profiles`, and a policy that selects from
-- the table it protects recurses and fails at runtime (R9). This is the standard
-- remedy and the reason it appears here rather than as an inline subquery.

create or replace function public.current_account_role()
returns public.account_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_account_role() = 'administrator', false)
$$;

create or replace function public.is_educator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_account_role() = 'educator', false)
$$;

-- True when the caller is the educator of a classroom that `learner` is enrolled
-- in. The single most-used authorisation predicate in the schema (E3, J2, L2).
create or replace function public.is_educator_of(learner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.enrolments e
    join public.classrooms c on c.id = e.classroom_id
    where e.learner_id = is_educator_of.learner_id
      and c.educator_id = auth.uid()
  )
$$;

comment on function public.is_educator_of(uuid) is
  'R9: SECURITY DEFINER is required. A policy on enrolments that selects from enrolments recurses.';

-- The classroom the caller is enrolled in, for a learner reading her classmates'
-- aliases (P2). Definer for the same non-recursion reason.
create or replace function public.my_classroom_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select classroom_id from public.enrolments where learner_id = auth.uid()
$$;

-- ─────────────────────────────────────────────────── issuing invitations

-- Caller must own the classroom. Fails if the username already exists, which is
-- the check that keeps `username` unambiguous system-wide before an invitation
-- is even handed over (Edge Cases, FR-051).
--
-- Returns the plaintext code EXACTLY ONCE. It is never stored and never
-- selectable thereafter (I2), so an educator who loses it issues a new one.
create or replace function public.issue_learner_invitation(classroom uuid, username text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  clean_username text := trim(username);
  code text;
  ttl_hours integer := 72;
begin
  if caller is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  -- Ownership is re-derived, never taken from an argument (G5).
  if not exists (
    select 1 from public.classrooms
    where id = classroom and educator_id = caller and archived_at is null
  ) then
    raise exception 'You do not own an active classroom with that id.' using errcode = '42501';
  end if;

  if char_length(clean_username) < 3 or char_length(clean_username) > 24 then
    raise exception 'A username must be between 3 and 24 characters.' using errcode = '22023';
  end if;

  if clean_username !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'A username may contain only letters, digits, dots, hyphens and underscores.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles where lower(profiles.username) = lower(clean_username)) then
    raise exception 'That username is already taken. Choose another.' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.invitations
    where kind = 'learner'
      and lower(target) = lower(clean_username)
      and redeemed_at is null
      and revoked_at is null
      and expires_at > now()
  ) then
    raise exception 'An unredeemed invitation for that username already exists. Revoke it first.'
      using errcode = '23505';
  end if;

  code := public.generate_invitation_code();

  insert into public.invitations
    (issuer_id, kind, purpose, target, classroom_id, code_hash, expires_at)
  values
    (caller, 'learner', 'initial', clean_username, classroom,
     public.hash_invitation_code(code), now() + make_interval(hours => ttl_hours));

  return code;
end;
$$;

-- Caller must be an administrator. `email` is an ADULT educator's address, which
-- is the one contact detail this system ever holds — G3 forbids a learner's, and
-- the schema test asserts that this column cannot be mistaken for one.
--
-- The application itself sends no email. The administrator hands the code over
-- herself (T131), which is why there is no mail configuration anywhere.
create or replace function public.issue_educator_invitation(email text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  clean_email text := lower(trim(email));
  code text;
begin
  if not public.is_administrator() then
    raise exception 'Only an administrator may invite an educator.' using errcode = '42501';
  end if;

  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;

  code := public.generate_invitation_code();

  insert into public.invitations
    (issuer_id, kind, purpose, target, classroom_id, code_hash, expires_at)
  values
    (caller, 'educator', 'initial', clean_email, null,
     public.hash_invitation_code(code), now() + make_interval(hours => 72));

  return code;
end;
$$;

-- Caller must be the educator of `learner`. Issues a purpose='password_reset'
-- invitation against an account that already exists (FR-030).
--
-- This exists because a learner has no email address, so there is no self-service
-- recovery and no address to send a reset to (R16). That is a real cost, paid
-- deliberately: the alternative is holding a contact detail for a minor.
create or replace function public.issue_password_reset(learner uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  target_username text;
  target_classroom uuid;
  code text;
begin
  if not public.is_educator_of(learner) then
    raise exception 'That learner is not in a classroom you own.' using errcode = '42501';
  end if;

  select p.username, e.classroom_id
  into target_username, target_classroom
  from public.profiles p
  join public.enrolments e on e.learner_id = p.id
  where p.id = learner;

  if target_username is null then
    raise exception 'No such learner.' using errcode = '42501';
  end if;

  code := public.generate_invitation_code();

  insert into public.invitations
    (issuer_id, kind, purpose, target, classroom_id, code_hash, expires_at)
  values
    (caller, 'learner', 'password_reset', target_username, target_classroom,
     public.hash_invitation_code(code), now() + make_interval(hours => 72));

  return code;
end;
$$;

-- ─────────────────────────────────────────────────── redemption

-- The origin a redemption attempt came from, for the I5 rate limit.
--
-- Postgres cannot see an HTTP origin directly, but PostgREST publishes the
-- request headers, and Supabase's edge sets x-forwarded-for. Falling back to the
-- connection address and then to a single shared bucket means an unresolvable
-- origin fails CLOSED — attempts share one limit — rather than open.
create or replace function public.redemption_origin()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  headers text := current_setting('request.headers', true);
  forwarded text;
begin
  if headers is not null and headers <> '' then
    forwarded := (headers::jsonb) ->> 'x-forwarded-for';
    if forwarded is not null and forwarded <> '' then
      -- The first entry is the client; the rest are proxies.
      return split_part(forwarded, ',', 1);
    end if;
  end if;

  if inet_client_addr() is not null then
    return host(inet_client_addr());
  end if;

  return 'unresolved';
end;
$$;

-- The ONLY writer of `profiles` (G6). Validates the code, creates the account
-- with the caller-supplied password, sets the alias, and enrols into
-- invitations.classroom_id.
--
-- Callable with NO SESSION, because the account being created does not exist yet
-- (I5). It is therefore the single most exposed function in the system, and the
-- rate limit below is what stands between a 30-bit code and a stranger occupying
-- a classroom.
--
-- The three terminal states each produce a DISTINCT refusal (FR-028), because a
-- learner needs to know whether to wait or to ask for a new code. What the
-- refusals must NOT reveal is whether the target username exists: a wrong code
-- against a real invitation and a code matching nothing return byte-identical
-- messages (I5, SC-020).
create or replace function public.redeem_invitation(code text, password text, alias text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  origin text := public.redemption_origin();
  recent_failures integer;
  invitation public.invitations;
  clean_alias text := trim(alias);
  new_user_id uuid;
  new_username text;
  auth_identifier text;
  -- One constant, used for both "no such code" and "wrong code against a real
  -- invitation". Two separately written messages drift apart on the first edit,
  -- and the difference is exactly what an enumeration attack reads.
  indistinguishable_refusal constant text :=
    'That code is not valid. Check it with whoever gave it to you.';
begin
  -- ── Rate limit first, before any lookup. Checking the code first would make
  --    the timing of the refusal reveal whether the code existed.
  select count(*) into recent_failures
  from public.redemption_attempts
  where redemption_attempts.origin = redeem_invitation.origin
    and attempted_at > now() - interval '1 hour';

  if recent_failures >= 5 then
    raise exception 'Too many attempts. Wait an hour and try again.' using errcode = '54000';
  end if;

  if code is null or char_length(trim(code)) <> 6 then
    insert into public.redemption_attempts (origin) values (origin);
    raise exception '%', indistinguishable_refusal using errcode = '22023';
  end if;

  if password is null or char_length(password) < 8 then
    -- Not an attempt against a code, so it is not counted: a learner choosing a
    -- short password has not guessed at anything.
    raise exception 'Choose a password of at least 8 characters.' using errcode = '22023';
  end if;

  if char_length(clean_alias) < 2 or char_length(clean_alias) > 24 then
    raise exception 'Choose a display name between 2 and 24 characters.' using errcode = '22023';
  end if;

  select * into invitation
  from public.invitations
  where code_hash = public.hash_invitation_code(code);

  if invitation.id is null then
    insert into public.redemption_attempts (origin) values (origin);
    raise exception '%', indistinguishable_refusal using errcode = '22023';
  end if;

  -- ── The three terminal states, each named (FR-028). None of these three
  --    reveals anything about a username: the holder already had a real code.
  if invitation.revoked_at is not null then
    raise exception 'That code was cancelled. Ask for a new one.' using errcode = '22023';
  end if;

  if invitation.redeemed_at is not null then
    raise exception 'That code has already been used. Ask for a new one.' using errcode = '22023';
  end if;

  if invitation.expires_at <= now() then
    raise exception 'That code has expired. Ask for a new one.' using errcode = '22023';
  end if;

  if invitation.kind = 'learner' then
    -- R16: the auth provider needs an address-shaped identifier, so one is
    -- derived from the username in `invalid`, a domain reserved by RFC 2606 as
    -- permanently non-resolvable. A reserved domain is chosen over a
    -- plausible-looking one precisely so that no misconfiguration can ever
    -- cause mail to be delivered somewhere real. It is never displayed, never
    -- sent to, and is not a means of contact.
    auth_identifier := lower(invitation.target) || '@learner.invalid';
  else
    auth_identifier := invitation.target;
  end if;

  if invitation.purpose = 'password_reset' then
    -- The account already exists; only the credential changes. The alias is left
    -- alone, because a reset is not an invitation to rename yourself and her
    -- classmates already know her by it.
    select id into new_user_id from auth.users where lower(email) = auth_identifier;

    if new_user_id is null then
      insert into public.redemption_attempts (origin) values (origin);
      raise exception '%', indistinguishable_refusal using errcode = '22023';
    end if;

    update auth.users
    set encrypted_password = extensions.crypt(password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = new_user_id;
  else
    if exists (select 1 from auth.users where lower(email) = auth_identifier) then
      insert into public.redemption_attempts (origin) values (origin);
      raise exception '%', indistinguishable_refusal using errcode = '22023';
    end if;

    new_user_id := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      -- GoTrue scans these into Go strings and fails on NULL rather than
      -- treating it as empty, so an account created without them is one that
      -- cannot sign in. They are set explicitly for that reason alone.
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      new_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      auth_identifier, extensions.crypt(password, extensions.gen_salt('bf')),
      -- Confirmed at creation: for a learner there is no address to send a
      -- confirmation to, and requiring one would make every account
      -- unusable (R16).
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', ''
    );

    if invitation.kind = 'learner' then
      new_username := invitation.target;
    else
      -- An educator is invited by email address, and that address must NOT
      -- become her username: data-model.md is explicit that an educator's email
      -- lives in auth.users and is never exposed through `profiles`, and P3 lets
      -- an educator read usernames. So a username is derived from the local part
      -- and de-duplicated, and the address itself stays where it was.
      new_username := left(
        regexp_replace(split_part(invitation.target, '@', 1), '[^A-Za-z0-9._-]', '', 'g'),
        16
      );
      if char_length(new_username) < 3 then
        new_username := 'educator';
      end if;
      while exists (select 1 from public.profiles where lower(username) = lower(new_username)) loop
        new_username := left(new_username, 16) || '-' ||
          substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 4);
      end loop;
    end if;

    insert into public.profiles (id, username, alias, role, display_name, is_active)
    values (
      new_user_id,
      new_username,
      clean_alias,
      case when invitation.kind = 'learner' then 'learner'::public.account_role
           else 'educator'::public.account_role end,
      -- A learner is shown by her alias and may have no display name at all
      -- (schema check constraint). An educator is an adult naming herself.
      case when invitation.kind = 'learner' then null else clean_alias end,
      true
    );

    if invitation.kind = 'learner' then
      insert into public.enrolments (classroom_id, learner_id)
      values (invitation.classroom_id, new_user_id);

      -- Only now, once the enrolment exists, can the derived column be set: its
      -- composite foreign key requires the matching enrolment row. This is also
      -- what activates the classroom-scoped alias uniqueness index, so a
      -- duplicate alias fails HERE, by constraint, rather than by an
      -- application check that could be forgotten (FR-051).
      begin
        update public.profiles set classroom_id = invitation.classroom_id where id = new_user_id;
      exception when unique_violation then
        raise exception 'Someone in your class already uses that display name. Pick another.'
          using errcode = '23505';
      end;
    end if;
  end if;

  update public.invitations set redeemed_at = now() where id = invitation.id;

  return new_user_id;
end;
$$;

-- Caller must be the issuer. Refuses an already-redeemed invitation: revoking
-- one would imply an account could be un-created, which it cannot.
create or replace function public.revoke_invitation(id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  invitation public.invitations;
begin
  select * into invitation from public.invitations where invitations.id = revoke_invitation.id;

  if invitation.id is null or invitation.issuer_id <> caller then
    -- One message for "no such invitation" and "not yours", so an educator
    -- cannot probe for another educator's invitation ids.
    raise exception 'No invitation of yours with that id.' using errcode = '42501';
  end if;

  if invitation.redeemed_at is not null then
    raise exception 'That invitation has already been redeemed and cannot be cancelled.'
      using errcode = '22023';
  end if;

  update public.invitations
  set revoked_at = coalesce(revoked_at, now())
  where invitations.id = revoke_invitation.id;
end;
$$;

-- ─────────────────────────────────────────────────── destructive actions
--
-- T030c: each of the three writes its audit_log row inside its own body, which
-- is one transaction with its effect (FR-058, U2). Not a trigger and not a
-- caller obligation: either would allow the effect to commit while the record
-- is lost, which is the single failure the log exists to rule out.

-- Caller must be the educator of `learner`. Deletes every remote row for that
-- profile (FR-052, SC-015).
--
-- It cannot reach her local samples and models, and that is the intended
-- consequence of keeping images on the device — worth stating plainly in the
-- interface so nobody believes a deletion did more than it did.
create or replace function public.delete_learner(id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
begin
  if not public.is_educator_of(id) then
    raise exception 'That learner is not in a classroom you own.' using errcode = '42501';
  end if;

  if (select role from public.profiles where profiles.id = delete_learner.id) <> 'learner' then
    raise exception 'Only a learner account can be deleted this way.' using errcode = '42501';
  end if;

  -- Audit FIRST, in the same transaction. Order within the transaction does not
  -- affect atomicity, but writing it first means a later constraint failure
  -- rolls back both rather than leaving a record of something that did not
  -- happen. Opaque identifiers only (U4).
  insert into public.audit_log (actor_id, action, subject_id, detail)
  values (caller, 'learner_deleted', id, null);

  delete from public.reflections where learner_id = id;
  delete from public.lesson_progress where learner_id = id;
  delete from public.training_runs
    where project_id in (select projects.id from public.projects where owner_id = id);
  delete from public.projects where owner_id = id;
  delete from public.invitations where lower(target) = (
    select lower(username) from public.profiles where profiles.id = delete_learner.id
  );
  delete from public.enrolments where learner_id = id;
  delete from public.profiles where profiles.id = delete_learner.id;

  -- The auth.users row last: profiles.id references it, and deleting it cascades
  -- anything the explicit deletes above missed. Nothing referencing this profile
  -- may remain in any table (SC-015).
  delete from auth.users where users.id = delete_learner.id;
end;
$$;

-- Caller must be an administrator. Sets is_active = false. Refuses if the target
-- is the last remaining active administrator (FR-056), so the program cannot be
-- locked out of its own administration.
create or replace function public.deactivate_educator(id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  target_role public.account_role;
  remaining_admins integer;
begin
  if not public.is_administrator() then
    raise exception 'Only an administrator may deactivate an account.' using errcode = '42501';
  end if;

  select role into target_role from public.profiles where profiles.id = deactivate_educator.id;

  if target_role is null then
    raise exception 'No such account.' using errcode = '42501';
  end if;

  if target_role = 'learner' then
    -- A learner is removed by her educator, not deactivated by an administrator,
    -- who must not be able to act on a learner account at all (FR-055).
    raise exception 'A learner account is managed by her educator, not from here.'
      using errcode = '42501';
  end if;

  if target_role = 'administrator' then
    select count(*) into remaining_admins
    from public.profiles
    where role = 'administrator' and is_active and profiles.id <> deactivate_educator.id;

    if remaining_admins = 0 then
      raise exception 'You are the last active administrator and cannot deactivate yourself.'
        using errcode = '23514';
    end if;
  end if;

  insert into public.audit_log (actor_id, action, subject_id, detail)
  values (caller, 'educator_deactivated', id, null);

  update public.profiles set is_active = false where profiles.id = deactivate_educator.id;
end;
$$;

-- Caller must be an administrator. Moves a classroom to another active educator,
-- so that deactivating an educator never strands a group of learners (FR-057).
--
-- This is the only column an administrator may write anywhere, and it is why K5
-- lets her read a classroom's name and owner at all.
create or replace function public.reassign_classroom(classroom uuid, to_educator uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  previous_educator uuid;
begin
  if not public.is_administrator() then
    raise exception 'Only an administrator may reassign a classroom.' using errcode = '42501';
  end if;

  select educator_id into previous_educator from public.classrooms where id = classroom;

  if previous_educator is null then
    raise exception 'No such classroom.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = to_educator and role in ('educator', 'administrator') and is_active
  ) then
    raise exception 'The new owner must be an active educator.' using errcode = '42501';
  end if;

  if previous_educator = to_educator then
    raise exception 'That classroom already belongs to that educator.' using errcode = '22023';
  end if;

  -- The previous and new owner ids, and nothing else. An alias or a name here
  -- would make the log personal data (U4).
  insert into public.audit_log (actor_id, action, subject_id, detail)
  values (
    caller,
    'classroom_reassigned',
    classroom,
    jsonb_build_object('from_educator_id', previous_educator, 'to_educator_id', to_educator)
  );

  update public.classrooms set educator_id = to_educator where id = classroom;
end;
$$;

-- ============================================================================
-- Execute privileges
--
-- Every function is revoked from PUBLIC first, then granted only to the roles
-- that must call it. `redeem_invitation` is the one function `anon` may call,
-- because the account it creates does not exist yet (I5).
-- ============================================================================

revoke all on function public.generate_invitation_code() from public;
revoke all on function public.hash_invitation_code(text) from public;
revoke all on function public.redemption_origin() from public;
revoke all on function public.issue_learner_invitation(uuid, text) from public;
revoke all on function public.issue_educator_invitation(text) from public;
revoke all on function public.issue_password_reset(uuid) from public;
revoke all on function public.redeem_invitation(text, text, text) from public;
revoke all on function public.revoke_invitation(uuid) from public;
revoke all on function public.delete_learner(uuid) from public;
revoke all on function public.deactivate_educator(uuid) from public;
revoke all on function public.reassign_classroom(uuid, uuid) from public;

grant execute on function public.is_educator_of(uuid) to authenticated;
grant execute on function public.is_administrator() to authenticated;
grant execute on function public.is_educator() to authenticated;
grant execute on function public.current_account_role() to authenticated;
grant execute on function public.my_classroom_id() to authenticated;

grant execute on function public.issue_learner_invitation(uuid, text) to authenticated;
grant execute on function public.issue_educator_invitation(text) to authenticated;
grant execute on function public.issue_password_reset(uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.delete_learner(uuid) to authenticated;
grant execute on function public.deactivate_educator(uuid) to authenticated;
grant execute on function public.reassign_classroom(uuid, uuid) to authenticated;

-- The one anonymous-callable privileged function.
grant execute on function public.redeem_invitation(text, text, text) to anon, authenticated;

-- Code generation and hashing are internals. Granting them would let a caller
-- mint a code, or test a guess without going through the rate limit.
-- `redemption_origin` is likewise internal.
