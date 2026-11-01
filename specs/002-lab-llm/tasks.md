---
description: "Implementation status and deferred work for Lab LLM"
---

# Tasks: Lab LLM

**Reconciled**: 2026-11-01 against `src/features/llmLab/`, locale files, and current unit tests.

The original task list described a nine-exercise product with a confidence/attention/sources side panel. Those features are not present. This list marks only verified implementation as complete; remaining original scope is explicitly deferred.

## Implemented baseline

- [x] B001 Add the `/lab-llm` page with prompt sandbox and local model selection (Gemma, Llama, Qwen).
- [x] B002 Add explicit GPU (WebLLM) and CPU (Transformers.js/ONNX WebAssembly) engine selection; report loading, readiness, errors, and retry without automatic fallback.
- [x] B003 Serialize requests and engine lifecycle operations to share the local engine safely.
- [x] B004 Implement bounded top-token word completion with candidate paths, probability products, progress, and partial-prefix reporting.
- [x] B005 Add five independent prompt-exercise variants: general explanation, sentiment, bias, math tutor, and deception/uncertainty.
- [x] B006 Add localized examples and a button to fill the prompt in each exercise.
- [x] B007 Append sentiment and bias questions automatically and keep the learner's text visible independently.
- [x] B008 Request answer and separately tagged explanation in one call for non-tutor exercises; hide the explanation until the user reveals it and show the unfaithful-explanation caveat.
- [x] B009 Request one Socratic math-tutoring response with a concrete strategy, hint, common-mistake question, and invitation to attempt; keep the internal instruction out of the UI and omit the final answer.
- [x] B010 Localize current feature strings in English and Spanish.
- [x] B011 Unit-test word search, WebLLM model mappings, deployment policy, and locale parity.

## Deferred roadmap

- [ ] D001 Decide whether to turn the five independent demos into a numbered learning path; define objectives, completion criteria, reflections, and expected progression before implementation.
- [ ] D002 Add exercise progress and reflection persistence (authenticated and anonymous) only after the progression model is agreed.
- [ ] D003 Implement the proposed nine exercises that are not represented by current demos, including prompt injection, hallucination/source verification, and grounding/citations.
- [ ] D004 Evaluate whether the runtime can expose meaningful per-token attention; if not, revise the learning objective rather than presenting token probabilities as attention.
- [ ] D005 Design defensible confidence and source/context displays; the current runtime does not compute confidence or retrieve sources.
- [ ] D006 Add integration/E2E coverage for navigation, model/backend switching, sandbox/exercise interactions, and responsive states.
- [ ] D007 Add automated accessibility checks specifically for Lab LLM and manual keyboard/screen-reader review.
- [ ] D008 Review the wording “reasoning” in UI/spec: generated explanation is post-hoc text and not an internal computation trace.
- [ ] D009 Measure real-device load and inference performance; current plan does not assert the original under-3-second route or under-300-ms explanation targets.

## Validation already represented in tests

- `tests/unit/wordCompletion.test.ts`: bounded search, path scoring/aggregation, partials, boundaries, and failure handling.
- `tests/unit/webllm.test.ts`: mapped GPU model IDs exist in the installed catalog.
- `tests/unit/webllm-deployment.test.ts`: deployment connection policy.
- `tests/unit/i18n.test.ts`: locale key/content parity (50 tests passed in the last recorded run).

## Dependency order for deferred work

- D001 before D002 and D003.
- D004 and D005 before claiming attention/confidence/source explainability.
- D006 and D007 should accompany any new user-visible workflows, not be postponed until release.
- D008 applies to copy changes in current UI and future docs.
- D009 before making performance claims.