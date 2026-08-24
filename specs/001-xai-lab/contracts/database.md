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
| **G3** | No column anywhere may hold a learner's email address, date of birth, or real name. Enforced by the same `information_schema.columns` inspection, by type and by name pattern. |
| **G4** | Client access is via PostgREST and the listed RPCs only. No RPC is `SECURITY DEFINER` unless named as such below. |
| **G5** | Every RPC validates its own arguments; a client is assumed hostile. |
| **G6** | No client-side insert into `profiles` succeeds. An account comes into existence only through `redeem_invitation`. |

G3 replaces the consent gate that stood here in an earlier revision. That gate existed to stop a
pending account persisting data; there is no pending state now because there is no personal datum to
gate. The guarantee is stronger and cheaper: a column that cannot exist cannot leak, and a structural
assertion cannot be forgotten the way a per-table policy can.

---

## Helper functions

```sql
-- True when the caller is the educator of a classroom that learner_id is enrolled in.
-- SECURITY DEFINER is REQUIRED: a policy on `enrolments` that itself selects from
-- `enrolments` recurses and fails at runtime (R9).
create function public.is_educator_of(learner_id uuid) returns boolean

-- === Issuing invitations. Each returns the plaintext code EXACTLY ONCE. ===

-- Caller must own the classroom. Fails if the username already exists (Edge Cases).
create function public.issue_learner_invitation(classroom uuid, username text) returns text

-- Caller must be an administrator.
create function public.issue_educator_invitation(email text) returns text

-- Caller must be the educator of `learner`. Issues a purpose='password_reset' invitation.
create function public.issue_password_reset(learner uuid) returns text

-- === Redeeming and revoking ===

-- The ONLY writer of `profiles`. Validates the code, creates the account with the
-- caller-supplied password, sets the alias, and enrols into invitations.classroom_id.
-- Refuses an expired, redeemed, or revoked code, saying which — without revealing
-- whether the target username exists.
create function public.redeem_invitation(code text, password text, alias text) returns uuid

-- Caller must be the issuer. Refuses an already-redeemed invitation.
create function public.revoke_invitation(id uuid) returns void

-- === Destructive actions ===

-- Caller must be the educator of `learner`. Deletes every remote row for that profile.
create function public.delete_learner(id uuid) returns void

-- Caller must be an administrator. Sets is_active = false. Refuses if the target is the
-- last remaining active administrator (FR-056).
create function public.deactivate_educator(id uuid) returns void

-- Caller must be an administrator. Moves a classroom to another active educator, so that
-- deactivating an educator never strands a group of learners (FR-057).
create function public.reassign_classroom(classroom uuid, to_educator uuid) returns void
```

`delete_learner`, `deactivate_educator`, and `reassign_classroom` are the three irreversible actions,
and each MUST append its own `audit_log` row in the same transaction as its effect (FR-058). Writing
the audit row outside the transaction would allow the effect to succeed while the record is lost,
which is the one failure mode the audit exists to prevent.

Each `SECURITY DEFINER` function must set `search_path = public, pg_temp` explicitly — omitting it
is a privilege-escalation vector.

These functions are the entire privileged surface of the system. Principle II forbids a
project-operated server, so provisioning privilege lives here, inside the database the BaaS already
runs, rather than in a serverless function holding a `service_role` key (R15). That makes each one a
security boundary: `G5` applies with full force, and every one of them must treat its caller as
hostile and re-derive the caller's identity from `auth.uid()` rather than trusting an argument.

---

## Per-table policies

### `profiles`

| # | Policy | Assertion |
|---|---|---|
| P1 | select own | Any account reads its own profile row. |
| P2 | select alias of classmates and educator | A learner may read `id`, `alias`, `display_name`, `role` of others in her classroom — **and no other column**. `username` is never readable by another learner. |
| P3 | educator select roster | An educator reads `id`, `username`, `alias`, `role`, `is_active` for learners enrolled in a classroom she owns, via `is_educator_of`. She sees the usernames she issued and no others. |
| P4 | update own, restricted | An account updates `alias` and `locale` only. `username`, `role`, and `is_active` are **not client-writable**. |
| P5 | no insert, no delete | Insertion happens only through `redeem_invitation` (G6); deletion only through `delete_learner`. Never a direct client `insert` or `delete`. |
| P6 | administrator select educators | An administrator reads `id`, `display_name`, `role`, `is_active` for rows where `role = 'educator'` — and **nothing** for rows where `role = 'learner'`. |

P4 matters for the same reason it always did, with a new target: a client-writable `role` would let
any learner promote herself to educator or administrator, and a client-writable `is_active` would let
a deactivated educator restore her own access.

P6 is the narrowest read policy in the schema, and deliberately so. An administrator exists to manage
who may run a classroom, not to look inside one. She is the only role whose definition is mostly a
list of things she cannot reach (FR-055, SC-018).

### `invitations`

| # | Policy | Assertion |
|---|---|---|
| I1 | issuer select own | The issuer reads the invitations she issued — `target`, `kind`, `purpose`, `expires_at`, `redeemed_at`, `revoked_at` — so she can show their state (FR-054, Scenario 6.2). |
| I2 | **`code_hash` never selectable** | No role, including the issuer, may select `code_hash`. The plaintext code is returned once by the issuing function and never again. |
| I3 | cross-issuer denial | An educator selecting another educator's invitations, or an administrator selecting an educator's learner invitations, returns zero rows. |
| I4 | insert and update via RPC only | Direct client `insert` or `update` is denied. Issuing, redeeming, and revoking all go through their named functions. |
| I5 | redemption is anonymous and rate-limited | `redeem_invitation` must be callable by a caller with no session, since the account being created does not exist yet. It MUST refuse after **5 failed attempts per hour per origin**, enforced here and not in the client, and MUST return an identical refusal whether or not the target username exists (FR-028, SC-020). |
| I6 | code shape | A code is **6 characters** over a 32-symbol alphabet excluding visually ambiguous characters (no `O`/`0`, no `I`/`1`/`l`), and `expires_at` is set to **72 hours** after issue (FR-028). |

I2 is the strictest rule in the schema. An invitation code is a bearer credential for creating an
account inside a named classroom; a readable table of live codes would let an outsider occupy one.

I5 carries more weight here than a rate limit usually does. At the 6-character length chosen in
FR-028 a code is about 30 bits, so roughly 360 guesses are available across its 72-hour life against
about a billion possibilities. The limit is therefore the primary defence rather than a secondary one,
which is why it is specified as a database obligation with its own test rather than an interface
courtesy — an interface-level throttle would be removed by anyone who cared to try.

### `audit_log`

| # | Policy | Assertion |
|---|---|---|
| U1 | **no select for anyone** | No role, including an administrator, may select any row. The log is read by direct database inspection during an incident, never through the application (FR-058). |
| U2 | insert from definer functions only | No client insert succeeds. Rows are written inside `delete_learner`, `deactivate_educator`, and `reassign_classroom`, in the same transaction as the effect. |
| U3 | no update, no delete | Append-only. Nothing may amend or remove a row, including the account that wrote it. |
| U4 | no personal data | No column may hold a learner email address, date of birth, real name, alias, or username — only opaque identifiers. Restates G3 for the one table most tempting to make human-readable. |

U1 is deliberate and worth defending against the obvious objection that an administrator should be
able to see the log. She should not: an entry such as "educator E deleted learner L" names a learner
account, which is exactly what FR-055 forbids her to reach. An audit screen would recreate through the
back door the one role this design exists to prevent.

### `classrooms`

| # | Policy | Assertion |
|---|---|---|
| K1 | educator full access to own | An educator selects, inserts, updates, and deletes only classrooms where `educator_id = auth.uid()`. |
| K2 | learner select enrolled, restricted | An enrolled learner reads `id` and `name` only. |
| K3 | cross-educator denial | An educator selecting a classroom she does not own returns zero rows (FR-042, SC-011). |
| K4 | archival | Setting `archived_at` hides the classroom from the active list without deleting it or affecting its enrolments or its learners' work (FR-038). |
| K5 | administrator select, column-limited | An administrator reads `id`, `name`, and `educator_id` **only** — the least she needs to reassign a classroom under FR-057. Every other column returns nothing, and no join from here reaches a learner, a project, or a reflection (FR-055, SC-018). |
| K6 | administrator update owner only | An administrator updates `educator_id` and nothing else, through `reassign_classroom`. She cannot rename, archive, or delete a classroom. |

### `enrolments`

| # | Policy | Assertion |
|---|---|---|
| E1 | insert via RPC only | Direct client insert is denied; enrolment is created by `redeem_invitation`. |
| E2 | select own | A learner reads her own enrolment. |
| E3 | educator select own classroom | Via `is_educator_of`, not a recursive subquery. |
| E4 | educator may delete | The owning educator removes a learner from her classroom, which deletes this row and **nothing else** — the learner's account, projects, progress, and reflections survive (FR-039, Edge Cases). |
| E5 | one classroom per learner | A unique constraint on `learner_id` refuses a second enrolment. |
| E6 | administrator denial | An administrator selecting any enrolment returns zero rows (FR-055, SC-018). |

### `projects`, `training_runs`

| # | Policy | Assertion |
|---|---|---|
| J1 | learner full access to own | Scoped to `owner_id = auth.uid()`. |
| J2 | educator read-only | An educator reads `projects` and `training_runs` of learners in her own classroom, and **cannot write them**. |
| J3 | cross-learner denial | Learner A reading learner B's project or run returns zero rows (FR-042). |
| J4 | no image column | Restates G2 for the two tables closest to image data. |
| J5 | administrator denial | An administrator selecting any project or training run returns zero rows (FR-055, SC-018). |

### `lesson_progress`, `reflections`

| # | Policy | Assertion |
|---|---|---|
| L1 | learner full access to own | Scoped to `learner_id = auth.uid()`. |
| L2 | educator read-only | Via `is_educator_of` (FR-040). |
| L3 | cross-learner denial | Learner A cannot read learner B's progress or reflections. |
| L4 | revise in place | A repeat answer to the same `(learner, module, question)` replaces rather than appends (FR-035). |
| L5 | administrator denial | An administrator selecting any progress row or reflection returns zero rows (FR-055, SC-018). |

---

## Required test scenarios (`tests/db/`)

**Twenty-two scenarios.** Each runs against a local Supabase instance seeded with: administrator A1;
educator E1 owning classroom K1; learners L1 and L1b enrolled in K1; educator E2 owning classroom K2
with learner L2 enrolled; and a pending, unredeemed invitation for each of the three kinds.

Schema-level guarantees:

1. **G2** — no `bytea` column and no image-shaped text column exists in any table.
2. **G3** — no column in any table holds a learner email address, date of birth, or real name, by
   type and by name pattern. Satisfies SC-017.
3. **Definer hygiene** — every `SECURITY DEFINER` function has an explicit `search_path`.
4. **FR-051** — a second profile with L1's `username` is refused by constraint; a second profile with
   L1's `alias` inside K1 is refused, while the same alias inside K2 is accepted.

Invitation lifecycle:

5. **FR-028 expired** — redeeming an invitation whose `expires_at` has passed is refused, and the
   refusal names expiry as the cause.
6. **FR-028 redeemed** — redeeming an already-redeemed invitation is refused as already used.
7. **FR-028 revoked** — after `revoke_invitation`, redemption is refused as revoked. Satisfies
   Scenario 9.3.
8. **I2** — no role, including the issuer, can select `code_hash` from any invitation.
9. **I3** — E2 selecting E1's invitations returns zero rows; A1 selecting E1's learner invitations
   returns zero rows.
10. **I5** — `redeem_invitation` with a wrong code does not disclose whether the target username
    exists, returning an identical refusal either way.
11. **G6/P5** — a direct client `insert` into `profiles` is denied for every role.
12. **FR-027** — no query available to E1, by policy or by RPC, returns anything from which L1's
    password could be read or derived.

Isolation between learners and educators:

13. **P2/P4** — L1 cannot read L1b's `username`; L1 cannot update her own `role` or `is_active`.
14. **K3** — E2 selecting classroom K1 returns zero rows. Satisfies SC-011.
15. **J2** — E1 can read L1's `training_runs` and cannot update them.
16. **J3/L3** — L2 reading any of L1's projects, runs, progress, or reflections returns zero rows.
17. **`is_educator_of` non-recursion** — E1 reading her full roster completes without a recursive
    policy error. This test exists because the naive policy formulation fails here (R9).

Destructive actions and administration:

18. **FR-052 / SC-015** — after `delete_learner(L1)`, no row referencing L1 remains in `profiles`,
    `invitations`, `enrolments`, `projects`, `training_runs`, `lesson_progress`, or `reflections`.
    Separately, E1 removing L1b from K1 deletes only the enrolment and leaves her other rows intact
    (E4).
19. **FR-055 / SC-018 and FR-056** — A1 selecting from `enrolments`, `projects`, `training_runs`,
    `lesson_progress`, and `reflections` returns zero rows in **every** case; from `classrooms` she
    reads `id`, `name`, and `educator_id` and **nothing else**; and `deactivate_educator` refuses when
    the target is the last active administrator.
20. **FR-057** — A1 calling `reassign_classroom(K1, E2)` succeeds; E2 then reads K1's full roster and
    progress, and E1 reads nothing of it. A1 attempting to rename, archive, or delete K1 is refused
    (K6).
21. **FR-058 / SC-019** — each of `delete_learner`, `deactivate_educator`, and `reassign_classroom`
    appends exactly one `audit_log` row in the same transaction as its effect. No role can select,
    update, or delete any row in that table (U1, U3), and no column holds a personal datum (U4).
22. **FR-028 / SC-020** — a sixth failed `redeem_invitation` from one origin within an hour is
    refused on rate-limit grounds, and the refusal for a non-existent username is byte-identical to
    the refusal for a wrong code against a real one.

Scenarios 19 and 21 are the ones to write first among the administration tests. An over-broad
administrator policy is the single easiest way to accidentally create a role that can read every
minor's work in the system, and an audit table left selectable is the second easiest — both would
recreate exactly what Principle I exists to prevent, and neither is visible from the interface.
