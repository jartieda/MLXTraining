# Implementation Plan: Lab LLM

**Branch**: `002-lab-llm` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-lab-llm/spec.md`

**Reconciled**: 2026-11-01 against the current implementation. This document describes the shipped baseline first; deferred original scope is listed separately.

## Summary

The current implementation is a browser-local LLM lab at `/lab-llm`. It combines a token/word-completion sandbox with selectable local models and execution engines, plus five independent prompt exercises (general explanation, sentiment, bias, math tutor, and deception/uncertainty). GPU uses WebLLM; CPU uses Transformers.js with ONNX WebAssembly. There is no automatic backend fallback.

The exercises generate answers in one call. Sentiment and bias prompts append their classification question automatically. The tutor uses an undisplayed instruction and asks for one Socratic response containing a concrete mathematical strategy, hint, key question about a common mistake, and encouragement to attempt the solution; it must not give the final answer. Other exercises request an answer plus separately tagged model-written explanation, initially hidden behind an inline reveal control. These explanations are explicitly caveated as plausible text, not internal traces.

The original nine-step progression, persisted exercise progress, attention/confidence/source panel, and related E2E suite remain deferred roadmap items. See the snapshot in [spec.md](./spec.md).

## Technical Context

**Language/Version**: TypeScript 5.9 + React 19

**Primary Dependencies**: Existing stack in repository (`react-router`, `zustand`, `@tanstack/react-query`, `i18next`, `tailwindcss`, testing stack, WebLLM runtime)

**Storage**:

- React component state only for prompts, current exercise turn, and a short in-session sandbox result list.
- No LLM-specific database, local-storage, session-storage, progress, or reflection persistence.

**Testing currently present**:

- Unit: bounded word/token candidate search and probability aggregation.
- Unit: WebLLM model IDs against installed catalog and deployment connection policy.
- Unit: English/Spanish locale key parity.
- No LLM-specific integration or E2E suite currently covers exercise flows, navigation, model switching, or accessibility; these are follow-up work.

**Target Platform**: Same as current app (desktop + mobile web).

**Performance behavior**:

- Model load may download large model artifacts and reports progress; time depends on device and network.
- Each model operation is serialized on a shared engine queue.
- There is no precomputed explanation side panel; exercise generation waits for local inference.

**Constraints**:

- Preserve existing design system and keep inference local to the browser.
- GPU/WebGPU and CPU/WASM are user-selectable. A GPU failure is surfaced; the app does not silently select CPU.
- Model-generated explanations are not to be presented as faithful traces of internal computation.

## Current Architecture

- **Page**: `src/features/llmLab/LlmLabPage.tsx` owns selected model/backend, serialized load lifecycle, loading and error status, prompt sandbox and short-lived result state.
- **Engine contract**: `src/features/llmLab/llmEngine.ts` exposes `generate`, next-token alternatives, backend identity, and `unload`. GPU uses WebLLM; CPU uses Transformers.js/ONNX WebAssembly. Requests are serialized because the demo sections share one engine.
- **Model catalog**: `src/features/llmLab/webllm.ts` maps Gemma, Llama 3.2 3B, and Qwen 2.5 3B to GPU IDs and smaller CPU models/dtypes. Backend switching is explicit.
- **Word analysis**: `src/features/llmLab/wordCompletion.ts` explores bounded top-k paths (3 candidates per step, beam 9, depth 8, max 36 requests by default), aggregates path products for completed words, and retains unfinished prefixes for progress display. Results are approximate because the partial prefix is re-requested and retokenized.
- **Prompt exercises**: `src/features/llmLab/ReasoningChat.tsx` is parameterized by `reasoning`, `sentiment`, `bias`, `tutor`, or `deception`. Copy/examples are in `src/locales/{en,es}/llm.json`. Example buttons fill the textarea. Sentiment and bias add a hidden classification question. Tutor mode uses an internal Socratic math instruction, requests one response with concrete scaffolding, and omits the explanation reveal control.
- **Explanation boundary**: non-tutor exercises use a prompt asking the model for `[ANSWER]` and `[REASONING]` sections; the UI reveals the latter on demand and warns it is model-authored, not internal model state.
- **Not present**: provider abstraction returning true explanation metadata, attention weights, confidence, sources, side panel, persistent progressive path, analytics, or LLM-specific E2E accessibility flows.

## Current Project Structure

```text
src/features/llmLab/
├── LlmLabPage.tsx
├── ReasoningChat.tsx
├── llmEngine.ts
├── webllm.ts
└── wordCompletion.ts
src/locales/{en,es}/llm.json
tests/unit/{wordCompletion,webllm,webllm-deployment}.test.ts
```

## Delivery Status and Deferred Work

### Implemented baseline

- Local model selector and GPU/CPU selector, load progress, error state, retry, and no automatic fallback.
- Bounded top-token word search and inline candidate/path analysis.
- Five localized prompt exercises, example-fill buttons, answer/explanation parsing, thinking status, and tutor-specific response policy.
- Caveat that generated explanation is not an internal trace.

### Deferred roadmap

1. Decide and design a real 9-exercise progression and state/persistence model; do not imply the current five demos provide completion tracking.
2. Build actual attention visualization only if the runtime can provide valid attention data; do not label token probabilities as attention.
3. Design confidence and sources only with defensible data sources and semantics; current code computes neither.
4. Add explicit hallucination verification, prompt-injection mitigations, and grounding/citation activities.
5. Add integration/E2E/accessibility coverage for navigation, model/backend selection, exercises, and responsive use.
6. Revisit the instruction and UI language that currently calls generated explanation “reasoning”; continue emphasizing it is model-written narrative, not a faithful internal trace.

## Current Risks and Mitigations

- **Risk**: The generated “reasoning” can be plausible but unfaithful or wrong.
  - **Mitigation**: Reveal only on request and display an explicit caveat.
- **Risk**: GPU download/capability or CPU/WASM compatibility failures.
  - **Mitigation**: User chooses engine; show progress/error/retry and never silently switch backend.
- **Risk**: Search scores can be mistaken for exact word probabilities.
  - **Mitigation**: Bound the search and explain that scores are approximate and cover explored paths only.
- **Risk**: Tutor models may disclose the final answer despite instructions.
  - **Mitigation**: Frame as an exercise to evaluate model compliance, not a hard guarantee.

## Baseline Definition of Done (current)

- Model and backend selection, local load state, errors/retry, and the explicit no-fallback behavior are documented.
- Word candidate search and five prompt variants are represented accurately in the spec and have English/Spanish strings.
- Tests for word search, model mapping, deployment policy, and locale parity are documented without claiming unimplemented E2E coverage.
- Deferred roadmap items remain visibly distinct from implemented behavior.
