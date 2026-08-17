---
description: "Task list for feature implementation"
---

# Tasks: Explainable AI Lab

**Input**: Design documents from `/specs/001-xai-lab/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are **included and mandatory**. Constitution v2.0.0 Principle VI requires the
ML core to be tested before any interface is wired to it, and the row-level-security policies are the
project's entire authorisation model, so their tests are contracts rather than extras.

**Organization**: Grouped by user story so each can be implemented, tested, and demonstrated
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to
- Paths are repository-relative, per the single-project structure in plan.md

---

## Phase 1: Setup

**Purpose**: A buildable, lintable, testable skeleton.

- [ ] T001 Scaffold Vite + React 19 + TypeScript at the repository root; one `package.json`, strict `tsconfig.json` (Principle VII)
- [ ] T002 [P] Install runtime dependencies: `react-router`, `zustand`, `@tanstack/react-query`, `tailwindcss`, `react-i18next`, `i18next`, `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-wasm`, `dexie`, `@supabase/supabase-js`, `zod`, `@fontsource-variable/poppins`, `@fontsource/rubik`
- [ ] T003 [P] Install dev dependencies: `vitest`, `@testing-library/react`, `jsdom`, `@playwright/test`, `@axe-core/playwright`, `eslint`, `typescript-eslint`, `prettier`, `supabase`
- [ ] T004 [P] Configure ESLint and Prettier; add the `no-raw-hex-or-font-family-in-components` rule (Principle V) and the `ml-core-import-boundary` rule forbidding DOM, network, and `src/features` imports inside `src/ml/` (Principle VI, contracts/ml-core.md)
- [ ] T005 [P] Add npm scripts from [quickstart.md](./quickstart.md): `typecheck`, `lint`, `test`, `test:ml`, `test:db`, `test:e2e`, `test:e2e:nowebgl`, `test:a11y`, `test:i18n`, `test:network`
- [ ] T006 [P] Write `scripts/fetch-backbone.mjs` to download MobileNet v1 alpha 0.50 and 0.25 from `storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_{alpha}_224/` into `public/models/`; wire as `npm run fetch:backbone` (R1)
- [ ] T007 [P] Create `.env.example` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DIGITAL_CONSENT_AGE=16`
- [ ] T008 [P] Configure Vitest projects: `jsdom` for components, `node` for `src/ml/`; configure Playwright with 360×740 and 1440×900 viewports plus fake-camera flags (R13)
- [ ] T009 Set up CI running every script from T005, with `test:ml`, `test:db`, `test:a11y`, `test:i18n`, and `test:network` as merge-blocking gates (Principle VI, Constitution → Quality Gates)

**Checkpoint**: `npm run typecheck && npm run lint && npm test` pass on an empty project.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Design system and i18n

- [ ] T010 [P] Write `src/styles/tokens.css` with the seven Technovation token groups from [research.md](./research.md) R12; annotate `--tv-amber` and `--tv-green` as fill/border-only (AA contrast)
- [ ] T011 [P] Map tokens into the Tailwind theme; self-host Poppins and Rubik via `@fontsource`; no runtime Google Fonts request (R12)
- [ ] T012 [P] Set up `src/lib/i18n.ts`: `en` as `fallbackLng`, `es` second, browser detection, `localStorage` persistence, namespaces per feature plus `lessons` (R11, FR-044)
- [ ] T013 [P] Write `tests/unit/i18n.test.ts` walking the `en` key tree and failing on any key missing from `es`; wire to `npm run test:i18n` (SC-005)
- [ ] T014 [P] Build shared primitives in `src/components/`: `Button`, `Meter`, `ProgressBar`, `Dialog`, `LanguageSwitcher`, `HeatmapCanvas`, `Legend` — mobile-first, keyboard-operable, tokens only

### ML core (test-first, Principle VI)

- [ ] T015 [P] Commit deterministic fixtures to `tests/fixtures/`: PNG images across three visually distinct classes, plus a Y4M video for the fake camera (R13)
- [ ] T016 Write failing tests in `tests/unit/backend.test.ts` for `initBackend` per contracts/ml-core.md: webgl → wasm → cpu, never throws, idempotent
- [ ] T017 Implement `src/ml/backend.ts` and `src/ml/types.ts` to satisfy T016 (R7, FR-047)
- [ ] T018 Write failing tests in `tests/unit/backbone.test.ts`: Layers model truncation at `conv_pw_13_relu`, embedding length 512 at alpha 0.50, determinism, graph-model rejection, `dispose()` restores `tf.memory().numTensors`
- [ ] T019 Implement `src/ml/backbone.ts` — `loadBackbone`, `embed`, `embedBatch`, `activation`, `warmUp`, `dispose` (R1, R2)
- [ ] T020 [P] Add the `tf.memory().numTensors` leak assertion helper in `tests/unit/helpers/memory.ts` and apply it to every ML test (R8)
- [ ] T021 Write failing tests in `tests/unit/train.test.ts`: rejects `classCount < 2` and empty classes; **trains imbalanced input without refusing** (FR-009); probabilities sum to 1 ± 1e-5; identical seed ⇒ identical output; abort leaves no tensors and saves no partial model
- [ ] T022 Implement `src/ml/head.ts` and `src/ml/train.ts` — frozen backbone, `GlobalAveragePooling2D → Dropout → Dense(100, relu) → Dropout → Dense(n, softmax)`, Adam 1e-3, fit on cached embeddings; training runs entirely on-device (FR-006, R2)
- [ ] T023 Implement `src/ml/predict.ts` — `classify`, `predictFromEmbedding`, ordered `ClassProbability[]`
- [ ] T024 Write failing tests in `tests/unit/metrics.test.ts`: square confusion matrix, rows sum to per-class counts, `imbalanceRatio`, and that `imbalanced` is **report-only and never gates training** (FR-021, FR-009)
- [ ] T025 Implement `src/ml/metrics.ts` — `evaluate` per contracts/ml-core.md

### Local storage

- [ ] T026 [P] Write failing tests in `tests/unit/db.test.ts` for obligations D1–D10 in [contracts/storage.md](./contracts/storage.md), including the D9 two-owner isolation case and the D7 mid-burst quota error
- [ ] T027 Implement `src/lib/db.ts` — Dexie v1 schema for `projects`, `classes`, `samples`, `models`, `explanations`, and the callable surface from contracts/storage.md
- [ ] T028 Implement `estimateStorage` / `requestPersistence` with the 80% warn and 95% refuse thresholds (D6, FR-049)

### Remote schema and policies

- [ ] T029 Write `supabase/migrations/0001_schema.sql` — the eight tables from [data-model.md](./data-model.md); **no `bytea` column anywhere** (G2)
- [ ] T030 Write `supabase/migrations/0002_rls.sql` — RLS enabled on every table plus every policy in [contracts/database.md](./contracts/database.md); helper functions `current_consent_state`, `is_educator_of`, `join_classroom`, `confirm_consent`, `withdraw_consent`, each `SECURITY DEFINER` with an explicit `search_path`
- [ ] T031 Write `supabase/seed.sql` — educator E1 with classroom K1, learner L1 enrolled, learner L2 in E2's classroom, pending learner L3
- [ ] T032 Write `tests/db/rls.test.ts` implementing **all thirteen** required scenarios from contracts/database.md, notably G3 pending-account denials (SC-014), K3 cross-educator denial (SC-011), cross-learner and cross-classroom read denial (FR-042), the `is_educator_of` non-recursion case (R9), and SC-015 residual-row deletion
- [ ] T033 [P] Implement `src/lib/supabase.ts` — typed client, generated database types, `VITE_` env validation via Zod

### Application shell

- [ ] T034 Set up React Router routes and the app shell: landing, auth, projects, lab, lessons, classroom; mobile-first layout stacking the lab's three panels below `md` (FR-045)
- [ ] T035 [P] Implement `src/lib/camera.ts` — `getUserMedia` lifecycle, device enumeration, front/rear switching, explicit permission-denied and no-device states (FR-005, Scenario 1.4)
- [ ] T036 [P] Write `tests/e2e/network.spec.ts` asserting that **no request body across the full journey carries image or model bytes**, proving images and models stay on the device; wire to `npm run test:network` (FR-048, SC-010, Principle I)

**Checkpoint**: ML core green with the leak assertion; all thirteen RLS scenarios pass; shell routes render in both locales.

---

## Phase 3: User Story 1 — Teach a model and watch it work (P1) 🎯 MVP

**Goal**: Capture into classes, train on-device, see live predictions.

**Independent Test**: Two classes, five samples each, Train, then present each subject and see the
right class lead — with no account, no lessons, no explanations.

### Tests

- [ ] T037 [P] [US1] `tests/integration/capture.test.tsx` — class create/rename/reorder/delete, duplicate name refused case-insensitively, live per-class counts, single sample delete (FR-001, FR-004)
- [ ] T038 [P] [US1] `tests/integration/training.test.tsx` — Train refused with an empty class **naming that class**; progress reported; cancellation works (Scenario 1.3, FR-007)
- [ ] T039 [P] [US1] `tests/e2e/us1-capture-train-predict.spec.ts` — full journey on the fake camera at both viewports; asserts confidences sum to 100% (Scenario 1.1)

### Implementation

- [ ] T040 [P] [US1] `src/features/projects/` — project list, create, open, delete with cascade (D1); storage-budget indicator
- [ ] T041 [US1] `src/features/capture/ClassList.tsx` — create, rename, reorder, delete; duplicate-name validation
- [ ] T042 [US1] `src/features/capture/CameraCapture.tsx` — live preview, single and press-and-hold burst capture, device switcher; **computes and stores the pooled embedding per sample at capture time** (FR-002, D4, R2)
- [ ] T043 [P] [US1] `src/features/capture/UploadSamples.tsx` — file-upload sample source so the lab works without a camera (FR-003)
- [ ] T044 [P] [US1] `src/features/capture/SampleGrid.tsx` — review and delete individual samples (FR-004)
- [ ] T045 [US1] `src/features/training/TrainPanel.tsx` — Train control, epoch progress, cancel; at most a few learner-comprehensible settings each with a default and a plain-language explanation (FR-008)
- [ ] T046 [US1] `src/features/testing/LivePrediction.tsx` — throttled 10 fps loop, predicted class, per-class confidence bars, single reused input buffer (R8, FR-011)
- [ ] T047 [US1] Permission and hardware states: denied, no device, camera busy — each explaining the cause and offering upload (Scenario 1.4)
- [ ] T048 [US1] Interrupted-training recovery — surface `listStaleTrainingModels`, offer restart, never load an unfinished model for inference (D5, FR-050)
- [ ] T049 [P] [US1] `en` and `es` strings for capture, training, and testing

**Checkpoint**: US1 is a complete, demonstrable product on its own. Validate against W1 in quickstart.md, including the SC-002 30 s budget on real hardware.

---

## Phase 4: User Story 2 — See where the model is looking (P2)

**Goal**: A Grad-CAM heat map over a frozen frame, for any class.

**Independent Test**: Freeze a frame, request an explanation, get a legible overlay with a legend; switch class and the map changes.

### Tests

- [ ] T050 [US2] `tests/unit/gradcam.test.ts` — **fails first**: asserts against a stored reference map within tolerance; asserts **different `classIndex` ⇒ different map** (the classic silent Grad-CAM bug); asserts all-zero-gradient safety instead of divide-by-zero; asserts 7 vs 14 output width per target layer
- [ ] T051 [P] [US2] `tests/unit/colormap.test.ts` — inferno ramp is monotonic in lightness; opacity maps to alpha; legend stop count (R6, FR-019)
- [ ] T052 [P] [US2] `tests/e2e/us2-gradcam.spec.ts` — freeze, explain, switch class, adjust opacity; asserts the SC-003 1 s budget

### Implementation

- [ ] T053 [US2] `src/ml/explain/gradcam.ts` per contracts/ml-core.md: `A = truncated.predict(x)`, `tf.grad` over the head, spatial-mean channel weights, ReLU of the weighted sum, bilinear resize, normalise by own maximum, all inside `tf.tidy` (FR-013, R3)
- [ ] T054 [P] [US2] `src/ml/explain/colormap.ts` — build-time inferno lookup table, `applyColormap`, `legendStops` (R6)
- [ ] T055 [US2] `src/features/testing/FreezeFrame.tsx` — freeze, retain, and hash the frame for explanation caching (FR-012, D8)
- [ ] T056 [US2] `src/features/explaining/HeatmapView.tsx` — overlay on `HeatmapCanvas`, legend, class selector for **any** class (FR-016), opacity slider (FR-019), "finer detail" target-layer toggle (R3)
- [ ] T057 [US2] Text alternative describing where the strongest evidence falls, in plain positional language (FR-017, SC-009)
- [ ] T058 [US2] Explanation caching via `cacheExplanation` / `findExplanation` (D8)
- [ ] T059 [P] [US2] Framing copy that presents the map as **evidence, not the reason** for the decision (FR-018, Principle III), in `en` and `es`

**Checkpoint**: US1 + US2 both work independently. Validate against W2.

---

## Phase 5: User Story 3 — Compare two explanations (P3)

**Goal**: Both methods on one frozen frame, with an agreement figure and honest handling of disagreement.

**Independent Test**: Open the comparison view; both maps render, an agreement band is reported, and disagreement is stated rather than hidden.

### Tests

- [ ] T060 [US3] `tests/unit/occlusion-reference.test.ts` — **the highest-value test in the project**: the batched implementation must agree within tolerance with a naive one-variant-at-a-time reference implementation, and must be asserted to use batched calls by call count (R4, R13)
- [ ] T061 [P] [US3] `tests/unit/occlusion.test.ts` — cell value is the clamped probability drop; `onProgress` fires per chunk; `AbortSignal` cancels leaving no tensors
- [ ] T062 [P] [US3] `tests/unit/agreement.test.ts` — Spearman and top-20% IoU on constructed maps; band thresholds at 0.6 and 0.2; differing native resolutions are resampled, not rejected (R5)
- [ ] T063 [P] [US3] `tests/e2e/us3-compare.spec.ts` — both maps render, agreement band shown, occlusion cancellable, SC-003 5 s budget

### Implementation

- [ ] T064 [US3] `src/ml/explain/occlusion.ts` — port `computeOcclusionHeatmap`, `normalizeHeatmap`, `paintHeatmap` from `../EjemploXAI/app.js` to TypeScript, replacing the detector confidence with the classifier's class probability and **stacking all variants in a batched forward pass**, chunked at 24 (FR-014, R4)
- [ ] T065 [P] [US3] `src/ml/explain/agreement.ts` — resample both maps to 14×14, Spearman correlation, top-k IoU, three-band classification (R5)
- [ ] T066 [US3] `src/features/explaining/CompareView.tsx` — both maps for the same class side by side below `md`, columns above, with the agreement figure (FR-015); per-method progress; cancel control
- [ ] T067 [US3] Agreement presentation — the plain-language band sentence, and an **explicit statement on disagreement that neither map is guaranteed correct**; must not blend the two maps (FR-018)
- [ ] T068 [P] [US3] `en` and `es` strings for the comparison view and the three bands

**Checkpoint**: The full XAI experience works without an account. Validate against W3, including the induced-disagreement case.

---

## Phase 6: User Story 4 — Keep an account and come back to my work (P4)

**Goal**: Self sign-up with an email, the age gate and consent state machine, and project restoration.

**Independent Test**: Sign up, create a project, log out and back in, find it intact; separately, sign up under-age and confirm the pending-account behaviour.

### Tests

- [ ] T069 [P] [US4] `tests/integration/auth.test.tsx` — sign-up, login, password reset, impossible date of birth refused (Edge Cases)
- [ ] T070 [P] [US4] `tests/integration/consent.test.tsx` — the full state machine from data-model.md: `pending → active` on confirmation, `active → withdrawn`, rate-limited resend, guardian-address correction, indefinite pending without nagging
- [ ] T071 [P] [US4] `tests/e2e/us4-accounts.spec.ts` — Scenarios 4.1–4.10, including the pending account completing all of W1–W3 with **zero remote rows written** (SC-014)
- [ ] T072 [P] [US4] `tests/e2e/us4-no-pii.spec.ts` — no view or export exposes a real name or email address (SC-016)

### Implementation

- [ ] T073 [US4] `src/features/auth/` — sign-up with email, password, alias, role, and a required date-of-birth declaration; login; password reset; the alias is the only identifier shown to other users (FR-024, FR-025, FR-026)
- [ ] T074 [US4] Derive `consent_state` at sign-up from the declared date of birth against `VITE_DIGITAL_CONSENT_AGE`; **never client-writable** (P4 in contracts/database.md)
- [ ] T075 [US4] Pending-account experience — full local lab, no remote persistence, and a plain **non-shaming** explanation of why nothing is saved and what would change it (FR-027, FR-030)
- [ ] T076 [US4] Guardian consent request flow — send, resend under rate limit, correct a bouncing address (FR-028, C4, Edge Cases)
- [ ] T077 [US4] `confirm_consent` and `withdraw_consent` client flows; withdrawal deletes every remote row (FR-029, SC-015)
- [ ] T078 [US4] Remote/local project reconciliation — a remote row with no local record explains that samples stay on the capturing device and offers a fresh copy; restores the project list, class names, sample counts, and model status on the capturing device (FR-031, FR-032, Scenario 4.7)
- [ ] T079 [P] [US4] Anonymous-session banner stating plainly that nothing will be saved (FR-023, Scenario 4.9)
- [ ] T080 [P] [US4] `en` and `es` strings for auth, the age gate, and every consent state

**Checkpoint**: Accounts, the consent gate, and project restoration all work. Validate against W4.

---

## Phase 7: User Story 7 — Judge whether the model is good, and whether it is fair (P7)

> Sequenced before US5 because the fairness module (FR-036) consumes these views. It remains
> independently testable.

**Goal**: Per-class figures, the confusion breakdown, imbalance reporting, run comparison, model export.

**Independent Test**: Train on a deliberately skewed set; the figures, the confusion breakdown, and the imbalance notice all appear and are correct.

### Tests

- [ ] T081 [P] [US7] `tests/integration/results.test.tsx` — per-class counts and accuracy, confusion matrix orientation (rows = true), imbalance notice appears **and training still succeeded** (FR-009, Scenario 7.2)
- [ ] T082 [P] [US7] `tests/e2e/us7-fairness.spec.ts` — train 40-vs-5, assert the imbalance notice, the confusion pattern, and that the model is testable; then rebalance and compare runs
- [ ] T083 [P] [US7] `tests/integration/export.test.tsx` — the export dialog states what the file contains **before** producing it (FR-022, Scenario 7.4)

### Implementation

- [ ] T084 [US7] `src/features/results/ConfusionMatrix.tsx` — accessible table with a visual encoding; heat encoding follows the R6 ramp, not brand colours (Principle V)
- [ ] T085 [P] [US7] `src/features/results/ClassBalance.tsx` — per-class sample distribution shown in the training view (FR-020)
- [ ] T086 [US7] Imbalance reporting — plain-language explanation of the likely effect, a pointer to the fairness module, and **no blocking of training** (FR-021, FR-009)
- [ ] T087 [US7] `src/features/results/RunComparison.tsx` — two `training_runs` side by side, marking which classes changed (FR-010, Scenario 7.3)
- [ ] T088 [P] [US7] Model export — `tf` save to a downloadable file, preceded by a statement of contents (FR-022)
- [ ] T089 [P] [US7] Persist `training_runs` rows remotely for active accounts, including `per_class`, `confusion`, `imbalance_ratio`, `backbone_alpha` (data-model.md)
- [ ] T090 [P] [US7] `en` and `es` strings for results, imbalance, and export

**Checkpoint**: The evidence the fairness lesson argues from exists and is correct. Validate against W5 steps 2–4.

---

## Phase 8: User Story 5 — Follow the guided path (P5)

**Goal**: Seven modules with steps, challenges, and reflections; progress saved automatically.

**Independent Test**: Complete one module end to end and confirm progress and the reflection persist.

### Tests

- [ ] T091 [P] [US5] `tests/integration/lessons.test.tsx` — step completion autosaves, reflections are revisable in place (FR-035, L4), a module names the prerequisite step when its challenge is unavailable (FR-037)
- [ ] T092 [P] [US5] `tests/e2e/us5-learning-path.spec.ts` — module 1 end to end, then the fairness module's before-and-after comparison (FR-036)
- [ ] T093 [P] [US5] `tests/unit/lesson-content.test.ts` — every module has a goal, steps, a challenge, and at least one reflection question, in both locales (FR-034)

### Implementation

- [ ] T094 [US5] `src/content/lessons/` module definition schema — id slug, goal, ordered step slugs, challenge, reflection questions; locale-keyed, lazy-loaded per module (R11)
- [ ] T095 [US5] Author the seven modules required by FR-033: what the model sees · reading a heat map · shortcuts and bias (background, lighting, incidental cues) · fooling the model · comparing two explanations · **the imbalance experiment** · the final presentation challenge
- [ ] T096 [US5] `src/features/lessons/LearningPath.tsx` — module list with completion state (Scenario 5.1)
- [ ] T097 [US5] `src/features/lessons/ModuleView.tsx` — stepper, in-lab guidance, challenge, autosave (FR-035)
- [ ] T098 [US5] `src/features/lessons/Reflection.tsx` — write, store, revisit, revise (FR-035, L4)
- [ ] T099 [US5] Prerequisite handling — name the earlier step to complete (FR-037, Scenario 5.4)
- [ ] T100 [US5] Wire the fairness module to US7's run comparison for its explicit before-and-after (FR-036)
- [ ] T101 [P] [US5] `en` and `es` lesson content for all seven modules

**Checkpoint**: The tool has become a course. Validate against W5 in full.

---

## Phase 9: User Story 6 — Run a classroom (P6)

**Goal**: Classrooms, join codes, an educator roster, and export — with no image, name, or email exposure.

**Independent Test**: Create a classroom, join as a second account, complete a module, see it on the educator view, and confirm no image data is reachable.

### Tests

- [ ] T102 [P] [US6] `tests/integration/classroom.test.tsx` — create, join, leave, code regeneration and retirement (FR-038, FR-039, K4)
- [ ] T103 [P] [US6] `tests/e2e/us6-classroom.spec.ts` — Scenarios 6.1–6.5 including the cross-educator refusal (SC-011) and the absence of images, names, and emails in every view and export (FR-041, SC-016)
- [ ] T104 [P] [US6] Extend `tests/db/rls.test.ts` with the pending-account enrolment refusal (E6) and the one-classroom-per-learner constraint (E5)

### Implementation

- [ ] T105 [US6] `src/features/classroom/CreateClassroom.tsx` — create, display the join code, regenerate, retire (FR-038)
- [ ] T106 [US6] `src/features/classroom/JoinClassroom.tsx` — join via the `join_classroom` RPC; refuse a pending account with an explanation (FR-039, E6)
- [ ] T107 [US6] `src/features/classroom/Roster.tsx` — alias-only rows, module completion, accuracy figures (FR-040)
- [ ] T108 [US6] `src/features/classroom/LearnerDetail.tsx` — progress, recorded metrics, reflections; **structurally incapable of showing images** (FR-041)
- [ ] T109 [P] [US6] Classroom export — progress and reflections for the educator's own classroom only, alias-only (FR-043, SC-016)
- [ ] T110 [P] [US6] `en` and `es` strings for the classroom features

**Checkpoint**: The lab is workshop-ready. Validate against W6.

---

## Phase 10: User Story 8 — Do all of it on a phone (P8)

> Every prior story is built mobile-first, so this phase **verifies and completes** mobile support
> rather than retrofitting it. Its touch-specific affordances are genuine additions.

**Goal**: The complete journey in portrait on a phone, with nothing missing.

**Independent Test**: Run W1–W3 and US7 at 360×740 on a real touch device.

### Tests

- [ ] T111 [P] [US8] `tests/e2e/us8-mobile.spec.ts` at 360×740 — the complete journey; asserts no horizontal scroll and no clipped controls (SC-004)
- [ ] T112 [P] [US8] `tests/e2e/us8-orientation.spec.ts` — rotate mid-session; no samples, models, or explanations lost (Scenario 8.3)
- [ ] T113 [P] [US8] `tests/e2e/a11y.spec.ts` — `axe` across the primary journey at both viewports, **zero violations**; plus a keyboard-only pass (SC-009, FR-046)

### Implementation

- [ ] T114 [US8] Audit and fix every layout at 360 px; verify the lab's three panels stack correctly below `md` (FR-045)
- [ ] T115 [US8] Camera switching on mobile — front/rear, preserving already-captured samples (Scenario 8.2)
- [ ] T116 [US8] Touch burst capture and a minimum 44 px touch target on every control (Scenario 8.4)
- [ ] T117 [US8] Orientation-change resilience — preserve session state across rotation (Scenario 8.3)
- [ ] T118 [US8] Mobile performance pass — measure SC-002's 90 s phone budget and SC-003 on real mid-range hardware; if missed, reduce capture resolution or the occlusion grid on small screens (R5c/R7)

**Checkpoint**: All eight stories work on a phone. Validate against W7.

---

## Phase 11: Polish & Cross-Cutting

- [ ] T119 Bundle budget — initial route JavaScript under 200 KB compressed, TensorFlow.js and the backbone lazy-loaded on lab entry; verify SC-008's 3 s interactive budget on a mid-range phone
- [ ] T120 [P] WebGL-disabled suite — `npm run test:e2e:nowebgl` proving the SC-012 4× budget (R7, FR-047)
- [ ] T121 [P] Storage-pressure suite — the 80% warning, the 95% refusal, and the D7 mid-burst quota error preserving already-written samples (FR-049)
- [ ] T122 [P] Offline behaviour — local projects remain fully usable with an expired session (Edge Cases)
- [ ] T123 Netlify deployment with the strict CSP from R14: `connect-src` limited to the Supabase project, `wasm-unsafe-eval` for the WASM backend, no third-party origins
- [ ] T124 [P] `README.md` and `CONTRIBUTING.md` — setup, the `src/ml/` import boundary, and the token rules, written for student and volunteer contributors (Principle VII)
- [ ] T125 [P] Classroom review of all seven modules by someone with teaching experience; a technically correct lesson that does not teach is a defect (Constitution → Quality Gates)
- [ ] T125b Pilot session with 8–12 real participants, measuring the three learner-outcome criteria that only observation can establish: unaided completion of module 1 (SC-007), correct identification of the induced background shortcut and of the imbalance effect (SC-006), and time to first prediction (SC-001). Feed the failures back as new tasks rather than treating the numbers as met
- [ ] T126 Full `quickstart.md` pass — W1–W8 on a real laptop **and** a real phone, with every SC-001…SC-016 checked off
- [ ] T127 Resolve `TODO(CONSENT_MECHANISM)` and `TODO(TECHNOVATION_TRADEMARK)` — **blocks public launch, blocks nothing in development**

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: no dependencies
- **Phase 2 (Foundational)**: needs Phase 1; **blocks every user story**
- **US1 (Phase 3)**: needs Phase 2
- **US2 (Phase 4)**: needs US1 — nothing to explain without a trained model
- **US3 (Phase 5)**: needs US2 — the comparison presupposes one method exists
- **US4 (Phase 6)**: needs Phase 2 only; **can run in parallel with US1–US3** (different files, and FR-023 makes the lab work unauthenticated)
- **US7 (Phase 7)**: needs US1
- **US5 (Phase 8)**: needs US4 for progress persistence and US7 for the fairness module's evidence
- **US6 (Phase 9)**: needs US4 and US5
- **US8 (Phase 10)**: needs US1–US3 to exist; verification is continuous, not deferred
- **Phase 11 (Polish)**: needs every story intended for release

### Within each story

- Every test task is written **before** its implementation task and must fail first
- ML core (`src/ml/`) precedes the features that consume it
- Database policies precede the features that rely on them
- Locale strings ship **with** their feature, never after it

### Parallel opportunities

- T002–T008 concurrently
- T010–T014 (design system, i18n, primitives) concurrently
- T026 and T029–T031 (local storage and remote schema) concurrently — different stores
- **US4 concurrently with US1–US3** — the largest available parallel win
- All tasks marked `[P]` within a phase
- Every `en`/`es` string task alongside its feature

### Parallel example: Phase 2 opening

```bash
Task: "T010 Technovation tokens in src/styles/tokens.css"
Task: "T012 i18n setup in src/lib/i18n.ts"
Task: "T015 deterministic fixtures in tests/fixtures/"
Task: "T029 Postgres schema in supabase/migrations/0001_schema.sql"
```

---

## Implementation Strategy

### MVP first

Phase 1 → Phase 2 → Phase 3 (US1) → **stop and validate against W1**. That alone is a working
teach-the-computer tool worth demonstrating.

### Recommended increments

1. Setup + Foundational → foundation ready
2. **+ US1** → demo: a model trained in the browser (MVP)
3. **+ US2** → demo: the heat map. *This is the point at which the product becomes about explainable
   AI and is the most compelling single demo in the plan.*
4. **+ US3** → demo: two explanations that sometimes disagree
5. **+ US4** → work persists; the consent gate is in place
6. **+ US7** → metrics and fairness evidence
7. **+ US5** → the guided course
8. **+ US6** → classroom-ready
9. **+ US8 and Polish** → release candidate

### Parallel team strategy

After Phase 2: one developer on US1 → US2 → US3 (the ML and explanation spine), a second on US4 →
US6 (accounts, consent, classrooms), a third on lesson content for US5 and the US7 results views.
US8 and accessibility are everyone's continuous responsibility, not a phase to be pushed to the end.

---

## Notes

- `[P]` means different files with no dependency between them
- Every task cites the requirement, contract obligation, or research decision it satisfies, so
  `/speckit-analyze` can verify traceability in both directions
- Commit after each task or logical group
- Any checkpoint is a valid place to stop and demonstrate
- Three tasks are worth defending against schedule pressure: **T060** (occlusion vs. reference),
  **T050** (Grad-CAM class sensitivity), and **T032/T036** (RLS denials and the no-image-egress
  assertion). Each catches a failure that is invisible to manual testing
