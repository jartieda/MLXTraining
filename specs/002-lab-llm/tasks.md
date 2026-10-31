---
description: "Task list for Lab LLM implementation"
---

# Tasks: Lab LLM

**Input**: Design documents from `/specs/002-lab-llm/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: Included and mandatory for navigation, chat explainability panel, exercise progression, i18n, and accessibility.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story mapping from `spec.md`

---

## Phase 1: Setup and Routing

- [ ] T001 [US1] Rename navigation label `Laboratorio` to `Lab CV` in route/nav configuration.
- [ ] T002 [US1] Add `Lab LLM` route entry and page container in `src/features/llm-lab/index.tsx`.
- [ ] T002b [US1b] Refactor `Mis Proyectos` as pedagogical home: introduce XAI importance and two technology tracks (`Lab CV`, `Lab LLM`) with clear CTAs.
- [ ] T003 [P] [US1] Add locale strings (`en`, `es`) for `Lab CV` and `Lab LLM` labels.
- [ ] T003b [P] [US1b] Add locale strings (`en`, `es`) for XAI home copy in `Mis Proyectos` and track descriptions.
- [ ] T004 [P] [US1] Add integration test for dual-tab navigation and active-state behavior.
- [ ] T005 [P] [US1] Add E2E check for mobile nav discoverability and keyboard accessibility.
- [ ] T005b [P] [US1b] Add E2E check that `/projects` shows XAI importance, `Lab CV` block, `Lab LLM` block, and both CTAs.

## Phase 2: Chat Sandbox (Lexi)

- [ ] T006 [US2] Create `LLMProvider` contract and WebLLM-backed provider returning response + explainability payload.
- [ ] T006b [US2] Add `Gemma`, `Llama`, and `Qwen (Alibaba)` model selector and local model loading state.
- [ ] T006c [US2] Add top-k next-word probability data shape to the provider contract.
- [ ] T007 [US2] Implement `LexiChat` with message list, composer, loading states, turn history, and model switching.
- [ ] T008 [P] [US2] Add per-response `¿Por qué dijiste esto?` button component.
- [ ] T009 [P] [US2] Unit test chat state transitions (send, receive, error, retry).
- [ ] T010 [P] [US2] Integration test ensuring every Lexi response includes explain button.

## Phase 3: Explainability Side Panel

- [ ] T011 [US3] Implement side panel open/close anchored to selected assistant message.
- [ ] T012 [US3] Implement attention highlight/keyword visualization.
- [ ] T013 [US3] Implement confidence meter with percentage formatting and plain-language helper text.
- [ ] T014 [US3] Implement sources/context snippets list with empty-state fallback.
- [ ] T015 [P] [US3] Add explicit limitations block to avoid overclaiming causality.
- [ ] T015b [P] [US3] Surface next-word probability candidates in the explanation panel.
- [ ] T016 [P] [US3] Integration test for panel content completeness (highlights + confidence + sources).
- [ ] T017 [P] [US3] E2E performance assertion: panel opens under target budget.

## Phase 4: 9 Progressive Exercises

- [ ] T018 [US4] Create exercise definitions for required 9 exercises with objective, instructions, completion criteria, reflection prompt.
- [ ] T019 [US4] Build exercise route UI (list + detail + status badges).
- [ ] T020 [US4] Add completion tracking and progress summary UI.
- [ ] T021 [US4] Persist progress (authenticated remote, anonymous local).
- [ ] T022 [P] [US4] Implement Exercise 1: selectable or writable continuation for `El perro vio al gato y [opción]`.
- [ ] T022b [P] [US4] Simulate fixed base probabilities for Exercise 1 options: `corrió 88%`, `maulló 8%`, `voló 4%`.
- [ ] T022c [P] [US4] Render animated progress bars per option with vivid colors and visible percentage labels.
- [ ] T022d [P] [US4] Add animated child-friendly explanation of why `corrió` is most likely using context words `perro` and `gato`.
- [ ] T023 [P] [US4] Implement Exercise 2: attention magnifier with per-word background opacity mapped from weights `[0.0, 1.0]`.
- [ ] T023b [P] [US4] Add tooltip interaction on highlighted words: `Lexi prestó un [X]% de atención a esta palabra` via hover, keyboard focus, and tap fallback.
- [ ] T024 [P] [US4] Implement Exercise 3: prompt adjustment vs weight changes.
- [ ] T025 [P] [US4] Implement Exercise 4: misinformation and prompt injection.
- [ ] T026 [P] [US4] Implement Exercise 5: chain-of-thought comic-style pedagogy.
- [ ] T027 [P] [US4] Implement Exercise 6: classification and sentiment.
- [ ] T028 [P] [US4] Implement Exercise 7: hallucination detection.
- [ ] T029 [P] [US4] Implement Exercise 8: hiring-bias identification.
- [ ] T030 [P] [US4] Implement Exercise 9: source/citation grounding (RAG framing).

## Phase 5: Ethics, Safety, and Quality Gates

- [ ] T031 [US5] Add safety callouts and mitigation hints in high-risk exercises.
- [ ] T032 [US5] Add consistency checks: confidence != truth reminder in explain panel.
- [ ] T033 [P] [US5] Add i18n content for all 9 exercises in `en` and `es`.
- [ ] T034 [P] [US5] Add i18n parity test for Lab LLM keys.
- [ ] T035 [P] [US5] Add accessibility test coverage (focus trap, labels, contrast, keyboard).
- [ ] T036 [US5] E2E happy path completing at least 3 exercises plus one ethics scenario.
- [ ] T036b [US4] E2E validation for Exercise 1 fixed probability baseline `88/8/4` and animated bars.
- [ ] T036c [US4] E2E validation for Exercise 2 tooltip text on hover and focus/tap interactions.

## Phase 6: Polish and Release Readiness

- [ ] T037 [US1-US5] Align spacing, typography, and component states with existing design system.
- [ ] T038 [US1-US5] Add analytics hooks for exercise completion and explain-panel usage (if project policy allows).
- [ ] T039 [US1-US5] Update docs/README with Lab LLM overview and pedagogical intent.
- [ ] T040 [US1-US5] Final regression run: unit + integration + e2e + a11y.

---

## Dependency Order

- T001-T005 before T006.
- T002b/T003b/T005b before release candidate.
- T006-T010 before T011-T017.
- T011-T017 before T018-T030.
- T018-T030 before T031-T036.
- T031-T036 before T037-T040.

## Milestone Checkpoints

- **M1**: Navigation complete (`Lab CV` + `Lab LLM`).
- **M2**: Lexi chat with explain button complete.
- **M3**: Side panel complete with 3 mandatory evidence blocks.
- **M4**: 9 exercises complete with persistence.
- **M5**: Ethics/i18n/a11y gates complete and regression green.
