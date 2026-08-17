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

`.env.local` needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_DIGITAL_CONSENT_AGE` (default `16`; see the deferred legal question in
[research.md](./research.md)).

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

### W4 — Accounts and the consent gate (User Story 4, SC-014, SC-015, SC-016)

1. Sign up with a date of birth **above** the configured threshold. Expect an active account and an
   empty project list.
2. Sign up with a date of birth **below** it. Expect a pending account, a plain non-shaming
   explanation, and an option to email a guardian (FR-028, FR-030).
3. As the pending account, complete all of W1–W3. Then query the local Supabase: **zero rows** must
   exist for that account in `projects`, `training_runs`, `lesson_progress`, and `reflections`
   (SC-014).
4. Confirm consent via the token. The account becomes active and subsequent work is saved.
5. Withdraw consent. Re-query: **no residual row** anywhere for that profile (SC-015).
6. Log in on a second browser profile and open a project. Expect the explanation that samples and
   models stay on the device where they were captured (FR-032) — not an error.

### W5 — Learning path and the imbalance experiment (User Stories 5 & 7, SC-006)

1. Open the learning path as an active account. Work module 1 end to end; progress saves without an
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

1. Sign up as an educator; create a classroom. A join code appears in **under 3 minutes** of total
   effort.
2. Join as an active learner account. She appears on the roster **by alias**.
3. Complete a module as that learner. It appears on the educator's view with her accuracy figures and
   reflections.
4. Search the entire educator view and the exported file for an image, a real name, or an email
   address. There must be none (FR-041, SC-016).
5. As a second educator, attempt to open the first classroom. Access is refused (SC-011).
6. Retire the join code; a new join attempt fails while existing enrolments persist (FR-038).

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
3. **`test:db` — the pending-account denials.** Proves SC-014 against a tampered client rather than
   against the shipped interface.
4. **`test:network` — no image ever leaves.** Proves SC-010, the constitution's non-negotiable core.

---

## Definition of done

| Gate | Check |
|---|---|
| Story coverage | W1–W8 pass on a real laptop **and** a real phone |
| Success criteria | Every SC-001…SC-016 has a passing manual walkthrough or automated test |
| Constitution | All seven principles pass; `test:network`, `test:db`, `test:a11y`, `test:i18n` green |
| Performance | SC-002, SC-003, SC-008, SC-012 measured on real mid-range hardware, not simulated |
| Content | The seven modules reviewed by someone with classroom experience |
| Deferred | `TODO(CONSENT_MECHANISM)` and `TODO(TECHNOVATION_TRADEMARK)` resolved **before public launch** — neither blocks development |
