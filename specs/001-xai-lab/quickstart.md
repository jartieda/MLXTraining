# Quickstart & Validation Guide: Explainable AI Lab

**Feature**: `001-xai-lab` | **Date**: 2026-08-17 | **Plan**: [plan.md](./plan.md)

How to run the project and prove that each user story and success criterion actually holds. Every
section names the requirement it validates so a reviewer can check coverage rather than take it on
trust.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20.19+ or 22.12+ | Vite 7 requirement |
| npm | 10+ | Single package manifest (Principle VII) |
| Docker | any recent | Runs the local Supabase stack |
| Supabase CLI | 2+ | `supabase start`, migrations, RLS tests |
| Playwright browsers | installed via `npx playwright install` | End-to-end and accessibility runs |

---

## Setup

```bash
npm install
cp .env.example .env.local          # then fill in the values printed by `supabase start`
supabase start                      # local Postgres + Auth on :54321
supabase db reset                   # applies supabase/migrations, seeds test accounts
npm run fetch:backbone              # downloads MobileNet v1 alpha 0.50 into public/models/
npm run dev                         # http://localhost:5173
```

`.env.local` needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_INVITATION_TTL_HOURS`
(default `72` — how long an invitation or reset code stays redeemable, per FR-028).

`supabase db reset` seeds the fixtures every walkthrough below assumes: administrator **A1**;
educator **E1** owning classroom **K1** with learners **L1** and **L1b**; educator **E2** owning
classroom **K2** with learner **L2**; and one unredeemed invitation of each kind. There is no
self-service registration, so without this seed there is no way into the authenticated part of the
application — which is the point of the design, and worth knowing before you wonder why there is no
sign-up link.

`npm run fetch:backbone` self-hosts the model rather than fetching from Google at runtime (R1). It is
a prerequisite for anything in the lab working.

---

## Manual validation walkthroughs

### W1 — Capture, train, predict (User Story 1, SC-001, SC-002)

1. Open the app, skip sign-up, and start a new project.
2. Create classes `thumbs up` and `thumbs down`.
3. Allow camera access. Hold the burst-capture control for each class until roughly 30 samples each.
4. Press **Train**. Expect completion in **under 30 s** on a mid-range laptop.
5. Present each gesture. Expect the matching class to lead, with confidences summing to 100%.

**Also check**: pressing Train with an empty class is refused and the empty class is *named*
(Scenario 1.3). Denying camera permission produces an explanation plus a working file-upload path
(Scenario 1.4, FR-003).

### W2 — Grad-CAM (User Story 2, SC-003)

1. With the W1 model, freeze a frame and request an explanation.
2. Expect a heat map plus a legend within **1 s**, with the explained class named on screen.
3. Switch the explained class. The map must **change** — an unchanged map means the class index is
   being ignored, which is the classic silent Grad-CAM bug.
4. Drag the overlay opacity to each extreme; the underlying photo must be clear at one end and the
   map clear at the other (FR-019).
5. With a screen reader, confirm a plain-language description of where the evidence concentrates
   (FR-017).

### W3 — Comparing two explanations (User Story 3, SC-003)

1. On the same frozen frame, open the comparison view.
2. Both maps render for the same class. Occlusion completes in **under 5 s**, showing progress and
   remaining cancellable.
3. An agreement figure and its plain-language band appear.
4. Force disagreement: train on a set where the background differs systematically between classes.
   The view must **state** that the methods disagree and that neither is guaranteed correct (FR-018).
5. Cancel a running occlusion mid-way. The interface stays responsive and no partial map is shown.

### W4 — Invitations and accounts (User Story 4, SC-014, SC-015, SC-016)

1. Confirm there is **no** sign-up link anywhere in the interface, and that no URL reaches a
   completable registration form without a code (FR-024).
2. As E1, issue a learner invitation with a username. Expect a single-use code shown **once**, and
   the pending invitation listed with its state (Scenario 6.2).
3. Redeem it in a fresh browser profile: set a password, choose an alias. Expect an immediately
   usable account and an empty project list (Scenario 4.1).
4. Try to redeem the same code again. Expect a refusal that says it has already been used
   (FR-028).
5. Issue a second invitation, revoke it as E1, then attempt redemption. Expect a refusal that says it
   was revoked. Then set an invitation's `expires_at` into the past in the database and attempt
   redemption: expect a refusal that says it expired. All three refusals must be distinguishable, and
   none may reveal whether the username exists.
6. As E1, use the interface and the database to look for the learner's password. It must be
   unreachable in both (Scenario 4.4, FR-027).
7. As the learner, forget the password. Expect a plain statement that only her educator can issue a
   new code, and no dead "forgot password" link. As E1, issue a reset code; the learner sets a new
   password and regains access, with **no email sent to anyone** (Scenario 4.3, FR-030).
8. Without any account at all, complete W1–W3 as an anonymous visitor. Then query the local Supabase:
   **zero rows** written on that visitor's behalf anywhere (SC-014).
9. As E1, delete the learner's account. Re-query: **no residual row** for that profile in any table
   (SC-015). Confirm the learner is told her local samples and models are still hers to delete.
10. Log in as L1 on a second browser profile and open a project. Expect the explanation that samples
    and models stay on the device where they were captured (FR-032) — not an error.

### W5 — Learning path and the imbalance experiment (User Stories 5 & 7, SC-006)

1. Open the learning path as L1. Work module 1 end to end; progress saves without an
   explicit action.
2. Open the fairness module. Follow it to train deliberately with roughly 40 samples in one class and
   5 in another.
3. Expect: training **succeeds** (FR-009 — the lab must never block this), an imbalance notice
   appears, the confusion breakdown shows the minority class being lost to the majority, and the heat
   map for the minority class is visibly more diffuse.
4. Rebalance, retrain, and open the run comparison. Both runs' figures appear side by side (FR-010,
   FR-036).
5. Answer the reflection question, navigate away, return, and revise it (FR-035).

### W6 — Classroom (User Story 6, SC-011, SC-013)

1. As E1, create a classroom and issue your first learner invitation. Both together in **under 3
   minutes** of total effort (SC-013).
2. Redeem the invitation as a learner. She appears on the roster **by alias**.
3. Complete a module as that learner. It appears on the educator's view with her accuracy figures and
   reflections.
4. Search the entire educator view and the exported file for an image, a real name, an email address,
   or another learner's username. There must be none (FR-041, SC-016).
4b. Before exporting, answer a reflection with text containing a comma, a double quote, a line break,
   and a leading `=`. Export, then open the CSV in a spreadsheet application: every character must
   survive, one row per learner and module, and **no cell may be interpreted as a formula** (SC-021).
   This is the only export path where the input is written by a child and read by an adult's
   spreadsheet, so it is the only one where the input is hostile by default.
5. As E2, attempt to open classroom K1. Access is refused (SC-011).
6. Remove L1b from K1. She disappears from the roster, and logging in as her confirms her account,
   projects, and reflections are all intact (FR-039).
7. Archive the classroom. It leaves the active list while its enrolments and its learners' work
   survive (FR-038).

### W7 — Mobile (User Story 8, SC-004)

Run at 360×740 on a real touch device:

1. Complete W1–W3 entirely in portrait. No horizontal scrolling, no clipped controls.
2. Switch between front and rear cameras; previously captured samples are unaffected.
3. Rotate mid-session; nothing is lost.
4. Confirm press-and-hold burst capture works by touch and every target is comfortably tappable.

### W8 — Degraded environments (SC-012, FR-047, FR-049)

1. Launch Chrome with WebGL disabled. The lab still works, warns that it will be slower, and trains
   within **4×** the accelerated time.
2. Fill the storage quota to above 80%. A warning appears; above 95% new captures are refused with an
   offer to delete a project.
3. Reload the page mid-training. On return the lab reports training did not finish and offers a
   restart — it must never present the half-trained model as ready (FR-050).
4. Go offline with an expired session. Local projects stay fully usable.

### W9 — Administration (User Story 9, SC-018)

1. Sign in as A1. Expect an administration area and nothing else — no classroom, no learner, no
   project, no lesson.
2. Invite an educator by email address. Expect a single-use code shown once and a pending invitation
   in the list (Scenario 9.1).
3. Redeem it in a fresh browser profile: the educator sets her own password and display name, and the
   invitation shows as redeemed (Scenario 9.2).
4. Invite a second educator and revoke before redemption. Redemption is then refused and says so
   (Scenario 9.3).
5. Deactivate an educator. She can no longer sign in, while her classrooms and her learners' work are
   untouched (Scenario 9.4).
6. Reassign her classroom to another active educator. The new educator sees the full roster and its
   progress; the deactivated one sees nothing. Attempt to rename, archive, or delete that classroom as
   A1 — all refused (FR-057, Scenario 9.5).
7. Query the database as A1's role and attempt to select from `enrolments`, `projects`,
   `training_runs`, `lesson_progress`, and `reflections`. **Zero rows in every case**; from
   `classrooms` expect exactly `id`, `name`, and `educator_id` and nothing more (SC-018). Do this
   against the database rather than through the interface: a too-broad administrator policy is the
   easiest way to create the one role that can read every minor's work in the system, and the
   interface would hide it.
8. Attempt to select from `audit_log` as every role in turn, including A1. **Zero rows every time**
   (FR-058). Then inspect it with database-owner privileges: steps 5 and 6 must each have left exactly
   one row, and no row may contain an alias, a username, or an email address (SC-019).
9. Make six failed redemption attempts in an hour with a script rather than the interface. The sixth
   must be refused on rate-limit grounds, and a refusal for a username that does not exist must be
   indistinguishable from one for a wrong code against a real username (SC-020).
10. As the only administrator, attempt to deactivate yourself. Refused with an explanation (FR-056).

---

## Automated suites

```bash
npm run typecheck                # tsc --noEmit, strict
npm run lint                     # includes the import-boundary and no-raw-hex rules
npm test                         # Vitest: ML core + components
npm run test:ml                  # ML core only, cpu backend, seeded, with the leak assertion
npm run test:db                  # RLS policy contracts against local Supabase
npm run test:e2e                 # Playwright, 360x740 and 1440x900
npm run test:e2e:nowebgl         # SC-012 degraded path
npm run test:a11y                # axe over the primary journey, zero violations required
npm run test:i18n                # fails on any en key missing from es
npm run test:network             # asserts no request body carries image or model bytes
npm run build && npm run preview
```

### The four tests that matter most

1. **`test:ml` — occlusion vs. a naive reference.** The batched implementation is compared numerically
   against a slow one-variant-at-a-time version. A batching error still yields a plausible-looking
   heat map, so nothing else catches it (R13, and the reason Principle VI exists).
2. **`test:ml` — Grad-CAM class sensitivity.** Different `classIndex` values on the same image must
   produce different maps.
3. **`test:db` — the administrator denials and the invitation refusals.** Proves SC-018 and FR-028
   against a tampered client rather than against the shipped interface. Row-level security is the
   entire authorisation model, so these are not tests of a feature — they are the feature.
4. **`test:network` — no image ever leaves.** Proves SC-010, the constitution's non-negotiable core.

---

## Definition of done

| Gate | Check |
|---|---|
| Story coverage | W1–W9 pass on a real laptop **and** a real phone |
| Success criteria | Every SC-001…SC-021 has a passing manual walkthrough or automated test |
| Constitution | All seven principles pass against v3.1.0; `test:network`, `test:db`, `test:a11y`, `test:i18n` green |
| Performance | SC-002, SC-003, SC-008 and SC-012 measured on the three reference devices named in [spec.md](./spec.md) Assumptions — the reference laptop, the reference Chromebook, and the reference phone — on real hardware, not simulated |
| Privacy | `test:db` proves G3: no column anywhere can hold a learner email address, date of birth, or real name (SC-017) |
| Content | The seven modules reviewed by someone with classroom experience |
| Deferred | `TODO(CONTROLLER_AGREEMENT)` and `TODO(TECHNOVATION_TRADEMARK)` resolved **before public launch** — neither blocks development. `TODO(CONSENT_MECHANISM)` is closed |
