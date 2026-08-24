-- ============================================================================
-- T029 — Explainable AI Lab: remote schema
--
-- Nine tables from data-model.md, plus two support tables the invitation
-- mechanics need (documented where they appear).
--
-- Two guarantees in here are STRUCTURAL, not policy, and that is the whole
-- point of the design:
--
--   G2  No column anywhere can hold image or weight data. No `bytea`, and no
--       text column named to smuggle a data URL.
--   G3  No column anywhere can hold a learner's email address, date of birth,
--       or real name.
--
-- Both are asserted by tests/db/schema.test.ts, which inspects
-- information_schema.columns and fails the build. A previous revision of this
-- design gated every write on a consent state; that worked but had to be
-- remembered on each new table. A column that cannot exist needs nothing
-- remembered (research.md R9).
--
-- Row-level security is enabled here on every table so that no window exists
-- between this migration and 0003_rls.sql in which a table is readable. The
-- policies themselves live in 0003.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────── enumerations

create type public.account_role as enum ('learner', 'educator', 'administrator');
create type public.invitation_kind as enum ('educator', 'learner');
create type public.invitation_purpose as enum ('initial', 'password_reset');
create type public.progress_state as enum ('not_started', 'in_progress', 'completed');
create type public.audit_action as enum (
  'learner_deleted',
  'educator_deactivated',
  'classroom_reassigned'
);
create type public.ui_locale as enum ('en', 'es');

-- ─────────────────────────────────────────────────────────── profiles

-- There is deliberately NO date_of_birth, NO consent_state, NO email and NO
-- real-name column here or anywhere else. That absence is the project's entire
-- data-protection position (SC-017), which is why it is asserted structurally
-- rather than left to code review.
--
-- An educator's email lives in auth.users and is never exposed through this
-- table. A learner has no real email at all: her auth.users row carries an
-- identifier derived from `username` in a domain reserved by RFC 2606 as
-- permanently non-resolvable (R16), so no query can leak a contact detail she
-- never gave.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Assigned by the issuer, unique system-wide, never shown to another learner
  -- (FR-025, FR-051).
  username text not null,

  -- Self-chosen, unique within a classroom (FR-051). The ONLY identifier ever
  -- shown to another learner.
  alias text not null,

  role public.account_role not null,

  -- Educators and administrators only — how an educator appears to her
  -- learners. NULL for a learner, who is shown by `alias`.
  display_name text,

  -- FALSE blocks sign-in. An administrator deactivates an educator here
  -- (FR-054); the last administrator cannot be deactivated (FR-056).
  is_active boolean not null default true,

  locale public.ui_locale not null default 'en',

  -- Derived from `enrolments`, and present only so that FR-051's
  -- classroom-scoped alias uniqueness can be a real constraint rather than an
  -- application check (remote-store invariant 10). The composite foreign key
  -- below makes it impossible for this column to disagree with `enrolments`,
  -- and Postgres offers no other way to express "unique within the classroom
  -- this learner is enrolled in" as a constraint.
  classroom_id uuid,

  created_at timestamptz not null default now(),

  constraint profiles_username_length check (char_length(username) between 3 and 24),
  constraint profiles_alias_length check (char_length(alias) between 2 and 24),

  -- A learner is shown by her alias, so a display name would be a second,
  -- unpoliced identifier for her. Educators and administrators are adults whose
  -- names are theirs to give.
  constraint profiles_learner_has_no_display_name
    check (role <> 'learner' or display_name is null)
);

-- FR-051: unique system-wide, case-insensitively. Two learners whose usernames
-- differ only in case would make an educator's roster ambiguous.
create unique index profiles_username_unique on public.profiles (lower(username));

-- ─────────────────────────────────────────────────────────── classrooms

create table public.classrooms (
  id uuid primary key default gen_random_uuid(),

  -- The row's owner. REASSIGNABLE by an administrator, so that deactivating an
  -- educator never strands a group of learners (FR-057).
  educator_id uuid not null references public.profiles (id) on delete restrict,

  name text not null,

  -- Archiving hides a finished classroom without deleting it or its learners'
  -- work (FR-038).
  archived_at timestamptz,

  created_at timestamptz not null default now(),

  constraint classrooms_name_length check (char_length(name) between 1 and 60)
);

create index classrooms_educator_idx on public.classrooms (educator_id);

-- There is NO join code column, and that is a deliberate absence. A learner does
-- not join a classroom; she is created inside one by the invitation her educator
-- issued, so `invitations.classroom_id` carries what a join code used to. This
-- removes code generation, rotation and retirement, along with the class of bug
-- where a leaked code lets a stranger into a classroom (R9).

-- ─────────────────────────────────────────────────────────── enrolments

create table public.enrolments (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  learner_id uuid not null references public.profiles (id) on delete cascade,
  enrolled_at timestamptz not null default now(),

  primary key (classroom_id, learner_id),

  -- E5: a learner holds at most one enrolment at a time (Assumptions).
  constraint enrolments_one_per_learner unique (learner_id),

  -- Referenced by profiles.classroom_id below. Redundant with the primary key
  -- in content, but a composite foreign key needs a unique constraint in this
  -- exact column order.
  constraint enrolments_learner_classroom_unique unique (learner_id, classroom_id)
);

-- The constraint that makes FR-051 real. `profiles.classroom_id` cannot name a
-- classroom the learner is not enrolled in, and ON DELETE SET NULL means that an
-- educator removing a learner (E4) frees her alias for reuse while leaving her
-- account, projects, progress and reflections untouched.
alter table public.profiles
  add constraint profiles_classroom_matches_enrolment
  foreign key (id, classroom_id)
  references public.enrolments (learner_id, classroom_id)
  on update cascade
  on delete set null;

-- FR-051: an alias is unique within a classroom, case-insensitively. Partial,
-- because an educator, an administrator, and a learner between classrooms all
-- have a NULL classroom_id and must not collide with each other.
create unique index profiles_alias_per_classroom_unique
  on public.profiles (classroom_id, lower(alias))
  where classroom_id is not null;

-- ─────────────────────────────────────────────────────────── invitations

-- The only way an account comes into existence (FR-024).
create table public.invitations (
  id uuid primary key default gen_random_uuid(),

  issuer_id uuid not null references public.profiles (id) on delete cascade,
  kind public.invitation_kind not null,
  purpose public.invitation_purpose not null default 'initial',

  -- The assigned `username` when kind = 'learner'; the educator's own email
  -- address when kind = 'educator'.
  --
  -- This is the one column in the schema that can hold an email address, and it
  -- can hold ONLY an adult educator's, never a learner's. G3 is about learners,
  -- and the schema test asserts exactly that: this column is named `target`
  -- rather than `email` so that no name-pattern check mistakes it for a learner
  -- contact detail, and the kind='learner' rows carry a username instead.
  target text not null,

  -- Required when kind = 'learner' — the classroom the redeemed account is
  -- enrolled into. NULL for an educator.
  classroom_id uuid references public.classrooms (id) on delete cascade,

  -- Hash of the single-use code. The code itself is 6 characters over a
  -- 32-symbol alphabet, returned to the issuer ONCE at issue time, and never
  -- stored or selectable by anyone (I2, R15).
  code_hash text not null,

  -- 72 hours after issue, from VITE_INVITATION_TTL_HOURS (FR-028).
  expires_at timestamptz not null,

  -- Counted per invitation for reporting. The enforced limit is per origin and
  -- lives in `redemption_attempts` below, because an attacker guessing codes
  -- does not know which invitation row he is attacking (I5).
  failed_attempts integer not null default 0,

  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint invitations_learner_needs_classroom
    check ((kind = 'learner') = (classroom_id is not null)),

  -- A redeemed invitation cannot also be revoked: the two terminal states would
  -- give the FR-028 refusal two different true answers about the same code.
  constraint invitations_not_both_terminal
    check (redeemed_at is null or revoked_at is null)
);

create index invitations_issuer_idx on public.invitations (issuer_id);
create index invitations_classroom_idx on public.invitations (classroom_id);

-- Redemption looks an invitation up by its code alone (the RPC signature takes
-- no target), so the hash must be directly indexable.
create unique index invitations_code_hash_unique on public.invitations (code_hash);

-- A username can only be claimed once at a time: two live invitations for the
-- same learner username would let two people occupy one identity.
create unique index invitations_live_learner_target_unique
  on public.invitations (lower(target))
  where kind = 'learner' and redeemed_at is null and revoked_at is null;

-- ─────────────────────────────────────────────────────────── code pepper

-- A support table, not one of the nine.
--
-- Codes are hashed with SHA-256 rather than bcrypt because redemption must find
-- an invitation *by its code* in one index lookup; a per-row salt would force a
-- scan-and-verify over every live invitation. A 6-character code is only ~30
-- bits, so an unpeppered digest would be trivially reversible by anyone who
-- obtained the table. The pepper is held here, readable by nobody and by no
-- policy — only the SECURITY DEFINER functions reach it.
create table public.code_pepper (
  id boolean primary key default true,
  pepper text not null,
  constraint code_pepper_singleton check (id)
);

insert into public.code_pepper (id, pepper)
values (true, encode(extensions.gen_random_bytes(32), 'hex'));

-- ─────────────────────────────────────────────────────────── rate limiting

-- A support table, not one of the nine.
--
-- I5 makes the redemption rate limit a DATABASE obligation rather than an
-- interface courtesy. At ~30 bits of entropy a code has roughly a billion
-- possibilities and 360 guesses available across its 72-hour life, so this limit
-- is the PRIMARY defence, not a secondary one — and an interface-level throttle
-- would be removed by anyone who cared to try.
--
-- Rows are keyed by origin, resolved from the request's forwarded address.
create table public.redemption_attempts (
  id bigserial primary key,
  origin text not null,
  attempted_at timestamptz not null default now()
);

create index redemption_attempts_origin_time_idx
  on public.redemption_attempts (origin, attempted_at desc);

-- ─────────────────────────────────────────────────────────── projects

-- Metadata only. The local IndexedDB store holds the substance: no image, no
-- weight, and no column here that could hold either (G2, J4).
create table public.projects (
  id uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,

  -- Denormalised so a roster renders without reading child tables.
  class_count integer not null default 0,
  sample_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_name_length check (char_length(name) between 1 and 60),
  constraint projects_counts_non_negative check (class_count >= 0 and sample_count >= 0)
);

create index projects_owner_idx on public.projects (owner_id);

-- ─────────────────────────────────────────────────────────── training_runs

create table public.training_runs (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Only completed runs are recorded (FR-050).
  finished_at timestamptz not null default now(),

  -- [{ classId, className, sampleCount, accuracy }]
  per_class jsonb not null,

  -- Row-major integer matrix, ordered by per_class. Row = TRUE class.
  confusion jsonb not null,

  overall_accuracy numeric(5, 4) not null,

  -- Largest class count / smallest. Drives the FR-021 warning and nothing else:
  -- it never gates a write, exactly as it never gates training (FR-009).
  imbalance_ratio numeric,

  -- Which backbone produced the run, so two runs are compared fairly (FR-010).
  backbone_alpha numeric(3, 2) not null,

  epochs integer not null,

  constraint training_runs_accuracy_range check (overall_accuracy between 0 and 1),
  constraint training_runs_epochs_positive check (epochs > 0),
  constraint training_runs_alpha_known check (backbone_alpha in (0.25, 0.50))
);

create index training_runs_project_idx on public.training_runs (project_id);

-- ─────────────────────────────────────────────────────────── lesson_progress

create table public.lesson_progress (
  learner_id uuid not null references public.profiles (id) on delete cascade,

  -- A content slug, not a foreign key, so lesson content ships with the
  -- application and can be revised without a migration.
  module_id text not null,

  state public.progress_state not null default 'not_started',

  -- Step slugs, so a module can gain a step without invalidating progress.
  completed_steps text[] not null default '{}',

  updated_at timestamptz not null default now(),

  primary key (learner_id, module_id)
);

-- ─────────────────────────────────────────────────────────── reflections

create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  module_id text not null,
  question_id text not null,
  answer text not null,
  updated_at timestamptz not null default now(),

  -- L4: revising replaces rather than appends (FR-035).
  constraint reflections_one_answer_per_question unique (learner_id, module_id, question_id),
  constraint reflections_answer_length check (char_length(answer) between 1 and 4000)
);

create index reflections_learner_idx on public.reflections (learner_id);

-- ─────────────────────────────────────────────────────────── audit_log

-- Append-only, unreadable through the application, and the answer to "who
-- removed my daughter's work?"
--
-- U4: no column may hold an alias, a username, an email address, a date of
-- birth, or a real name — only opaque identifiers. A log built to be readable by
-- a human is a log that has become personal data, and this one is read by
-- querying identifiers during an incident, not by browsing.
create table public.audit_log (
  -- bigint, so ordering survives a clock adjustment.
  id bigserial primary key,

  actor_id uuid not null,
  action public.audit_action not null,
  subject_id uuid not null,

  -- Opaque identifiers only — for a reassignment, the previous and new
  -- educator_id.
  detail jsonb,

  occurred_at timestamptz not null default now()
);

-- ============================================================================
-- Row-level security ON for every table, before any policy exists.
--
-- G1: a table with no policy is a defect, not a default-open convenience.
-- Enabling RLS here rather than in 0003 means that between the two migrations
-- every table denies everything, so no window exists in which a table is
-- readable by accident.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.classrooms enable row level security;
alter table public.enrolments enable row level security;
alter table public.invitations enable row level security;
alter table public.projects enable row level security;
alter table public.training_runs enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.reflections enable row level security;
alter table public.audit_log enable row level security;
alter table public.code_pepper enable row level security;
alter table public.redemption_attempts enable row level security;

-- FORCE row level security is deliberately NOT applied.
--
-- It reads like the stricter choice and it would break the design. The nine
-- privileged functions in 0002 are SECURITY DEFINER owned by the table owner,
-- and the owner's RLS bypass is precisely how `redeem_invitation` can be the
-- only writer of `profiles` while no client insert succeeds (G6). FORCE would
-- subject those functions to the very policies they exist to be the sanctioned
-- exception to.
--
-- The safety property that matters is unaffected: PostgREST connects as `anon`
-- or `authenticated`, neither of which owns anything, so no client request
-- bypasses a policy. Definer functions are kept honest by G5 — each validates
-- its own arguments and re-derives its caller from auth.uid() — not by FORCE.
--
-- `code_pepper` and `redemption_attempts` have RLS enabled and NO policy at all,
-- which denies every client every operation on them. They are reachable only
-- from inside a definer function, which is the intent: the pepper is what stops
-- a leaked invitations table being a list of live bearer credentials.
