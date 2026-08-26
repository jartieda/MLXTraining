---
description: "Task list for feature implementation"
---

# Tasks: Explainable AI Lab

**Input**: Design documents from `/specs/001-xai-lab/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are **included and mandatory**. Constitution v3.1.0 Principle VI requires the
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

- [X] T001 Scaffold Vite + React 19 + TypeScript at the repository root; one `package.json`, strict `tsconfig.json` (Principle VII)
- [X] T002 [P] Install runtime dependencies in `package.json`: `react-router`, `zustand`, `@tanstack/react-query`, `tailwindcss`, `react-i18next`, `i18next`, `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-wasm`, `dexie`, `@supabase/supabase-js`, `zod`, `@fontsource/poppins`, `@fontsource/rubik` (plan.md → Primary Dependencies)
- [X] T003 [P] Install dev dependencies in `package.json`: `vitest`, `@testing-library/react`, `jsdom`, `@playwright/test`, `@axe-core/playwright`, `eslint`, `typescript-eslint`, `prettier`, `supabase` (plan.md → Testing)
- [X] T004 [P] Configure ESLint and Prettier in `eslint.config.js`; add the `no-raw-hex-or-font-family-in-components` rule (Principle V) and the `ml-core-import-boundary` rule forbidding DOM, network, and `src/features` imports inside `src/ml/` (Principle VI, contracts/ml-core.md)
- [X] T005 [P] Add npm scripts to `package.json` from [quickstart.md](./quickstart.md): `typecheck`, `lint`, `test`, `test:ml`, `test:db`, `test:e2e`, `test:e2e:nowebgl`, `test:a11y`, `test:i18n`, `test:network`
- [X] T006 [P] Write `scripts/fetch-backbone.mjs` to download MobileNet v1 alpha 0.50 and 0.25 from `storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_{alpha}_224/` into `public/models/`; wire as `npm run fetch:backbone` (R1)
- [X] T007 [P] Create `.env.example` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_INVITATION_TTL_HOURS=72` (FR-028)
- [X] T008 [P] Configure Vitest projects in `vitest.config.ts`: `jsdom` for components, `node` for `src/ml/`; configure `playwright.config.ts` with 360×740 and 1440×900 viewports plus fake-camera flags (R13)
- [X] T009 Set up CI in `.github/workflows/ci.yml` running every script from T005, with `test:ml`, `test:db`, `test:a11y`, `test:i18n`, and `test:network` as merge-blocking gates (Principle VI, Constitution → Quality Gates)
- [X] T009b [P] Vendor the occlusion prototype from `../EjemploXAI/app.js` into `docs/prototype/occlusion-prototype.js` with a README note on its provenance, so that T064's port has a committed source no contributor has to obtain separately (R4)

**Checkpoint**: `npm run typecheck && npm run lint && npm test` pass on an empty project.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Design system and i18n

- [X] T010 [P] Write `src/styles/tokens.css` with the seven Technovation token groups from [research.md](./research.md) R12; annotate `--tv-amber` and `--tv-green` as fill/border-only (AA contrast)
- [X] T011 [P] Map tokens into the Tailwind theme in `tailwind.config.ts`; self-host Poppins and Rubik via `@fontsource`; no runtime Google Fonts request (R12)
- [X] T012 [P] Set up `src/lib/i18n.ts`: `en` as `fallbackLng`, `es` second, browser detection, `localStorage` persistence, namespaces per feature plus `lessons` (R11, FR-044)
- [X] T013 [P] Write `tests/unit/i18n.test.ts` walking the `en` key tree and failing on any key missing from `es`; wire to `npm run test:i18n` (FR-044, SC-005)
- [X] T014 [P] Build shared primitives in `src/components/`: `Button`, `Meter`, `ProgressBar`, `Dialog`, `LanguageSwitcher`, `HeatmapCanvas`, `Legend`, `CopyToClipboard` — mobile-first, keyboard-operable, tokens only (FR-045, FR-046, Principle V)

### ML core (test-first, Principle VI)

- [X] T015 [P] Commit deterministic fixtures to `tests/fixtures/`: PNG images across three visually distinct classes, plus a Y4M video for the fake camera (R13)
- [X] T016 Write failing tests in `tests/unit/backend.test.ts` for `initBackend` per contracts/ml-core.md: webgl → wasm → cpu, never throws, idempotent (FR-047)
- [X] T017 Implement `src/ml/backend.ts` and `src/ml/types.ts` to satisfy T016, including the DOM-free `ImageSource` and `SpatialActivation` structures (R7, FR-047, contracts/ml-core.md)
- [X] T018 Write failing tests in `tests/unit/backbone.test.ts`: Layers model truncation at `conv_pw_13_relu`, embedding length 512 at alpha 0.5, determinism, graph-model rejection, `dispose()` restores `tf.memory().numTensors` (FR-006, R1)
- [X] T019 Implement `src/ml/backbone.ts` — `loadBackbone`, `embed`, `embedBatch`, `activation`, `warmUp`, `dispose`; accepts only `ImageSource`, never a DOM type (R1, R2, Principle VI)
- [X] T020 [P] Add the `tf.memory().numTensors` leak assertion helper in `tests/unit/helpers/memory.ts` and apply it to every ML test (R8)
- [X] T021 Write failing tests in `tests/unit/train.test.ts`: rejects `classCount < 2` and empty classes; **trains imbalanced input without refusing** (FR-009); probabilities sum to 1 ± 1e-5; identical seed ⇒ identical output; abort leaves no tensors and saves no partial model (FR-007)
- [X] T022 Implement `src/ml/head.ts` and `src/ml/train.ts` — frozen backbone, `GlobalAveragePooling2D → Dropout → Dense(100, relu) → Dropout → Dense(n, softmax)`, Adam 1e-3, fit on cached embeddings; training runs entirely on-device (FR-006, R2)
- [X] T023 Implement `src/ml/predict.ts` — `classify`, `predictFromEmbedding`, ordered `ClassProbability[]` (FR-011)
- [X] T024 Write failing tests in `tests/unit/metrics.test.ts`: square confusion matrix, rows sum to per-class counts, `imbalanceRatio`, and that `imbalanced` is **report-only and never gates training** (FR-021, FR-009)
- [X] T025 Implement `src/ml/metrics.ts` — `evaluate` per contracts/ml-core.md (FR-020)

### Local storage

- [X] T026 [P] Write failing tests in `tests/unit/db.test.ts` for obligations D1–D10 in [contracts/storage.md](./contracts/storage.md), including the D9 two-owner isolation case and the D7 mid-burst quota error (FR-049)
- [X] T027 Implement `src/lib/db.ts` — Dexie v1 schema for `projects`, `classes`, `samples`, `models`, `explanations`, and the callable surface from contracts/storage.md (FR-031)
- [X] T028 Implement `estimateStorage` / `requestPersistence` in `src/lib/db.ts` with the 80% warn and 95% refuse thresholds (D6, FR-049)

### Remote schema, functions and policies

- [X] T029 Write `supabase/migrations/0001_schema.sql` — the nine tables from [data-model.md](./data-model.md): `profiles`, `invitations`, `classrooms`, `enrolments`, `projects`, `training_runs`, `lesson_progress`, `reflections`, `audit_log`. **No `bytea` column anywhere** (G2), and no column able to hold a learner email, date of birth, or real name (FR-029, G3). Unique constraints for system-wide `username` and per-classroom `alias` (FR-051)
- [X] T029b Write `tests/db/schema.test.ts` inspecting `information_schema.columns` and failing if any column could hold image or weight data (G2) or a learner email address, date of birth, or real name (FR-029, G3, SC-017). This is a structural assertion, so it must pass before any policy work begins
- [X] T030 Write `supabase/migrations/0002_functions.sql` — the nine `SECURITY DEFINER` functions from [contracts/database.md](./contracts/database.md): `is_educator_of`, `issue_learner_invitation`, `issue_educator_invitation`, `issue_password_reset`, `redeem_invitation`, `revoke_invitation`, `delete_learner`, `deactivate_educator`, `reassign_classroom`. Each sets `search_path = public, pg_temp` explicitly and re-derives its caller from `auth.uid()` (R15, G4, G5)
- [X] T030b Implement invitation-code mechanics inside `0002_functions.sql`: a 6-character code over a 32-symbol alphabet excluding `O`/`0` and `I`/`1`/`l`, returned once and stored only as a hash, `expires_at` at `VITE_INVITATION_TTL_HOURS`, and refusal after 5 failed redemptions per hour per origin enforced **in the database** (FR-028, I5, I6, R15)
- [X] T030c Write the audit-log writes into `delete_learner`, `deactivate_educator`, and `reassign_classroom` in `0002_functions.sql`, each in the **same transaction** as its effect, holding opaque identifiers only (FR-058, U2, U4)
- [X] T031 Write `supabase/migrations/0003_rls.sql` — RLS enabled on every table plus every policy in contracts/database.md: `profiles` P1–P6, `invitations` I1–I6, `classrooms` K1–K6, `enrolments` E1–E6, `projects`/`training_runs` J1–J5, `lesson_progress`/`reflections` L1–L5, and `audit_log` U1–U4
- [X] T031b Write `supabase/seed.sql` — administrator A1; educator E1 owning classroom K1 with learners L1 and L1b; educator E2 owning classroom K2 with learner L2; and one unredeemed invitation of each kind. There is no self-registration, so this seed is the only way into the authenticated application
- [X] T032 Write `tests/db/rls.test.ts` implementing **all twenty-two** required scenarios from contracts/database.md. The five worth defending against schedule pressure: **scenario 19** (an administrator gets zero rows from every classroom-content table and only three columns from `classrooms`, SC-018), **scenario 21** (`audit_log` selectable by nobody, SC-019), **scenarios 5–7** (the three distinguishable invitation refusals, FR-028), **scenario 22** (the redemption rate limit and its indistinguishable refusals, SC-020), and **scenario 8** (`code_hash` never selectable by anyone, I2). Scenarios 14 and 16 carry the cross-educator and cross-learner denials that make FR-042 and SC-011 true against a tampered client
- [X] T033 [P] Implement `src/lib/supabase.ts` — typed client, generated database types, `VITE_` env validation via Zod (plan.md → Storage)

### Application shell

- [X] T034 Set up React Router routes and the app shell in `src/routes/` and `src/main.tsx`: landing, login, invitation redemption, projects, lab, lessons, classroom, admin; mobile-first layout stacking the lab's three panels below `md` (FR-045)
- [X] T035 [P] Implement `src/lib/camera.ts` — `getUserMedia` lifecycle, device enumeration, front/rear switching, explicit permission-denied and no-device states (FR-005, Scenario 1.4)
- [X] T036 [P] Write the harness for `tests/e2e/network.spec.ts` asserting that no request body carries image or model bytes, and wire it to `npm run test:network` (FR-048, SC-010, Principle I). **Scaffolding only at this phase** — no journey exists yet, so a passing run here proves nothing; T137 re-runs it across the complete journey

**Checkpoint**: ML core green with the leak assertion; the schema test and all twenty-two RLS
scenarios pass; shell routes render in both locales.

---

## Phase 3: User Story 1 — Teach a model and watch it work (P1) 🎯 MVP

**Goal**: Capture into classes, train on-device, see live predictions.

**Independent Test**: Two classes, five samples each, Train, then present each subject and see the
right class lead — with no account, no lessons, no explanations.

### Tests

- [X] T037 [P] [US1] `tests/integration/capture.test.tsx` — class create/rename/reorder/delete, duplicate name refused case-insensitively, live per-class counts, single sample delete (FR-001, FR-004)
- [X] T038 [P] [US1] `tests/integration/training.test.tsx` — Train refused with an empty class **naming that class**; progress reported; cancellation works (Scenario 1.3, FR-007)
- [X] T039 [P] [US1] `tests/e2e/us1-capture-train-predict.spec.ts` — full journey on the fake camera at both viewports; asserts confidences sum to 100% (Scenario 1.1, SC-002)

### Implementation

- [X] T040 [P] [US1] `src/features/projects/` — project list, create, open, delete with cascade (D1); storage-budget indicator (FR-049)
- [X] T041 [US1] `src/features/capture/ClassList.tsx` — create, rename, reorder, delete; duplicate-name validation (FR-001)
- [X] T042 [US1] `src/features/capture/CameraCapture.tsx` — live preview, single and press-and-hold burst capture, device switcher; **computes and stores the pooled embedding per sample at capture time** (FR-002, D4, R2)
- [X] T043 [P] [US1] `src/features/capture/UploadSamples.tsx` — file-upload sample source so the lab works without a camera; converts to `ImageSource` at this boundary, never inside `src/ml/` (FR-003)
- [X] T044 [P] [US1] `src/features/capture/SampleGrid.tsx` — review and delete individual samples (FR-004)
- [X] T045 [US1] `src/features/training/TrainPanel.tsx` — Train control, epoch progress, cancel; **at most three** learner-comprehensible settings each with a default and a plain-language explanation (FR-008)
- [X] T046 [US1] `src/features/testing/LivePrediction.tsx` — throttled 10 fps loop, predicted class, per-class confidence bars, single reused input buffer (R8, FR-011)
- [X] T047 [US1] Permission and hardware states in `src/features/capture/` — denied, no device, camera busy — each explaining the cause and offering upload (Scenario 1.4)
- [X] T048 [US1] Interrupted-training recovery in `src/features/training/` — surface `listStaleTrainingModels`, offer restart, never load an unfinished model for inference (D5, FR-050)
- [X] T049 [P] [US1] `en` and `es` strings in `src/locales/{en,es}/` for capture, training, and testing (FR-044, SC-005)

**Checkpoint**: US1 is a complete, demonstrable product on its own. Validate against W1 in
quickstart.md, including the SC-002 30 s budget on the reference laptop.

---

## Phase 4: User Story 2 — See where the model is looking (P2)

**Goal**: A Grad-CAM heat map over a frozen frame, for any class.

**Independent Test**: Freeze a frame, request an explanation, get a legible overlay with a legend;
switch class and the map changes.

### Tests

- [X] T050 [US2] `tests/unit/gradcam.test.ts` — **fails first**: asserts against a stored reference map within tolerance; asserts **different `classIndex` ⇒ different map** (the classic silent Grad-CAM bug); asserts all-zero-gradient safety instead of divide-by-zero; asserts 7 vs 14 output width per target layer (FR-013, FR-016, R3)
- [X] T051 [P] [US2] `tests/unit/colormap.test.ts` — inferno ramp is monotonic in lightness; opacity maps to alpha; legend stop count (R6, FR-019)
- [X] T052 [P] [US2] `tests/e2e/us2-gradcam.spec.ts` — freeze, explain, switch class, adjust opacity; asserts the SC-003 1 s budget on the reference laptop

### Implementation

- [X] T053 [US2] `src/ml/explain/gradcam.ts` per contracts/ml-core.md: `A = truncated.predict(x)`, `tf.grad` over the head, spatial-mean channel weights, ReLU of the weighted sum, bilinear resize, normalise by own maximum, all inside `tf.tidy` (FR-013, R3)
- [X] T054 [P] [US2] `src/ml/explain/colormap.ts` — build-time inferno lookup table, `applyColormap`, `legendStops` (R6, FR-017)
- [X] T055 [US2] `src/features/testing/FreezeFrame.tsx` — freeze, retain, and hash the frame for explanation caching (FR-012, D8)
- [X] T056 [US2] `src/features/explaining/HeatmapView.tsx` — overlay on `HeatmapCanvas`, legend, class selector for **any** class (FR-016), opacity slider (FR-019), "finer detail" target-layer toggle (R3)
- [X] T057 [US2] Text alternative in `src/features/explaining/` describing where the strongest evidence falls, in plain positional language (FR-017, SC-009)
- [X] T058 [US2] Explanation caching in `src/lib/db.ts` via `cacheExplanation` / `findExplanation`, storing the map at its **method-specific** native resolution (D8, data-model.md → explanations)
- [X] T059 [P] [US2] Framing copy in `src/locales/{en,es}/` that presents the map as **evidence, not the reason** for the decision (FR-018, FR-044, SC-005, Principle III)

**Checkpoint**: US1 + US2 both work independently. Validate against W2.

---

## Phase 5: User Story 3 — Compare two explanations (P3)

**Goal**: Both methods on one frozen frame, with an agreement figure and honest handling of
disagreement.

**Independent Test**: Open the comparison view; both maps render, an agreement band is reported, and
disagreement is stated rather than hidden.

### Tests

- [X] T060 [US3] `tests/unit/occlusion-reference.test.ts` — **the highest-value test in the project**: the batched implementation must agree within tolerance with a naive one-variant-at-a-time reference, and must be asserted to use batched calls by call count. Fixed at 144 variants for a 12×12 grid (R4, R13)
- [X] T061 [P] [US3] `tests/unit/occlusion.test.ts` — cell value is the clamped probability drop; output map is `gridSize × gridSize`, not 7 or 14; `onProgress` fires per chunk; `AbortSignal` cancels leaving no tensors (FR-014, R4)
- [X] T062 [P] [US3] `tests/unit/agreement.test.ts` — Spearman and top-20% IoU on constructed maps; band thresholds at 0.6 and 0.2; differing native resolutions are resampled, not rejected (FR-015, R5)
- [X] T063 [P] [US3] `tests/e2e/us3-compare.spec.ts` — both maps render, agreement band shown, occlusion cancellable, SC-003 5 s budget on the reference laptop
- [X] T064 [US3] `src/ml/explain/occlusion.ts` — port `computeOcclusionHeatmap`, `normalizeHeatmap` from `docs/prototype/occlusion-prototype.js` (vendored in T009b) to TypeScript, replacing the detector confidence with the classifier's class probability and **stacking all variants in a batched forward pass**, chunked at 24. Stride is one full cell — **no overlap** — so a 12×12 grid is exactly 144 variants (FR-014, R4)
- [X] T065 [P] [US3] `src/ml/explain/agreement.ts` — resample both maps to 14×14, Spearman correlation, top-k IoU, three-band classification (FR-015, R5)
- [X] T066 [US3] `src/features/explaining/CompareView.tsx` — both maps for the same class side by side below `md`, columns above, with the agreement figure (FR-015); per-method progress; cancel control
- [X] T067 [US3] Agreement presentation in `src/features/explaining/` — the plain-language band sentence, and an **explicit statement on disagreement that neither map is guaranteed correct**; must not blend the two maps (FR-018)
- [X] T068 [P] [US3] `en` and `es` strings in `src/locales/{en,es}/` for the comparison view and the three bands (FR-044, SC-005)

**Checkpoint**: The full XAI experience works without an account. Validate against W3, including the
induced-disagreement case.

---

## Phase 6: User Story 4 — Keep an account and come back to my work (P4)

**Goal**: Login, invitation redemption, learner-chosen passwords, and project restoration. No
sign-up exists.

**Independent Test**: Redeem an invitation, create a project, log out and back in, find it intact;
separately, attempt an expired, an already-redeemed, and a revoked code and get three
distinguishable refusals.

### Tests

- [X] T069 [P] [US4] `tests/integration/auth.test.tsx` — login; **no reachable registration form without a code** (FR-024); redemption sets the learner's own password and alias; a username is never rendered to another learner (FR-025, FR-027)
- [X] T070 [P] [US4] `tests/integration/invitation.test.tsx` — the three refusal cases are distinguishable in the interface, and a refusal for a non-existent username is identical to one for a wrong code (FR-028, Scenario 4.2)
- [X] T071 [US4] `tests/e2e/us4-accounts.spec.ts` — Scenarios 4.1–4.8. **Depends on US1–US3**: scenario 4.7 requires an anonymous visitor to complete the whole capture-train-explain journey with zero remote rows (SC-014)
- [X] T072 [P] [US4] `tests/e2e/us4-no-pii.spec.ts` — no view or export exposes a username, a real name, or an educator's email address to a learner (SC-016)

### Implementation

- [X] T073 [US4] `src/features/auth/Login.tsx` and `src/features/auth/session.ts` — sign-in for all three roles; a learner's credential is her username, mapped to the synthetic non-deliverable identifier at this boundary and never displayed (FR-024, R16)
- [X] T074 [US4] `src/features/auth/RedeemInvitation.tsx` — code entry with the unambiguous alphabet, then password and alias selection; calls `redeem_invitation`; surfaces the three refusals distinctly (FR-027, FR-028, R15)
- [X] T075 [US4] `src/features/auth/ResetPassword.tsx` — redeem an educator-issued reset code to set a new password. States plainly that only her educator can issue one, and shows **no dead "forgot password" link**, because there is no address to send to (FR-030, R16)
- [X] T076 [US4] Rate-limit feedback in `src/features/auth/` — when the database refuses on rate-limit grounds, say so without hinting whether the username exists (FR-028, SC-020)
- [X] T077 [US4] Remote/local project reconciliation in `src/features/projects/` — a remote row with no local record explains that samples stay on the capturing device and offers a fresh copy; restores project list, class names, sample counts, and model status on the capturing device. **Depends on US1** for the project list it restores into (FR-031, FR-032, Scenario 4.6)
- [X] T078 [P] [US4] Anonymous-session banner in `src/features/projects/` stating plainly that nothing will be saved (FR-023, Scenario 4.7)
- [X] T079 [P] [US4] Enforce alias uniqueness within a classroom at the point of choosing it, with a plain "pick another" message (FR-051, Edge Cases)
- [X] T080 [P] [US4] `en` and `es` strings in `src/locales/{en,es}/` for login, redemption, reset, and every refusal reason (FR-044, SC-005)

**Checkpoint**: Accounts, invitation redemption, and project restoration all work. Validate against
W4.

---

## Phase 7: User Story 7 — Judge whether the model is good, and whether it is fair (P7)

> Sequenced before US5 because the fairness module (FR-036) consumes these views. It remains
> independently testable.

**Goal**: Per-class figures, the confusion breakdown, imbalance reporting, run comparison, model
export.

**Independent Test**: Train on a deliberately skewed set; the figures, the confusion breakdown, and
the imbalance notice all appear and are correct.

### Tests

- [X] T081 [P] [US7] `tests/integration/results.test.tsx` — per-class counts and accuracy, confusion matrix orientation (rows = true), imbalance notice appears **and training still succeeded** (FR-009, FR-020, Scenario 7.2)
- [X] T082 [P] [US7] `tests/e2e/us7-fairness.spec.ts` — train 40-vs-5, assert the imbalance notice, the confusion pattern, and that the model is testable; then rebalance and compare runs (FR-010, FR-021)
- [X] T083 [P] [US7] `tests/integration/export.test.tsx` — the export dialog states what the file contains **before** producing it (FR-022, Scenario 7.4)

### Implementation

- [X] T084 [US7] `src/features/results/ConfusionMatrix.tsx` — accessible table with a visual encoding; heat encoding follows the R6 ramp, not brand colours (FR-020, Principle V)
- [X] T085 [P] [US7] `src/features/results/ClassBalance.tsx` — per-class sample distribution shown in the training view (FR-020)
- [X] T086 [US7] Imbalance reporting in `src/features/results/` — plain-language explanation of the likely effect, a pointer to the fairness module, and **no blocking of training** (FR-021, FR-009)
- [X] T087 [US7] `src/features/results/RunComparison.tsx` — two `training_runs` side by side, marking which classes changed (FR-010, Scenario 7.3)
- [X] T088 [P] [US7] Model export in `src/features/results/` — `tf` save to a downloadable file, preceded by a statement of contents (FR-022, FR-048)
- [X] T089 [P] [US7] Persist `training_runs` rows remotely for signed-in learners in `src/features/training/`, including `per_class`, `confusion`, `imbalance_ratio`, `backbone_alpha` (data-model.md)
- [X] T090 [P] [US7] `en` and `es` strings in `src/locales/{en,es}/` for results, imbalance, and export (FR-044, SC-005)

**Checkpoint**: The evidence the fairness lesson argues from exists and is correct. Validate against
W5 steps 2–4.

---

## Phase 8: User Story 5 — Follow the guided path (P5)

**Goal**: Seven modules with steps, challenges, and reflections; progress saved automatically.

**Independent Test**: Complete one module end to end and confirm progress and the reflection persist.

### Tests

- [X] T091 [P] [US5] `tests/integration/lessons.test.tsx` — step completion autosaves, reflections are revisable in place (FR-035, L4), a module names the prerequisite step when its challenge is unavailable (FR-037)
- [X] T092 [P] [US5] `tests/e2e/us5-learning-path.spec.ts` — module 1 end to end, then the fairness module's before-and-after comparison (FR-036)
- [X] T093 [P] [US5] `tests/unit/lesson-content.test.ts` — every module has a goal, steps, a challenge, and at least one reflection question, in both locales (FR-034)

### Implementation

- [X] T094 [US5] `src/content/lessons/schema.ts` module definition schema — id slug, goal, ordered step slugs, challenge, reflection questions; locale-keyed, lazy-loaded per module (R11, FR-034)
- [X] T095 [US5] Author the seven modules required by FR-033 in `src/content/lessons/`: what the model sees · reading a heat map · shortcuts and bias (background, lighting, incidental cues) · fooling the model · comparing two explanations · **the imbalance experiment** · the final presentation challenge
- [X] T096 [US5] `src/features/lessons/LearningPath.tsx` — module list with completion state (Scenario 5.1)
- [X] T097 [US5] `src/features/lessons/ModuleView.tsx` — stepper, in-lab guidance, challenge, autosave (FR-035)
- [X] T098 [US5] `src/features/lessons/Reflection.tsx` — write, store, revisit, revise (FR-035, L4)
- [X] T099 [US5] Prerequisite handling in `src/features/lessons/` — name the earlier step to complete (FR-037, Scenario 5.4)
- [X] T100 [US5] Wire the fairness module to US7's run comparison for its explicit before-and-after (FR-036)
- [X] T101 [P] [US5] `en` and `es` lesson content in `src/locales/{en,es}/lessons.json` for all seven modules (FR-044, SC-005)

**Checkpoint**: The tool has become a course. Validate against W5 in full.

---

## Phase 9: User Story 6 — Run a classroom (P6)

**Goal**: Classrooms, learner invitations, an educator roster, membership management, and CSV export
— with no image, name, or email exposure.

**Independent Test**: Create a classroom, invite and redeem as a second account, complete a module,
see it on the educator view, and confirm no image data is reachable.

### Tests

- [X] T102 [P] [US6] `tests/integration/classroom.test.tsx` — create, rename, archive; issue an invitation and see its state; revoke it; remove a learner; delete an account (FR-038, FR-039, FR-052, K4)
- [X] T103 [P] [US6] `tests/e2e/us6-classroom.spec.ts` — Scenarios 6.1–6.7 including the cross-educator refusal (SC-011) and the absence of images, names, emails, and usernames in every view and export (FR-041, SC-016)
- [X] T104 [P] [US6] `tests/integration/export-csv.test.tsx` — one row per learner and module with a reflection column; a **hostile reflection** containing a comma, a double quote, a line break and a leading `=` survives intact and is not interpretable as a formula (FR-043, SC-021)

### Implementation

- [X] T105 [US6] `src/features/classroom/CreateClassroom.tsx` — create, rename, archive; reaching a usable classroom with its first invitation in under 3 minutes (FR-038, SC-013)
- [X] T106 [US6] `src/features/classroom/InviteLearner.tsx` — assign a username, call `issue_learner_invitation`, show the code **once** with copy-to-clipboard and no email option, and refuse a username already taken (FR-026, FR-028, Edge Cases)
- [X] T107 [US6] `src/features/classroom/Roster.tsx` — alias-only rows for other learners, module completion, accuracy figures; pending invitations with their state (FR-040, FR-054)
- [X] T108 [US6] `src/features/classroom/LearnerDetail.tsx` — progress, recorded metrics, reflections; **structurally incapable of showing images** (FR-041)
- [X] T109 [US6] Membership and lifecycle actions in `src/features/classroom/` — issue a password reset (FR-030), remove a learner leaving her own rows intact (FR-039, E4), and delete an account removing every remote row (FR-052, SC-015)
- [X] T110 [P] [US6] Classroom CSV export in `src/features/classroom/export.ts` — progress and reflections for the educator's own classroom only, alias-only, with quoting and formula-prefix neutralisation (FR-043, SC-016, SC-021)
- [X] T110b [P] [US6] `en` and `es` strings in `src/locales/{en,es}/` for the classroom features (FR-044, SC-005)

**Checkpoint**: The lab is workshop-ready. Validate against W6.

---

## Phase 10: User Story 8 — Do all of it on a phone (P8)

> Every prior story is built mobile-first, so this phase **verifies and completes** mobile support
> rather than retrofitting it. Its touch-specific affordances are genuine additions.

**Goal**: The complete journey in portrait on a phone, with nothing missing.

**Independent Test**: Run W1–W3 and US7 at 360×740 on a real touch device.

### Tests

- [X] T111 [P] [US8] `tests/e2e/us8-mobile.spec.ts` at 360×740 — the complete journey; asserts no horizontal scroll and no clipped controls (SC-004, FR-045)
- [X] T112 [P] [US8] `tests/e2e/us8-orientation.spec.ts` — rotate mid-session; no samples, models, or explanations lost (Scenario 8.3)
- [X] T113 [P] [US8] `tests/e2e/a11y.spec.ts` — `axe` across the primary journey at both viewports, **zero violations**; plus a keyboard-only pass (SC-009, FR-046)

### Implementation

- [X] T114 [US8] Audit and fix every layout at 360 px; verify the lab's three panels stack correctly below `md` (FR-045)
- [X] T115 [US8] Camera switching on mobile in `src/lib/camera.ts` — front/rear, preserving already-captured samples (FR-005, Scenario 8.2)
- [X] T116 [US8] Touch burst capture and a minimum 44 px touch target on every control (Scenario 8.4, FR-046)
- [X] T117 [US8] Orientation-change resilience — preserve session state across rotation (Scenario 8.3)
- [X] T118 [US8] Mobile performance pass — measure SC-002's 90 s budget and SC-003 on the reference phone; if missed, reduce capture resolution or the occlusion grid on small screens (R4, R7)

**Checkpoint**: All eight stories work on a phone. Validate against W7.

---

## Phase 11: User Story 9 — Administer the program (P9)

> Sequenced last because a pilot runs from the seeded educator in T031b. This story blocks public
> operation, not any earlier demo.
>
> **Task IDs T128–T136 are deliberately out of sequence with Phase 12 below.** This phase was added
> after the original numbering, and renumbering Phase 12 would invalidate task references already in
> use. Position in the document, not the number, gives the order.

**Goal**: Administrator sign-in, educator invitations, deactivation, and classroom reassignment —
reaching no learner data at all.

**Independent Test**: Sign in as an administrator, invite an educator, redeem it, revoke a second
invitation, reassign a classroom, deactivate an account, and confirm no learner data is reachable
from any administration screen.

### Tests

- [X] T128 [P] [US9] `tests/integration/admin.test.tsx` — invite by email, educator list with invitation states, revoke an unredeemed invitation, deactivate, reassign (FR-053, FR-054, FR-057)
- [X] T129 [P] [US9] `tests/e2e/us9-admin.spec.ts` — Scenarios 9.1–9.7, including that the last administrator cannot deactivate herself (FR-056)
- [X] T130 [US9] `tests/e2e/us9-admin-isolation.spec.ts` — **the test that matters most in this phase**: no administration screen and no navigation from one reaches a learner, a project, a training run, a progress record, a reflection, a metric, or an image; a classroom appears only as a name and an owner (FR-055, SC-018)

### Implementation

- [X] T131 [US9] `src/features/admin/InviteEducator.tsx` — invite by email address via `issue_educator_invitation`; hand the code over with a `mailto:` link prefilled with recipient and message, falling back to copy-to-clipboard where no mail client is available. The application itself sends no email (FR-053, R15)
- [X] T132 [US9] `src/features/admin/EducatorList.tsx` — educators with `is_active`, and every invitation she issued with its state: issued, redeemed, expired, or revoked (FR-054)
- [X] T133 [US9] `src/features/admin/` revoke and deactivate actions — `revoke_invitation` on an unredeemed invitation, `deactivate_educator` with the last-administrator refusal surfaced plainly (FR-054, FR-056)
- [X] T134 [US9] `src/features/admin/ReassignClassroom.tsx` — move a classroom to another active educator via `reassign_classroom`, showing only its name and current owner. No rename, archive, or delete from here (FR-057, K6)
- [X] T135 [P] [US9] Route guards in `src/routes/` — an administrator cannot navigate to any lab, lesson, or classroom-content route; a learner or educator cannot reach `/admin` (FR-055)
- [X] T136 [P] [US9] `en` and `es` strings in `src/locales/{en,es}/admin.json` for invitations, states, and refusals (FR-044, SC-005)

**Checkpoint**: The program is operable by someone other than a developer. Validate against W9.

---

## Phase 12: Polish & Cross-Cutting

- [X] T119 Bundle budget — initial route JavaScript under 200 KB compressed, TensorFlow.js and the backbone lazy-loaded on lab entry; verify SC-008's 3 s interactive budget on the reference phone
- [ ] T120 [P] WebGL-disabled suite — `npm run test:e2e:nowebgl` proving the SC-012 4× budget on the reference Chromebook (R7, FR-047)
- [ ] T121 [P] Storage-pressure suite — the 80% warning, the 95% refusal, and the D7 mid-burst quota error preserving already-written samples (FR-049)
- [ ] T122 [P] Offline behaviour — local projects remain fully usable with an expired session (Edge Cases)
- [X] T123 Netlify deployment with the strict CSP from R14: `connect-src` limited to the Supabase project, `wasm-unsafe-eval` for the WASM backend, no third-party origins
- [ ] T124 [P] `README.md` and `CONTRIBUTING.md` — setup, the `src/ml/` import boundary, the token rules, and the fact that there is no self-registration so a seeded administrator is the only way in (Principle VII)
- [ ] T125 [P] Classroom review of all seven modules by someone with teaching experience; a technically correct lesson that does not teach is a defect (Constitution → Quality Gates)
- [ ] T125b Pilot session with 8–12 real participants, measuring the three learner-outcome criteria that only observation can establish: unaided completion of module 1 (SC-007), correct identification of the induced background shortcut and of the imbalance effect (SC-006), and time to first prediction (SC-001). Feed the failures back as new tasks rather than treating the numbers as met
- [ ] T126 Full `quickstart.md` pass — W1–W9 on the reference laptop, the reference Chromebook, **and** the reference phone, with every SC-001…SC-021 checked off
- [ ] T127 Resolve `TODO(CONTROLLER_AGREEMENT)` and `TODO(TECHNOVATION_TRADEMARK)` — **blocks public launch, blocks nothing in development**
- [ ] T137 Re-run `tests/e2e/network.spec.ts` across the **complete** W1–W9 journey and make it merge-blocking. T036 built the harness before any journey existed, where a pass proved nothing; this is where SC-010 is actually established (FR-048, SC-010, Principle I)

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: no dependencies
- **Phase 2 (Foundational)**: needs Phase 1; **blocks every user story**
- **US1 (Phase 3)**: needs Phase 2
- **US2 (Phase 4)**: needs US1 — nothing to explain without a trained model
- **US3 (Phase 5)**: needs US2 — the comparison presupposes one method exists
- **US4 (Phase 6)**: needs Phase 2, and **T071 and T077 additionally need US1–US3** (see below)
- **US7 (Phase 7)**: needs US1
- **US5 (Phase 8)**: needs US4 for progress persistence and US7 for the fairness module's evidence
- **US6 (Phase 9)**: needs US4 and US5
- **US8 (Phase 10)**: needs US1–US3 to exist; verification is continuous, not deferred
- **US9 (Phase 11)**: needs Phase 2 only. Independent of every other story, so it can be built at any
  point after the foundation — it is last by priority, not by dependency
- **Phase 12 (Polish)**: needs every story intended for release

### The US4 parallelism caveat

An earlier revision claimed US4 could run wholly in parallel with US1–US3. That was wrong in two
places, and both are now marked in the task list:

- **T071** (the US4 end-to-end suite) asserts that an anonymous visitor completes the entire
  capture-train-explain journey with zero remote rows, which requires US1–US3 to be built.
- **T077** (project reconciliation) restores a project list, class names, and sample counts that only
  exist once US1 is done.

Everything else in US4 — login, redemption, reset, the refusal paths, the locale strings — is
genuinely parallel with US1–US3, which is still the largest available parallel win.

### Within each story

- Every test task is written **before** its implementation task and must fail first
- ML core (`src/ml/`) precedes the features that consume it
- The schema test (T029b) precedes the policy work; policies precede the features that rely on them
- Locale strings ship **with** their feature, never after it

### Parallel opportunities

- T002–T008 and T009b concurrently
- T010–T014 (design system, i18n, primitives) concurrently
- T026 and T029–T031b (local storage and remote schema) concurrently — different stores
- **US4 concurrently with US1–US3**, excluding T071 and T077
- **US9 concurrently with anything after Phase 2** — it shares no file with another story
- All tasks marked `[P]` within a phase

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
teach-the-computer tool worth demonstrating, and it needs no account, so none of the invitation
machinery is on the critical path to it.

### Recommended increments

1. Setup + Foundational → foundation ready
2. **+ US1** → demo: a model trained in the browser (MVP)
3. **+ US2** → demo: the heat map. *This is the point at which the product becomes about explainable
   AI and is the most compelling single demo in the plan.*
4. **+ US3** → demo: two explanations that sometimes disagree
5. **+ US4** → work persists; accounts exist by invitation
6. **+ US7** → metrics and fairness evidence
7. **+ US5** → the guided course
8. **+ US6** → classroom-ready
9. **+ US9** → operable without a developer
10. **+ US8 and Polish** → release candidate

### Parallel team strategy

After Phase 2: one developer on US1 → US2 → US3 (the ML and explanation spine), a second on US4 →
US6 (accounts, invitations, classrooms), a third on lesson content for US5 and the US7 results views.
US9 is small and isolated enough to drop into any gap. US8 and accessibility are everyone's
continuous responsibility, not a phase to be pushed to the end.

---

## Notes

- `[P]` means different files with no dependency between them
- Most tasks cite the requirement, contract obligation, or research decision they satisfy, so
  `/speckit-analyze` can verify traceability in both directions. Pure scaffolding tasks — T001, T002,
  T003, T008 — cite the plan section that motivates them instead, since no single requirement owns
  "install the dependencies", and T127 cites the constitution's two open `TODO`s. Those are the only
  five exceptions, and every one of the 58 functional requirements is cited by at least one task
- Commit after each task or logical group
- Any checkpoint is a valid place to stop and demonstrate
- **Filename deviations recorded as built.** T073–T075 name `Login.tsx`, `RedeemInvitation.tsx` and
  `ResetPassword.tsx`; the files are `LoginPage.tsx`, `RedeemPage.tsx` and `ResetPasswordPage.tsx`,
  because T034 created those three as route placeholders and the route table, its lazy imports and
  the Phase 2 "every route renders in both locales" checkpoint all name them. Renaming to match the
  task text would have churned the router for nothing. US4 also added four files the task list did
  not anticipate: `src/features/auth/redemption.ts` (the `redeem_invitation` call, shared by T074 and
  T075), `CodeInput.tsx` and `Field.tsx` (shared form parts, so the 44 px floor and the
  label/hint wiring have one home), and `src/features/projects/remoteProjects.ts` (T077's reconciliation,
  kept out of the component so `projectsMadeElsewhere` is testable with no store and no network)
- **Lesson progress is remote-only, deliberately, and this differs from US7.** `models.metrics`
  is stored locally because FR-023 gives an unauthenticated visitor the whole lab and FR-010's run
  comparison is part of it. `lesson_progress` and `reflections` are not: the learning path is what an
  educator assigns and reads, so progress with no account has nobody to report to. An anonymous
  visitor reads every module — the content ships in the bundle — writes into the reflection fields,
  and is told plainly that nothing is recorded. US5 also added
  `src/features/lessons/capabilities.ts`, which reads IndexedDB rather than `labStore` because the
  lessons route never opens a project: a capability check against the store would tell a learner with
  three trained models that she has none, in the one place she has gone looking for help
- Five tasks are worth defending against schedule pressure. Each catches a failure that is invisible
  to manual testing:
  - **T060** — batched occlusion versus a naive reference. A batching error still produces a
    plausible heat map
  - **T050** — Grad-CAM class sensitivity. A method that ignores the class looks fine
  - **T032** — the twenty-two RLS scenarios, especially the administrator denials and the audit log
    being selectable by nobody. Row-level security is the entire authorisation model
  - **T130** — administration isolation. An over-broad policy here creates the one role that can read
    every minor's work in the system
  - **T137** — no image egress across the complete journey. This is the constitution's non-negotiable
    core, and T036 alone does not establish it
