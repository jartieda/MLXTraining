-- ============================================================================
-- T031 — Row-level security policies
--
-- Because there is no first-party server (Principle II), THESE POLICIES ARE THE
-- ENTIRE AUTHORISATION MODEL. They are contracts, not configuration, and every
-- numbered assertion in contracts/database.md has a corresponding test in
-- tests/db/rls.test.ts.
--
-- Two mechanisms are used together and it is worth being clear about which does
-- what:
--
--   * RLS decides which ROWS a caller sees.
--   * Column GRANTs decide which COLUMNS. RLS cannot restrict a column, so
--     wherever a contract says "and no other column", a grant or a view does it.
--
-- The one structural consequence: Postgres column privileges are per database
-- role, and Supabase gives every signed-in account the same role
-- (`authenticated`). So where two application roles need different column sets
-- from one table — K5's administrator versus K1's educator — the narrower view
-- is a separate relation. `public.admin_classrooms` below is that relation, and
-- it is the only way to make "exactly three columns" true rather than aspirational.
-- ============================================================================

-- Nothing is granted by default. Every privilege below is deliberate.
revoke all on all tables in schema public from anon, authenticated;

-- ════════════════════════════════════════════════════════════════ profiles

-- P1: any account reads its own profile row.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- P2: a learner may read her classmates and her educator.
--
-- The COLUMN restriction ("and no other column") is enforced by the grant at the
-- bottom of this block, not here: `username` is never granted to `authenticated`
-- at all, so no learner and no educator reads another learner's username through
-- PostgREST. P3's roster reads it through `public.educator_roster` instead.
create policy profiles_select_classmates on public.profiles
  for select to authenticated
  using (
    public.my_classroom_id() is not null
    and (
      classroom_id = public.my_classroom_id()
      or id in (
        select c.educator_id from public.classrooms c where c.id = public.my_classroom_id()
      )
    )
  );

-- P3: an educator reads the learners enrolled in a classroom she owns.
create policy profiles_select_roster on public.profiles
  for select to authenticated
  using (public.is_educator_of(id));

-- P6: an administrator reads rows where role = 'educator', and NOTHING for rows
-- where role = 'learner'.
--
-- The narrowest read policy in the schema, and deliberately so. An administrator
-- exists to manage who may run a classroom, not to look inside one — she is the
-- only role whose definition is mostly a list of things she cannot reach
-- (FR-055, SC-018).
create policy profiles_select_educators_for_admin on public.profiles
  for select to authenticated
  using (public.is_administrator() and role in ('educator', 'administrator'));

-- P4: an account updates `alias` and `locale` only.
--
-- The row scope is here; the COLUMN scope is the grant below, and that is the
-- half that matters. A client-writable `role` would let any learner promote
-- herself to educator or administrator, and a client-writable `is_active` would
-- let a deactivated educator restore her own access.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- P5: no insert and no delete, for anyone. Insertion happens only through
-- `redeem_invitation` (G6); deletion only through `delete_learner`. There is
-- deliberately no policy for either command, which denies both.

grant select (id, alias, role, display_name, is_active, locale, classroom_id, created_at)
  on public.profiles to authenticated;
grant update (alias, locale) on public.profiles to authenticated;

-- `username` is absent from the grant above on purpose. It is the identifier
-- FR-025 says must never be shown to another learner, so rather than trusting
-- every future policy to keep excluding it, it is unreadable through the table
-- to every signed-in caller without exception.

-- P3 (columns): the roster an educator does need, including the usernames she
-- issued and no others. `security_invoker` makes the view run under the caller's
-- own policies, so the row scope is still `is_educator_of`.
create view public.educator_roster
with (security_invoker = true)
as
select
  p.id,
  p.username,
  p.alias,
  p.role,
  p.is_active,
  p.classroom_id
from public.profiles p
where public.is_educator_of(p.id);

grant select on public.educator_roster to authenticated;

comment on view public.educator_roster is
  'P3: the only relation through which a username is readable, and only by the educator who issued it.';

-- ════════════════════════════════════════════════════════════════ classrooms

-- K1: an educator selects, inserts, updates and deletes only her own classrooms.
create policy classrooms_educator_all on public.classrooms
  for all to authenticated
  using (educator_id = auth.uid())
  with check (educator_id = auth.uid());

-- K2: an enrolled learner reads `id` and `name` only. The column half is the
-- grant below; `educator_id` is granted because a learner needs to resolve her
-- educator's display name (P2), and it is not a personal datum.
create policy classrooms_learner_select on public.classrooms
  for select to authenticated
  using (id = public.my_classroom_id());

-- K3: an educator selecting a classroom she does not own returns zero rows. That
-- is not a separate policy — it is the absence of one. K1 is the only educator
-- policy, so anything outside it is invisible (FR-042, SC-011).

-- K4: archival is an UPDATE of `archived_at` under K1. Setting it hides the
-- classroom from the active list without deleting it, its enrolments, or its
-- learners' work (FR-038). The interface filters on it; the database keeps it.

grant select (id, name, educator_id, archived_at, created_at) on public.classrooms to authenticated;
grant insert, update, delete on public.classrooms to authenticated;

-- K5 / K6: the administrator's window onto a classroom.
--
-- Exactly `id`, `name` and `educator_id` — the least she needs to reassign one
-- under FR-057, and nothing else. This is a separate relation rather than a
-- policy on `classrooms` because RLS cannot restrict columns and column grants
-- cannot distinguish an administrator from an educator: both are
-- `authenticated`. An administrator gets ZERO rows from `classrooms` itself
-- (there is no administrator policy on it), so this view is her only route, and
-- it exposes no column from which a learner, a project or a reflection could be
-- reached (FR-055, SC-018).
--
-- K6: she cannot rename, archive or delete. The view is not updatable — no
-- INSTEAD OF trigger exists — and `reassign_classroom` is the only writer.
create view public.admin_classrooms
with (security_invoker = false)
as
select c.id, c.name, c.educator_id
from public.classrooms c
where public.is_administrator();

grant select on public.admin_classrooms to authenticated;

comment on view public.admin_classrooms is
  'K5: an administrator reads exactly id, name and educator_id. security_invoker is false because `classrooms` has no administrator policy — this view IS her authorised window, gated by is_administrator().';

-- ════════════════════════════════════════════════════════════════ enrolments

-- E1: insert via RPC only. No insert policy exists, so a direct client insert is
-- denied; enrolment is created by `redeem_invitation`.

-- E2: a learner reads her own enrolment.
create policy enrolments_select_own on public.enrolments
  for select to authenticated
  using (learner_id = auth.uid());

-- E3: an educator reads the enrolments of a classroom she owns, resolved through
-- the definer function rather than a subquery on `enrolments`, which would
-- recurse (R9).
create policy enrolments_select_own_classroom on public.enrolments
  for select to authenticated
  using (
    classroom_id in (select c.id from public.classrooms c where c.educator_id = auth.uid())
  );

-- E4: the owning educator removes a learner from her classroom. This deletes the
-- enrolment row and NOTHING else — the learner's account, projects, progress and
-- reflections all survive, and only the educator's visibility ends (FR-039).
-- Deleting the account is the separate, heavier action of FR-052.
create policy enrolments_educator_delete on public.enrolments
  for delete to authenticated
  using (
    classroom_id in (select c.id from public.classrooms c where c.educator_id = auth.uid())
  );

-- E5 is the unique constraint in 0001, not a policy.
-- E6: an administrator selecting any enrolment returns zero rows — again the
-- absence of a policy rather than the presence of one (FR-055, SC-018).

grant select, delete on public.enrolments to authenticated;

-- ════════════════════════════════════════════════════════════════ invitations

-- I1: the issuer reads the invitations she issued, so she can show their state
-- (FR-054, Scenario 6.2).
create policy invitations_select_own on public.invitations
  for select to authenticated
  using (issuer_id = auth.uid());

-- I3: cross-issuer denial. The absence of any other select policy is what makes
-- E2's invitations invisible to E1, and an educator's learner invitations
-- invisible to an administrator.

-- I4: insert and update via RPC only. No policy for either command exists, so
-- issuing, redeeming and revoking all go through their named functions.

-- I2 — THE STRICTEST RULE IN THE SCHEMA: `code_hash` is never selectable by
-- anyone, including the issuer. An invitation code is a bearer credential for
-- creating an account inside a named classroom, so a readable table of live
-- codes would let an outsider occupy one. The plaintext is returned once by the
-- issuing function and never again.
--
-- Enforced by omission from this grant, which is the only mechanism that
-- actually works: a policy cannot restrict a column.
grant select (
  id, issuer_id, kind, purpose, target, classroom_id,
  expires_at, failed_attempts, redeemed_at, revoked_at, created_at
) on public.invitations to authenticated;

-- I5 lives in `redeem_invitation` and `redemption_attempts`. Neither
-- `redemption_attempts` nor `code_pepper` has any policy at all, so no client
-- can read, add to, or clear the rate-limit record.

-- ════════════════════════════════════════════════════════ projects, runs

-- J1: a learner has full access to her own projects.
create policy projects_owner_all on public.projects
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- J2: an educator reads the projects of learners in her own classroom and CANNOT
-- write them. `for select` only — there is no educator insert, update or delete
-- policy, so a well-meaning educator cannot tidy up a learner's work.
create policy projects_educator_select on public.projects
  for select to authenticated
  using (public.is_educator_of(owner_id));

-- J3: cross-learner denial. Learner A reading learner B's project returns zero
-- rows, by the absence of any policy that would allow it (FR-042).
-- J4: no image column exists — a schema guarantee (G2), not a policy.
-- J5: an administrator selecting any project returns zero rows.

create policy training_runs_owner_all on public.training_runs
  for all to authenticated
  using (
    project_id in (select p.id from public.projects p where p.owner_id = auth.uid())
  )
  with check (
    project_id in (select p.id from public.projects p where p.owner_id = auth.uid())
  );

create policy training_runs_educator_select on public.training_runs
  for select to authenticated
  using (
    project_id in (
      select p.id from public.projects p where public.is_educator_of(p.owner_id)
    )
  );

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.training_runs to authenticated;

-- ═══════════════════════════════════════════ lesson_progress, reflections

-- L1: a learner has full access to her own rows.
create policy lesson_progress_owner_all on public.lesson_progress
  for all to authenticated
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

-- L2: an educator reads them, via `is_educator_of` (FR-040). Read only.
create policy lesson_progress_educator_select on public.lesson_progress
  for select to authenticated
  using (public.is_educator_of(learner_id));

create policy reflections_owner_all on public.reflections
  for all to authenticated
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

create policy reflections_educator_select on public.reflections
  for select to authenticated
  using (public.is_educator_of(learner_id));

-- L3: cross-learner denial, by absence.
-- L4: revise-in-place is the unique constraint on
--     (learner_id, module_id, question_id) in 0001, so a repeat answer replaces
--     rather than appends (FR-035).
-- L5: an administrator selecting any progress row or reflection returns zero rows.

grant select, insert, update, delete on public.lesson_progress to authenticated;
grant select, insert, update, delete on public.reflections to authenticated;

-- ════════════════════════════════════════════════════════════════ audit_log

-- U1: NO SELECT FOR ANYONE, including an administrator.
--
-- This is deliberate and worth defending against the obvious objection that an
-- administrator should be able to see the log. She should not: an entry such as
-- "educator E deleted learner L" names a learner account, which is exactly what
-- FR-055 forbids her to reach. An audit screen would recreate through the back
-- door the one role this design exists to prevent (FR-058).
--
-- The log is read by direct database inspection during an incident, never
-- through the application. Enforced by granting nothing and writing no policy.
--
-- U2: rows are inserted only from inside `delete_learner`,
--     `deactivate_educator` and `reassign_classroom`, in the same transaction as
--     the effect.
-- U3: append-only. No update and no delete policy exists, so nothing may amend
--     or remove a row — including the account that wrote it.
-- U4: no column holds a personal datum, which is a schema guarantee (G3).

-- Nothing granted. Deliberately no statement here at all.

-- ════════════════════════════════════════════════════════════════ sequences

-- `training_runs` and `projects` use client-generated UUIDs, so the only
-- sequences are on `audit_log` and `redemption_attempts`, neither of which a
-- client may write. No sequence usage is granted.

-- ════════════════════════════════════════════════════════════════ schema

grant usage on schema public to anon, authenticated;
