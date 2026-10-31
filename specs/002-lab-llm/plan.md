# Implementation Plan: Lab LLM

**Branch**: `002-lab-llm` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-lab-llm/spec.md`

## Summary

Add a new learning area `Lab LLM` beside `Lab CV` (renaming current `Laboratorio` label), keeping the existing visual language and accessibility standards. The new area contains:

1. An interactive chat sandbox with `Lexi` running locally in the browser via WebLLM.
2. A per-response explainability panel opened through `¿Por qué dijiste esto?`.
3. A progressive route of 9 exercises focused on LLM-XAI and ethical reasoning.

Also adapt `Mis Proyectos` into a pedagogical home/entry page that introduces why XAI matters and explains the two technology tracks (`Lab CV` and `Lab LLM`) with clear navigation CTAs.

The implementation should start with a provider-agnostic architecture: mocked local responses and explanation metadata first, then optional real LLM integration behind an adapter.

## Technical Context

**Language/Version**: TypeScript 5.9 + React 19

**Primary Dependencies**: Existing stack in repository (`react-router`, `zustand`, `@tanstack/react-query`, `i18next`, `tailwindcss`, testing stack, WebLLM runtime)

**Storage**:

- Local/session state for sandbox conversation.
- Existing remote persistence path for authenticated progress/reflections.
- Fallback local persistence for anonymous users.

**Testing**:

- Unit: message mapping, explanation formatting, exercise progression rules.
- Integration: chat flow, panel open/close, progress persistence.
- E2E: navigation (`Lab CV` + `Lab LLM`), 9 exercises path, accessibility, mobile layout.
- E2E: Exercise 1 probabilities fixed at 88/8/4 baseline, animated bars visible, Exercise 2 attention tooltip on hover and focus/tap, and `Mis Proyectos` home pedagogy content.
- E2E: model switching across `Gemma`, `Llama`, and `Qwen (Alibaba)` and visible next-token probability lists.

**Target Platform**: Same as current app (desktop + mobile web).

**Performance Goals**:

- `Lab LLM` route interactive under 3 s on mid-range phone.
- Explanation panel visible under 300 ms after click using precomputed metadata.

**Constraints**:

- Preserve current design system and UX patterns.
- Do not break existing `Lab CV` flows.
- Clear degradation when explanation metadata or online model is unavailable.

## Architecture Decisions

- **D1: New feature module**: create `src/features/llm-lab/` with submodules `chat`, `explain`, `exercises`, `ethics`.
- **D2: Provider adapter boundary**: `LLMProvider` interface with `sendMessage()` returning `reply + explainability metadata` and the active model id.
- **D3: Explainability payload contract** per response:
  - `attentionHighlights: Array<{ token: string; weight: number }>`
  - `confidence: number` in `[0,1]`
  - `sources: Array<{ title: string; snippet: string; url?: string }>`
  - `limitations: string[]`
- **D4: Progressive exercises as content-first config** in `src/content/lessons/llm/` with locale keys.
- **D5: Safety-first rendering**: confidence and highlights always accompanied by text disclaimers.
- **D6: Exercise 1 deterministic simulation**: baseline output probabilities are fixed to `corrió 88%`, `maulló 8%`, `voló 4%` for the canonical sentence to keep learning outcomes stable.
- **D7: Attention lens contract**: token weights are normalized in `[0,1]`, mapped to CSS opacity, and expose the same educational tooltip via mouse hover and keyboard/touch interactions.
- **D8: Projects page as XAI home**: `/projects` becomes the educational landing for two tracks (CV and LLM) while preserving project management entry points.
- **D9: WebLLM model catalog**: the browser runtime exposes exactly three small models, `Gemma`, `Llama`, and `Qwen (Alibaba)` (the installed WebLLM catalog has no Granite build), as user-selectable choices.
- **D10: Next-token surfacing**: the provider exposes top-k next-word probabilities from the local model so the exercise view can render the next-word candidates.

## Project Structure (new/changed)

```text
src/
├── features/
│   └── llm-lab/
│       ├── chat/
│       │   ├── LexiChat.tsx
│       │   ├── MessageList.tsx
│       │   └── MessageComposer.tsx
│       ├── explain/
│       │   ├── WhyButton.tsx
│       │   ├── ExplainSidePanel.tsx
│       │   ├── AttentionHeatmap.tsx
│       │   └── ConfidenceMeter.tsx
│       ├── exercises/
│       │   ├── ExercisePath.tsx
│       │   ├── ExerciseCard.tsx
│       │   └── exerciseDefinitions.ts
│       │   ├── OutputProbabilityExercise.tsx
│       │   └── AttentionLensExercise.tsx
│       ├── ethics/
│       │   └── SafetyCallout.tsx
│       ├── api/
│       │   ├── webllmClient.ts
│       │   ├── llmProvider.ts
│       │   ├── mockProvider.ts
│       │   └── types.ts
│       └── index.tsx
├── routes/
│   └── router.tsx              # add Lab LLM route and navigation label update
├── features/projects/
│   └── ProjectsPage.tsx        # educational home with two XAI tracks + project actions
├── locales/
│   ├── en/
│   └── es/
└── content/
    └── lessons/
        └── llm/
```

## Delivery Phases

### Phase 1 - Navigation and shell

- Rename `Laboratorio` -> `Lab CV`.
- Add `Lab LLM` route and entry point.
- Keep existing responsive nav behavior.
- Update `Mis Proyectos` to introduce XAI importance and split by technology path (`Lab CV`, `Lab LLM`).

### Phase 2 - Lexi chat and explain panel

- Build conversation UI around a WebLLM-backed provider with a local mock fallback.
- Add model selector for `Gemma`, `Llama`, and `Qwen (Alibaba)`.
- Add `¿Por qué dijiste esto?` per answer.
- Render side panel with highlights, confidence, sources, limitations, and top-k next-word probabilities.

### Phase 3 - 9 exercises and progression

- Implement the 9 required exercises as guided cards/steps.
- Implement Exercise 1 with selectable/writable continuation and fixed simulated probabilities `88/8/4`.
- Implement Exercise 2 as attention lens with per-word opacity from `[0.0,1.0]` and child-friendly tooltip interactions.
- Add completion criteria and reflection fields.
- Persist progress for auth users and locally for visitors.

### Phase 4 - Ethics and safety hardening

- Add risk callouts for hallucination, bias, prompt injection.
- Add source quality and grounding checks in exercises.
- Finalize accessibility and i18n coverage.

## Risks and Mitigations

- **Risk**: Overstating explainability certainty.
  - **Mitigation**: Mandatory limitations block in panel and exercise prompts.
- **Risk**: Dependency on external LLM providers.
  - **Mitigation**: WebLLM as the primary path with a local fallback mock and explicit degraded mode.
- **Risk**: UI crowding in mobile side panel.
  - **Mitigation**: bottom-sheet fallback on narrow screens.

## Definition of Done

- Spec requirements FR-LLM-001..028 covered by implementation and tests.
- `Lab CV` + `Lab LLM` nav validated desktop/mobile.
- `Mis Proyectos` validated as pedagogical XAI home with dual-track explanation and working CTAs.
- 9 exercises complete in both `en` and `es`.
- No critical accessibility violations in Lab LLM E2E checks.
