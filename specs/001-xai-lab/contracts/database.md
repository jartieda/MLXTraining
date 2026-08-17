# Contract: Database Schema and Row-Level Security

**Feature**: `001-xai-lab` | **Date**: 2026-08-17

Because there is no first-party server (Principle II), **row-level security policies are the entire
authorisation model**. They are therefore treated as contracts with their own test suite in
`tests/db/`, and every numbered assertion below must have a corresponding test.

Field definitions live in [data-model.md](../data-model.md). This document specifies the
*authorisation* behaviour and the SQL surface the client is allowed to call.

---

## Global rules

| Rule | Statement |
|---|---|
| **G1** | `alter table … enable row level security` on **every** table. A table with no policy is a defect, not a default-open convenience. |
| **G2** | No column anywhere may hold image or weight data. No `bytea` columns; no text column used to smuggle a data URL. Enforced by a test that inspects `information_schema.columns`. |
| **G3** | Every **write** policy on `projects`, `training_runs`, `lesson_progress`, `reflections`, and `enrolments` additionally requires the caller's `consent_state = 'active'`. |
| **G4** | Client access is via PostgREST and the listed RPCs only. No RPC is `SECURITY DEFINER` unless named as such below. |
| **G5** | Every RPC validates its own arguments; a client is assumed hostile. |

G3 is what makes SC-014 a guarantee rather than a courtesy: a pending account cannot persist anything
remotely even with a tampered client.

---

## Helper functions

```sql
-- Resolves the caller's consent state. STABLE, SECURITY DEFINER.
create function public.current_consent_state() returns text

-- True when the caller is the educator of a classroom that learner_id is enrolled in.
-- SECURITY DEFINER is REQUIRED: a policy on `enrolments` that itself selects from
-- `enrolments` recurses and fails at runtime (R9).
create function public.is_educator_of(learner_id uuid) returns boolean

-- Validates a join code and enrols the caller. SECURITY DEFINER.
-- Never exposes classrooms.code_hash to the client.
create function public.join_classroom(code text) returns uuid

-- Records a guardian consent confirmation against a single-use token. SECURITY DEFINER.
create function public.confirm_consent(token text) returns void

-- Withdraws consent and deletes every remote row owned by the profile. SECURITY DEFINER.
create function public.withdraw_consent(token text) returns void
```

Each `SECURITY DEFINER` function must set `search_path = public, pg_temp` explicitly — omitting it
is a privilege-escalation vector.

---

## Per-table policies

### `profiles`

| # | Policy | Assertion |
|---|---|---|
| P1 | select own | A learner reads her own profile row. |
| P2 | select alias of classmates and educator | A learner may read `id`, `alias`, `role` of others in her classroom — **and no other column**. `date_of_birth` and `consent_state` are never readable by another user. |
| P3 | educator select roster | An educator reads `id`, `alias`, `role` for learners enrolled in a classroom she owns, via `is_educator_of`. |
| P4 | update own, restricted | A learner updates `alias` and `locale` only. `role`, `date_of_birth`, and `consent_state` are not client-writable. |
| P5 | no delete | Deletion happens through `withdraw_consent` or account deletion, never a direct client `delete`. |

P4 matters: a client-writable `consent_state` would let any account promote itself out of the pending
state, defeating G3 entirely.

### `consent_records`

| # | Policy | Assertion |
|---|---|---|
| C1 | insert own request | A profile may create its own consent request. |
| C2 | **no select for anyone** | `guardian_email` and `token_hash` are never returned by any client select, for any role. Progress is read via `profiles.consent_state`. |
| C3 | update via RPC only | `confirmed_at` and `withdrawn_at` are set only by `confirm_consent` / `withdraw_consent`. |
| C4 | resend rate-limited | `resend_count` increments are capped; a further request is refused. |

C2 is the strictest rule in the schema. A guardian's email is a third party's personal data collected
for one purpose; no learner, educator, or classmate has any reason to read it.

### `classrooms`

| # | Policy | Assertion |
|---|---|---|
| K1 | educator full access to own | An educator selects, inserts, updates, and deletes only classrooms where `educator_id = auth.uid()`. |
| K2 | learner select enrolled, restricted | An enrolled learner reads `id` and `name` only. `code_hash` is **never** selectable by a learner. |
| K3 | cross-educator denial | An educator selecting a classroom she does not own returns zero rows (FR-042, SC-011). |
| K4 | code retirement | Setting `code_active = false` causes `join_classroom` to refuse that code, without affecting existing enrolments (FR-038). |

### `enrolments`

| # | Policy | Assertion |
|---|---|---|
| E1 | insert via RPC only | Direct client insert is denied; enrolment happens through `join_classroom`. |
| E2 | select own | A learner reads her own enrolment. |
| E3 | educator select own classroom | Via `is_educator_of`, not a recursive subquery. |
| E4 | learner may delete own | A learner may leave a classroom (FR-039). |
| E5 | one classroom per learner | A unique constraint on `learner_id` refuses a second enrolment. |
| E6 | pending refused | `join_classroom` refuses a caller whose `consent_state <> 'active'` (Edge Cases). |

### `projects`, `training_runs`

| # | Policy | Assertion |
|---|---|---|
| J1 | learner full access to own | Scoped to `owner_id = auth.uid()`, and writes additionally require G3. |
| J2 | educator read-only | An educator reads `projects` and `training_runs` of learners in her own classroom, and **cannot write them**. |
| J3 | cross-learner denial | Learner A reading learner B's project or run returns zero rows (FR-042). |
| J4 | no image column | Restates G2 for the two tables closest to image data. |

### `lesson_progress`, `reflections`

| # | Policy | Assertion |
|---|---|---|
| L1 | learner full access to own | Writes additionally require G3. |
| L2 | educator read-only | Via `is_educator_of` (FR-040). |
| L3 | cross-learner denial | Learner A cannot read learner B's progress or reflections. |
| L4 | revise in place | A repeat answer to the same `(learner, module, question)` replaces rather than appends (FR-035). |

---

## Required test scenarios (`tests/db/`)

Each runs against a local Supabase instance with at least three seeded accounts: educator E1 owning
classroom K1, learner L1 enrolled in K1, learner L2 enrolled in a classroom owned by educator E2, and
pending learner L3.

1. **G2** — no `bytea` column and no image-shaped text column exists in any table.
2. **G3** — L3 (pending) attempting to insert a project, training run, lesson progress, reflection,
   or enrolment is denied in **every** case. Satisfies SC-014.
3. **P2/P4** — L1 cannot read L2's `date_of_birth`; L1 cannot update her own `consent_state` or
   `role`.
4. **C2** — no role, including E1 and the profile owner, can select any `consent_records` row.
5. **K3** — E2 selecting classroom K1 returns zero rows. Satisfies SC-011.
6. **E5** — L1 joining a second classroom is refused.
7. **E6** — L3 calling `join_classroom` with a valid code is refused.
8. **J2** — E1 can read L1's `training_runs` and cannot update them.
9. **J3/L3** — L2 reading any of L1's projects, runs, progress, or reflections returns zero rows.
10. **`is_educator_of` non-recursion** — E1 reading her full roster completes without a recursive
    policy error. This test exists because the naive policy formulation fails here (R9).
11. **SC-015** — after `withdraw_consent` for L1, no row referencing L1 remains in `profiles`,
    `consent_records`, `enrolments`, `projects`, `training_runs`, `lesson_progress`, or
    `reflections`.
12. **SC-016** — the educator roster view and the classroom export contain L1's alias and contain
    neither her email address nor her `date_of_birth`.
13. **Definer hygiene** — every `SECURITY DEFINER` function has an explicit `search_path`.
