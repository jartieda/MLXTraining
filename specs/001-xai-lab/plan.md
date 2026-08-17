# Implementation Plan: Explainable AI Lab

**Branch**: `001-xai-lab` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-xai-lab/spec.md`

## Summary

Build a static, single-page web application in which a Technovation participant captures images
into named classes from her device camera, trains a classifier on her own device, tests it live,
and inspects two independent heat-map explanations of any prediction. A guided learning path turns
those mechanics into an explainable-AI curriculum, and an educator dashboard makes it runnable as a
workshop.

Technical approach: React and TypeScript compiled by Vite to static assets. Transfer learning in
TensorFlow.js — a pretrained MobileNet v1 backbone is loaded as a Layers model and truncated, its
weights frozen, and only a small classification head is trained on cached embeddings, so training
takes seconds rather than minutes. The gradient-based explanation is Grad-CAM computed against the
truncated backbone's last convolutional activations; the perturbation-based explanation is batched
occlusion sensitivity, ported from the project's existing prototype and made an order of magnitude
faster by evaluating all occluded variants in a single batched forward pass. Images and models live
in IndexedDB and never leave the device. Supabase provides authentication, the consent state
machine, and row-level-security-protected tables for classroom membership, progress, reflections,
and training-run metrics — never image data.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), targeting ES2022

**Primary Dependencies**: React 19 · Vite 7 · React Router 7 · Zustand 5 (client state) ·
TanStack Query 5 (remote state) · Tailwind CSS 4 · react-i18next 16 · `@tensorflow/tfjs` 4 with
`@tensorflow/tfjs-backend-wasm` fallback · Dexie 4 (IndexedDB) · `@supabase/supabase-js` 2 ·
Zod 4 (boundary validation) · `@fontsource-variable/poppins` and `@fontsource/rubik`

**Storage**: IndexedDB via Dexie for samples, cached embeddings, and saved models
(`indexeddb://` model store). Supabase Postgres for profiles, consent records, classrooms,
enrolments, project metadata, training-run metrics, lesson progress, and reflections — all tables
with row-level security enabled.

**Testing**: Vitest with React Testing Library for units and components; Vitest node environment
for the ML core against committed fixture images with a fixed seed; Playwright for end-to-end at
360×740 and 1440×900 viewports, using `--use-fake-device-for-media-stream` with a fixture video;
`@axe-core/playwright` for the accessibility gate; pgTAP-style SQL assertions run against a local
Supabase instance for row-level-security contracts.

**Target Platform**: Evergreen browsers with `getUserMedia` and WebGL2 or WebAssembly — Chrome,
Edge, Firefox, Safari 17+, on desktop, low-end Chromebook, Android, and iOS. Deployed as static
assets behind a CDN.

**Project Type**: Single-page web application, static hosting, no first-party server.

**Performance Goals**: Train 3 classes × 30 samples in under 30 s on a mid-range laptop and under
90 s on a mid-range phone (SC-002). Grad-CAM under 1 s (SC-003). Batched 12×12 occlusion under
5 s, cancellable, with progress (SC-003). Interactive within 3 s on a mid-range phone (SC-008);
initial route JavaScript under 200 KB compressed, with TensorFlow.js and the backbone lazy-loaded
on first entry to the lab. Live inference at 10 fps or better, throttled rather than run every
animation frame.

**Constraints**: No first-party backend. Image and model data must never be transmitted
(FR-048, SC-010). Complete journey usable at 360 px width (SC-004). WCAG 2.1 AA with zero
automated violations on the primary journey (SC-009). Functional without WebGL at no worse than 4×
the accelerated training time (SC-012). Every user-facing string externalised, English and
Spanish complete (SC-005).

**Scale/Scope**: Tens of classrooms, low thousands of accounts. 8 user stories, 50 functional
requirements, 7 learning modules, roughly 12 screens. Concurrency is not a design driver because
computation is client-side.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v2.0.0**.

| Principle | Gate | Verdict |
|---|---|---|
| I. Privacy First | Samples, embeddings, and models are written only to IndexedDB. No Supabase table has a column that can hold image or weight data. A Playwright network assertion fails the build if any request body carries image or model bytes. Age declaration and pending-account gate are in the auth flow. | **PASS** |
| II. Client-Side Computation | Training, inference, Grad-CAM, and occlusion all run in the browser. Supabase is used only for auth and non-image persistence. No first-party server exists to route a prediction through. | **PASS** |
| III. Explainability Is First-Class | Two independent methods, one gradient-based and one perturbation-based, both reachable from any prediction. The comparison view reports an agreement score and states disagreement explicitly rather than reconciling it. | **PASS** |
| IV. Learner-Accessible | `en` default, `es` selectable, all strings in locale files, a test fails on a missing key. Mobile-first layout verified at 360 px in end-to-end tests. `axe` gate in CI. WASM fallback exercised in a dedicated test run, not merely configured. | **PASS** |
| V. Technovation Design System | Tokens declared once as CSS custom properties and mapped into the Tailwind theme; a lint rule forbids raw hex values and `font-family` in component files. Heat maps deliberately exempt and use a perceptually uniform ramp with a legend. | **PASS** |
| VI. Test-First for the ML Core | `src/ml/` has no DOM, camera, or network dependency and is tested in a node environment against fixture images with a fixed seed before any UI is wired to it. | **PASS** |
| VII. Simplicity | One `package.json`, no workspaces, one deployable static site. Supabase is called through its own client with no wrapper abstraction. | **PASS** |

**Post-design re-check (after Phase 1)**: Still **PASS**. No violation required justification, so
the Complexity Tracking table below is empty by design. Two items are recorded as deferred
obligations rather than violations: the concrete verifiable-consent mechanism and the applicable
digital-consent age both await legal review (`TODO(CONSENT_MECHANISM)` in the constitution), and
Technovation logo usage awaits program confirmation (`TODO(TECHNOVATION_TRADEMARK)`). Neither
blocks implementation of anything in this plan; both block public launch.

## Project Structure

### Documentation (this feature)

```text
specs/001-xai-lab/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── ml-core.md           # src/ml public interfaces
│   ├── database.md          # Postgres schema + RLS policy contracts
│   └── storage.md           # IndexedDB schema + migration contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── ml/                          # No DOM, no network. Tested first (Principle VI).
│   ├── backbone.ts              # load + truncate MobileNet, embed(), warmUp()
│   ├── head.ts                  # build/compile the trainable classification head
│   ├── train.ts                 # trainClassifier(): fit on cached embeddings
│   ├── predict.ts               # classify(), per-class probabilities
│   ├── explain/
│   │   ├── gradcam.ts           # gradient-based heat map
│   │   ├── occlusion.ts         # batched perturbation heat map
│   │   ├── agreement.ts         # rank correlation + top-k IoU between two maps
│   │   └── colormap.ts          # perceptually uniform ramp → RGBA
│   ├── metrics.ts               # confusion matrix, per-class accuracy, imbalance
│   ├── backend.ts               # WebGL/WASM selection + capability report
│   └── types.ts
├── features/
│   ├── auth/                    # sign-up, login, age gate, consent state
│   ├── capture/                 # camera, class list, sample grid
│   ├── training/                # train controls, progress, run history
│   ├── testing/                 # live prediction, freeze frame
│   ├── explaining/              # single + comparison heat-map views
│   ├── results/                 # confusion matrix, per-class accuracy, imbalance
│   ├── lessons/                 # learning path, modules, challenges, reflections
│   ├── projects/                # project list, create, delete, storage budget
│   └── classroom/               # educator dashboard, join codes, roster, export
├── components/                  # shared primitives (Button, Meter, HeatmapCanvas, …)
├── lib/
│   ├── supabase.ts              # client + typed database definitions
│   ├── db.ts                    # Dexie schema and migrations
│   ├── i18n.ts                  # react-i18next setup
│   └── camera.ts                # getUserMedia lifecycle, device switching
├── content/lessons/             # module definitions, locale-keyed
├── locales/{en,es}/*.json
├── styles/tokens.css            # Technovation tokens as CSS custom properties
├── routes/
└── main.tsx

tests/
├── unit/                        # ml core, metrics, agreement, colormap
├── fixtures/                    # seeded fixture images + fake camera video
├── integration/                 # feature-level component tests
├── e2e/                         # Playwright: mobile + desktop journeys, a11y, network
└── db/                          # row-level-security policy assertions

supabase/migrations/             # SQL schema + RLS policies
```

**Structure Decision**: Single project at the repository root with one `package.json`, as required
by Principle VII. The one non-obvious choice is isolating `src/ml/` as a DOM-free, network-free
module with a published contract ([contracts/ml-core.md](./contracts/ml-core.md)). This is what
makes Principle VI enforceable: the explanation algorithms can be tested deterministically in a
node environment against fixture images, which is the only way to catch a subtly wrong gradient
computation that would otherwise render as a plausible but meaningless heat map. `features/` is
organised by user journey so that each user story in the spec maps to one or two directories and
can be built and demonstrated independently.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. All seven principles pass both the pre-research and post-design gates, so no
justification is required and this table is intentionally empty.
