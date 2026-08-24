-- ============================================================================
-- T031b — seed data
--
-- There is no self-registration anywhere in this system (FR-024), so THIS SEED
-- IS THE ONLY WAY INTO THE AUTHENTICATED APPLICATION. Without a seeded
-- administrator, nobody can invite an educator, no educator can invite a
-- learner, and the entire signed-in half of the product is unreachable. That is
-- the intended shape of the design and the reason this file is not optional
-- convenience data.
--
-- The fixture matches contracts/database.md's required test seed exactly:
--
--   A1   administrator
--   E1   educator, owns classroom K1
--   L1   learner enrolled in K1        (alias "Comet")
--   L1b  learner enrolled in K1        (alias "Nimbus")
--   E2   educator, owns classroom K2
--   L2   learner enrolled in K2        (alias "Comet" — the same alias as L1,
--                                       in a different classroom, which FR-051
--                                       must ALLOW)
--
-- plus one unredeemed invitation of each of the three kinds.
--
-- UUIDs are fixed literals so tests can name a subject without a lookup, and so
-- a failure names the same account every run.
-- ============================================================================

-- Password for every seeded account. A seed is a development and test fixture;
-- a real deployment seeds one administrator and changes this immediately.
--
-- Written as a literal rather than a psql \set variable: the row-level-security
-- test harness applies this file through a plain SQL client, which has no
-- meta-commands, and a seed that only works under psql is a seed that silently
-- stops being tested.

-- ─────────────────────────────────────────────────────────── auth.users
--
-- Inserted directly, which is the same route `redeem_invitation` takes and for
-- the same reason: there is no registration endpoint to call. The token columns
-- are set to empty strings rather than left NULL because GoTrue scans them into
-- Go strings and fails on NULL, which would make every seeded account unable to
-- sign in (see the note in 0002_functions.sql).

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  -- An administrator and the two educators are adults, so a real address is
  -- appropriate and lives here in auth.users, never in `profiles` (G3).
  ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@example.org',
   extensions.crypt('labpassword', extensions.gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', ''),

  ('00000000-0000-4000-a000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'educator1@example.org',
   extensions.crypt('labpassword', extensions.gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', ''),

  ('00000000-0000-4000-a000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'educator2@example.org',
   extensions.crypt('labpassword', extensions.gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', ''),

  -- The three learners. Their identifiers are derived from their usernames in
  -- `learner.invalid`, a domain reserved by RFC 2606 as permanently
  -- non-resolvable (R16). None of these can receive mail, by construction — a
  -- reserved domain is chosen over a plausible-looking one precisely so that no
  -- misconfiguration can ever deliver somewhere real.
  ('00000000-0000-4000-a000-00000000001a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'learner-l1@learner.invalid',
   extensions.crypt('labpassword', extensions.gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', ''),

  ('00000000-0000-4000-a000-00000000001b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'learner-l1b@learner.invalid',
   extensions.crypt('labpassword', extensions.gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', ''),

  ('00000000-0000-4000-a000-00000000002a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'learner-l2@learner.invalid',
   extensions.crypt('labpassword', extensions.gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', '');

-- ─────────────────────────────────────────────────────────── profiles

insert into public.profiles (id, username, alias, role, display_name, is_active)
values
  ('00000000-0000-4000-a000-0000000000a1', 'admin', 'Programme office', 'administrator',
   'Programme office', true),
  ('00000000-0000-4000-a000-0000000000e1', 'educator1', 'Ms Rivera', 'educator', 'Ms Rivera', true),
  ('00000000-0000-4000-a000-0000000000e2', 'educator2', 'Mr Okafor', 'educator', 'Mr Okafor', true),
  -- A learner has NO display_name: she is shown by her alias and nothing else, so
  -- a second identifier for her would be a second thing to police (FR-025).
  ('00000000-0000-4000-a000-00000000001a', 'learner-l1', 'Comet', 'learner', null, true),
  ('00000000-0000-4000-a000-00000000001b', 'learner-l1b', 'Nimbus', 'learner', null, true),
  ('00000000-0000-4000-a000-00000000002a', 'learner-l2', 'Comet', 'learner', null, true);

-- ─────────────────────────────────────────────────────────── classrooms

insert into public.classrooms (id, educator_id, name)
values
  ('00000000-0000-4000-b000-0000000000c1', '00000000-0000-4000-a000-0000000000e1',
   'Year 9 — Wednesday'),
  ('00000000-0000-4000-b000-0000000000c2', '00000000-0000-4000-a000-0000000000e2',
   'Robotics club');

-- ─────────────────────────────────────────────────────────── enrolments

insert into public.enrolments (classroom_id, learner_id)
values
  ('00000000-0000-4000-b000-0000000000c1', '00000000-0000-4000-a000-00000000001a'),
  ('00000000-0000-4000-b000-0000000000c1', '00000000-0000-4000-a000-00000000001b'),
  ('00000000-0000-4000-b000-0000000000c2', '00000000-0000-4000-a000-00000000002a');

-- The derived column, set only now that the enrolments exist — its composite
-- foreign key requires the matching row. Setting it is what activates the
-- classroom-scoped alias uniqueness index, and the fact that L1 and L2 both use
-- "Comet" without conflict is the seed's demonstration that FR-051 is scoped to a
-- classroom rather than to the system.
update public.profiles set classroom_id = '00000000-0000-4000-b000-0000000000c1'
  where id in ('00000000-0000-4000-a000-00000000001a', '00000000-0000-4000-a000-00000000001b');
update public.profiles set classroom_id = '00000000-0000-4000-b000-0000000000c2'
  where id = '00000000-0000-4000-a000-00000000002a';

-- ─────────────────────────────────────────────────────────── invitations
--
-- One unredeemed invitation of each of the three kinds, with codes the test
-- suite knows. The hashes go through `hash_invitation_code` so they are peppered
-- exactly as a real issue would be — writing a literal hash here would make the
-- seed silently stop matching the moment the hashing changed.

insert into public.invitations
  (id, issuer_id, kind, purpose, target, classroom_id, code_hash, expires_at)
values
  -- An administrator inviting an educator.
  ('00000000-0000-4000-c000-0000000000d1',
   '00000000-0000-4000-a000-0000000000a1', 'educator', 'initial',
   'newteacher@example.org', null,
   public.hash_invitation_code('SEEDA2'), now() + interval '72 hours'),

  -- E1 inviting a new learner into K1.
  ('00000000-0000-4000-c000-0000000000d2',
   '00000000-0000-4000-a000-0000000000e1', 'learner', 'initial',
   'learner-new', '00000000-0000-4000-b000-0000000000c1',
   public.hash_invitation_code('SEEDB3'), now() + interval '72 hours'),

  -- E1 issuing L1b a password reset. A learner has no address to send a reset
  -- to, so recovery necessarily runs through her educator (R16, FR-030).
  ('00000000-0000-4000-c000-0000000000d3',
   '00000000-0000-4000-a000-0000000000e1', 'learner', 'password_reset',
   'learner-l1b', '00000000-0000-4000-b000-0000000000c1',
   public.hash_invitation_code('SEEDC4'), now() + interval '72 hours');

-- ─────────────────────────────────────────────── a little learner content
--
-- Enough for the isolation tests to have something to fail to reach. An
-- administrator returning zero rows from an empty table proves nothing.

insert into public.projects (id, owner_id, name, class_count, sample_count)
values
  ('00000000-0000-4000-d000-0000000000f1', '00000000-0000-4000-a000-00000000001a',
   'Fruit or not', 2, 24),
  ('00000000-0000-4000-d000-0000000000f2', '00000000-0000-4000-a000-00000000002a',
   'Bottle caps', 3, 30);

insert into public.training_runs
  (id, project_id, per_class, confusion, overall_accuracy, imbalance_ratio, backbone_alpha, epochs)
values
  ('00000000-0000-4000-e000-0000000000a1', '00000000-0000-4000-d000-0000000000f1',
   '[{"classId":"c1","className":"Apple","sampleCount":16,"accuracy":0.94},
     {"classId":"c2","className":"Not apple","sampleCount":8,"accuracy":0.75}]'::jsonb,
   '[[15,1],[2,6]]'::jsonb, 0.8750, 2.0, 0.50, 20);

insert into public.lesson_progress (learner_id, module_id, state, completed_steps)
values
  ('00000000-0000-4000-a000-00000000001a', 'what-the-model-sees', 'completed',
   array['capture', 'train', 'test']),
  ('00000000-0000-4000-a000-00000000002a', 'what-the-model-sees', 'in_progress',
   array['capture']);

insert into public.reflections (learner_id, module_id, question_id, answer)
values
  ('00000000-0000-4000-a000-00000000001a', 'what-the-model-sees', 'what-surprised-you',
   'It kept saying apple when I held up my hand, because my hand was always in the photos.'),
  ('00000000-0000-4000-a000-00000000002a', 'what-the-model-sees', 'what-surprised-you',
   'The background mattered more than the bottle cap.');
