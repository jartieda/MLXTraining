# Implementation Plan: Lab LLM

**Branch**: `002-lab-llm` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-lab-llm/spec.md`

**Reconciled**: 2026-11-02 against the current implementation and [`docs/plan_lab_llm_xai.md`](../../docs/plan_lab_llm_xai.md). This document describes what is shipped first; deferred original scope is listed separately.

## Summary

The Lab LLM at `/lab-llm` is a browser-local lab for learning explainable AI with small language models. Model and engine controls sit above three tabs:

- **Explorar**: the next-word sandbox (simple view, calculation on demand) and the prompt exercises (general question, sentiment, text bias, «Intenta engañar al modelo»), with the maths tutor folded into «Extras».
- **Comparar dos prompts**: the A/B comparator (two prompts on one model, or one prompt on two models), nine prepared cases, the five-pair name audit, the word lens with the «¿Dice la verdad sobre sí mismo?» check, saved experiments, and the «Repetir 5 veces» mock-up.
- **Misiones**: seven missions with local progress and a downloadable XAI card for the learner's project.

**The engine is not modified.** All comparison logic lives in `src/features/llmLab/compare/` and only calls `nextTokenAlternatives`, `generate` and `unload`. Where the engine cannot support a feature (sampling for «Repetir 5 veces»), the interface is a labelled mock-up. GPU uses WebLLM; CPU uses Transformers.js with ONNX WebAssembly; there is no automatic backend fallback. The full description is in the snapshot of [spec.md](./spec.md).

## Technical Context

**Language/Version**: TypeScript 5.9 + React 19

**Primary Dependencies**: Existing stack in repository (`react-router`, `zustand`, `@tanstack/react-query`, `i18next`, `tailwindcss`, testing stack, WebLLM runtime)

**Storage**:

- React state for prompts and current results; panels stay mounted across tabs.
- IndexedDB database `ml4g-llm-lab` (Dexie), separate from the Lab CV's store: `experiments` (v1), `missions` and `projectCard` (v2, tables added only). Nothing is synced to accounts or sent off the device; the project card is downloaded as a Markdown file.

**Testing currently present**:

- Unit: word search; model IDs and deployment policy; engine stop and serialisation; `scoreOptions`, `diffWords`, `compareScored` and change bands; experiment store; word lens and self-report check; name audit; missions store and card Markdown; locale parity.
- E2E: `tests/e2e/lab-llm-compare.spec.ts` and `tests/e2e/lab-llm-missions.spec.ts`, desktop and 360 px, using a fake engine injected through `window.__ML4G_FAKE_LLM_ENGINE__` (read by `LlmLabPage` before creating a real engine; the engine module itself is unchanged).
- Not yet: runs against real models, automated accessibility checks.

**Target Platform**: Same as current app (desktop + mobile web).

**Performance behavior**:

- Model load may download large model artifacts and reports progress; time depends on device and network.
- Each model operation is serialized on a shared engine queue.
- There is no precomputed explanation side panel; exercise generation waits for local inference.
- Batch features announce their cost before running: the word lens makes one query per word plus one (19 for the chaqueta example), the name audit 10, a comparison 2 (or up to 72 for two next-word searches). All of them show progress and can be stopped.

**Constraints**:

- Preserve existing design system and keep inference local to the browser.
- GPU/WebGPU and CPU/WASM are user-selectable. A GPU failure is surfaced; the app does not silently select CPU.
- Model-generated explanations are not to be presented as faithful traces of internal computation.
- The engine (`llmEngine.ts`, `webllm.ts`) is not modified by the XAI features.
- Probabilities outside the reported top 3 are «not measured», never 0 %.

## Current Architecture

- **Page**: `src/features/llmLab/LlmLabPage.tsx` owns selected model/backend, the serialized load lifecycle, loading and error status, the three tabs, the sandbox, and the hand-off from a mission to a tab, a prepared case and an anchor. It locks the model controls while the comparator, lens or audit is running.
- **Engine contract**: `src/features/llmLab/llmEngine.ts` exposes `generate`, `nextTokenAlternatives`, backend identity and `unload`, with an abort signal and `LlmAbortedError`. Requests are serialized. Unchanged by the XAI features.
- **Model catalog**: `src/features/llmLab/webllm.ts` maps Gemma, Llama and Qwen to GPU and CPU models and exposes `MODEL_DISPLAY_NAME`.
- **Word analysis**: `src/features/llmLab/wordCompletion.ts` explores bounded top-k paths and aggregates path products; results cover explored paths only.
- **Prompt exercises**: `src/features/llmLab/ReasoningChat.tsx`, parameterized by `reasoning`, `sentiment`, `bias`, `tutor` or `deception`.
- **Comparison logic** (`src/features/llmLab/compare/`, pure and unit-tested):
  - `scoreOptions.ts`: closed-question prompt and per-letter probabilities from the first-token top 3.
  - `diffWords.ts`: word-level LCS diff and the 2-word warning threshold.
  - `compareResults.ts`: alignment by answer, change bands (5 and 20 points), free-text band.
  - `presets.ts`: the nine prepared cases (texts in `llm.json`).
  - `wordImpact.ts`: word splitting, removal, impact with lower bound, and the self-report check (quote extraction and overlap bands).
  - `audit.ts`: the five name pairs, the audit run and its summary.
  - `experimentStore.ts`: the `ml4g-llm-lab` database.
- **Comparison UI**: `ComparePanel.tsx` (both modes, verdict, saved experiments), `AuditPanel.tsx`, `WordLens.tsx`, `RepeatMockup.tsx`.
- **Missions**: `src/features/llmLab/missions/missions.ts` (missions, targets, storage, card Markdown) and `LlmMissions.tsx`.

## Current Project Structure

```text
src/features/llmLab/
├── LlmLabPage.tsx
├── ReasoningChat.tsx
├── llmEngine.ts
├── webllm.ts
├── wordCompletion.ts
├── compare/
│   ├── AuditPanel.tsx
│   ├── ComparePanel.tsx
│   ├── RepeatMockup.tsx
│   ├── WordLens.tsx
│   ├── audit.ts
│   ├── compareResults.ts
│   ├── diffWords.ts
│   ├── experimentStore.ts
│   ├── presets.ts
│   ├── scoreOptions.ts
│   └── wordImpact.ts
└── missions/
    ├── LlmMissions.tsx
    └── missions.ts
src/locales/{en,es}/llm.json
tests/unit/{wordCompletion,webllm,webllm-deployment,llmEngine,llmCompare,llmExperimentStore,llmWordLens,llmAudit,llmMissions}.test.ts
tests/e2e/{lab-llm-compare,lab-llm-missions}.spec.ts
```

## Delivery Status and Deferred Work

### Implemented

- Baseline: model and engine selectors, load progress, errors, retry, no automatic fallback; bounded word search; prompt exercises with caveated self-explanations; stop buttons; history in the deception exercise.
- Step 1 of the XAI plan: A/B comparator with diff, bet, aligned results, bands, nine cases, «Ver el cálculo» and saved experiments.
- Step 2: word lens and «¿Dice la verdad sobre sí mismo?».
- Step 3: tabs, simple view, missions with local progress and downloadable card, 14+ example, tutor in «Extras».
- Step 4: five-pair name audit, «Un prompt, dos modelos», «Repetir 5 veces» mock-up.

### Deferred roadmap

1. Validate with real models on GPU and CPU, especially whether the small CPU models answer with an option letter.
2. Have someone with classroom experience review the name pairs and professions used in the bias cases and the audit.
3. «Repetir 5 veces» needs sampling in the engine; out of scope while the engine is not modified.
4. Prompt injection and grounding/citation activities; no retrieval exists.
5. Attention visualisation only if the runtime can provide valid attention data; the word lens must not be relabelled as attention.
6. Sync mission progress to accounts if the product wants it; today it is local to the device.
7. Automated accessibility checks and real-device performance measurements for the Lab LLM.

## Current Risks and Mitigations

- **Risk**: Small models do not answer closed questions with a letter, so option probabilities are mostly «other».
  - **Mitigation**: Warn above 50 % non-option mass; the lens refuses to measure when the whole text gets no letter.
- **Risk**: Top-3 limits hide the probability of less likely answers.
  - **Mitigation**: Show «not measured», never 0 %; report a lower bound in the lens; explain in «Ver el cálculo».
- **Risk**: Removing a word leaves an odd sentence and the lens is read as what the model «thinks».
  - **Mitigation**: Explicit caveat under the lens summary.
- **Risk**: Name pairs can reinforce stereotypes if presented carelessly.
  - **Mitigation**: Framing questions in the verdict and missions («¿Debería?»); classroom review pending.

- **Risk**: The generated “reasoning” can be plausible but unfaithful or wrong.
  - **Mitigation**: Reveal only on request and display an explicit caveat.
- **Risk**: GPU download/capability or CPU/WASM compatibility failures.
  - **Mitigation**: User chooses engine; show progress/error/retry and never silently switch backend.
- **Risk**: Search scores can be mistaken for exact word probabilities.
  - **Mitigation**: Bound the search and explain that scores are approximate and cover explored paths only.
- **Risk**: Tutor models may disclose the final answer despite instructions.
  - **Mitigation**: Frame as an exercise to evaluate model compliance, not a hard guarantee.

## Definition of Done (current)

- Every behaviour in the spec snapshot has unit or E2E coverage with the fake engine, at desktop size and 360 px, and every string exists in English and Spanish.
- The engine files are unchanged by the XAI features.
- No number is shown as 0 % when it was not measured.
- Deferred roadmap items remain visibly distinct from implemented behaviour.
