---
description: "Implementation status and deferred work for Lab LLM"
---

# Tasks: Lab LLM

**Reconciled**: 2026-11-12 against `src/features/llmLab/`, locale files, unit tests and E2E tests. The XAI path follows [`docs/plan_lab_llm_xai.md`](../../docs/plan_lab_llm_xai.md).

The original task list described a nine-exercise product with a confidence/attention/sources side panel. Those features are not present as designed; the XAI path below replaces part of that scope. This list marks only verified implementation as complete; remaining scope is explicitly deferred.

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
- [x] B012 Stop button for the sandbox and every exercise (`LlmAbortedError`, abort signal through the engine queue).
- [x] B013 Keep the last 4 turns of history in «Intenta engañar al modelo»; show the exact model name with results.

## XAI path (engine not modified)

### Step 1 — A/B comparator

- [x] X001 `compare/scoreOptions.ts`: closed-question prompt, per-letter probabilities from the first-token top 3, «not measured» instead of 0, off-format warning above 50 %.
- [x] X002 `compare/diffWords.ts`: word-level diff and warning above 2 changed words.
- [x] X003 `compare/compareResults.ts`: alignment by answer, bands at 5 and 20 points, top-answer change, free-text band.
- [x] X004 `compare/presets.ts` and `llm.json`: nine prepared cases in sentiment, bias, prompt change and hallucination, with the chaqueta example.
- [x] X005 `compare/ComparePanel.tsx`: prompts with diff, bet, aligned results, verdict with case sentence, «Ver el cálculo», stop.
- [x] X006 `compare/experimentStore.ts`: separate IndexedDB database, save/list/delete experiments.
- [x] X007 Tabs with mounted panels; fake-engine injection for tests. (Renamed in X020.)

### Step 2 — Word lens and self-report check

- [x] X008 `compare/wordImpact.ts`: split and remove words, impact with lower bound, refuse when off-format.
- [x] X009 `compare/WordLens.tsx`: cost announcement, progress and stop, three-step colouring, dashed underline for words against, text summary, calculation.
- [x] X010 Self-report check: quote extraction, overlap with the lens's top words, *Coinciden / en parte / No coinciden / No se puede comparar*.

### Step 3 — Missions and simple view

- [x] X011 `missions/missions.ts`: seven missions, targets, local progress (transactional), project card, Markdown builder.
- [x] X012 `missions/LlmMissions.tsx`: progress bar, mission cards, «Ir a…» with case and anchor, card form and download.
- [x] X013 Simple view in the sandbox (whole percentages, calculation behind «Ver el cálculo»).
- [x] X014 14+ example. (The «10 % del cerebro» example and the «Extras» tutor were later replaced; see X020.)

### Step 4 — Extensions

- [x] X015 `compare/audit.ts` and `AuditPanel.tsx`: five name pairs, table, mean, largest pair, stop.
- [x] X016 «Un prompt, dos modelos» mode in the comparator.
- [x] X017 `compare/RepeatMockup.tsx`: «Repetir 5 veces» marked «Próximamente», with the reason.

### Reorganisation into the shared three tabs

- [x] X020 Tabs «Herramientas» (sandbox, comparator, lens, audit, mock-up), «Retos» (prompt exercises) and «Misiones», matching the Lab CV; one-line intro per tab; mission targets point to `tools`; E2E tab names updated. The tutor/«Extras» block and its strings were removed and the examples changed in the merge `67d20e0`.

### Tests

- [x] X018 Unit: `llmCompare`, `llmExperimentStore`, `llmWordLens`, `llmAudit`, `llmMissions`, `llmEngine`.
- [x] X019 E2E with a fake engine, desktop and 360 px: `lab-llm-compare.spec.ts`, `lab-llm-missions.spec.ts`.

## Deferred roadmap

- [x] ~~D001 Decide whether to turn the independent demos into a numbered learning path~~ — done as seven missions (X011–X012).
- [x] ~~D002 Add exercise progress and reflection persistence~~ — done locally on the device; account sync remains open (D010).
- [ ] D003 Prompt injection and grounding/citation activities; hallucination is covered by the comparator cases and mission 6.
- [ ] D004 Evaluate whether the runtime can expose meaningful per-token attention; the word lens measures occlusion and must not be labelled attention.
- [ ] D005 Design defensible confidence and source/context displays; the runtime does not retrieve sources.
- [x] ~~D006 Add E2E coverage for the Lab LLM~~ — comparator, lens, audit, two models, mock-up and missions (X019). Model/backend switching with real models is still untested.
- [ ] D007 Add automated accessibility checks specifically for Lab LLM and manual keyboard/screen-reader review.
- [x] ~~D008 Review the wording “reasoning”~~ — the UI says «Ver cómo lo explica» and «Explicación escrita por el modelo».
- [ ] D009 Measure real-device load and inference performance.
- [ ] D010 Sync mission progress and the project card to accounts, if wanted.
- [ ] D011 Validate every feature with real models on GPU and CPU (the model CDN was unreachable during development).
- [ ] D012 Classroom review of the name pairs and professions in the bias cases and the audit.
- [ ] D013 «Repetir 5 veces» for real: requires sampling in the engine, out of scope while the engine is not modified.
- [ ] D014 Merge mission 7 («Ficha XAI de tu proyecto») with the home page's «Tu proyecto y la XAI», which asks overlapping questions (what it decides, who it affects).

## Validation already represented in tests

- `tests/unit/wordCompletion.test.ts`: bounded search, path scoring/aggregation, partials, boundaries, and failure handling.
- `tests/unit/webllm.test.ts`, `tests/unit/webllm-deployment.test.ts`: model IDs and deployment policy.
- `tests/unit/llmEngine.test.ts`: stop and serialisation.
- `tests/unit/llmCompare.test.ts`: `scoreOptions`, `diffWords`, alignment, bands, preset texts in both languages.
- `tests/unit/llmExperimentStore.test.ts`, `tests/unit/llmMissions.test.ts`: local storage and the card Markdown.
- `tests/unit/llmWordLens.test.ts`: word splitting, impact and lower bound, stopping, self-report bands.
- `tests/unit/llmAudit.test.ts`: pairs, summary and stopping.
- `tests/unit/i18n.test.ts`: locale key/content parity.
- `tests/e2e/lab-llm-compare.spec.ts`, `tests/e2e/lab-llm-missions.spec.ts`: user flows with a fake engine, desktop and 360 px.

## Dependency order for deferred work

- D011 before using the lab in a class.
- D012 before using the bias cases and the audit in a class.
- D004 and D005 before claiming attention, confidence or source explainability.
- D007 should accompany any new user-visible workflow.
- D009 before making performance claims.
