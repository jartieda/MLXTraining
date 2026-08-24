# Contract: ML Core (`src/ml/`)

**Feature**: `001-xai-lab` | **Date**: 2026-08-17

This module is the project's most important internal contract. Constitution Principle VI requires it
to be testable before any interface is wired to it, so it **must not import from `src/features/`,
`src/components/`, or `src/lib/`**, must not touch the DOM, and must not make a network request other
than loading the backbone through the URL it is given.

Every function that produces tensors wraps its body in `tf.tidy` and returns plain
`Float32Array`/number data at the boundary — no `tf.Tensor` crosses out of this module except the
opaque handles inside `LoadedBackbone` and `TrainedModel`, which own their own `dispose()`.

---

## Shared types

```ts
export type Alpha = 0.25 | 0.5
export type TargetLayer = 'conv_pw_13_relu' | 'conv_pw_11_relu'
export type BackendKind = 'webgl' | 'wasm' | 'cpu'

/**
 * A raw image, expressed without any DOM type so that `src/ml/` stays importable
 * in a node test environment (Principle VI, and the import-boundary lint rule).
 */
export interface ImageSource {
  readonly data: Uint8ClampedArray   // RGBA, length === width * height * 4
  readonly width: number
  readonly height: number
}

/** Spatial activations of one convolutional layer, channels-last. */
export interface SpatialActivation {
  readonly values: Float32Array   // length === width * height * channels, row-major
  readonly width: number          // 7 for conv_pw_13_relu, 14 for conv_pw_11_relu
  readonly height: number
  readonly channels: number       // 512 at alpha 0.50, 256 at 0.25
  readonly layer: TargetLayer
}

/** A heat map at its native resolution, values normalised to [0,1]. */
export interface HeatMap {
  readonly values: Float32Array   // length === width * height, row-major
  /**
   * Native resolution, which depends on the method:
   *   gradcam   → 7 for conv_pw_13_relu, 14 for conv_pw_11_relu
   *   occlusion → the occlusion grid size, 12 by default
   * Callers must not assume 7 or 14; upsampling to the display size is the caller's job.
   */
  readonly width: number
  readonly height: number
  readonly method: 'gradcam' | 'occlusion'
  readonly classIndex: number
  readonly params: Readonly<Record<string, number | string>>
}

export interface ClassProbability {
  readonly classIndex: number
  readonly probability: number    // [0,1]
}
```

---

## `backend.ts`

```ts
export interface BackendReport {
  readonly active: BackendKind
  readonly accelerated: boolean   // false ⇒ interface must warn (FR-047)
  readonly attempted: readonly BackendKind[]
}

/** Selects webgl → wasm → cpu. Never throws; worst case reports 'cpu'. */
export function initBackend(preferred?: BackendKind): Promise<BackendReport>
```

**Contract**: idempotent — repeated calls return the same report without re-initialising.
**Must not** throw when WebGL is unavailable; that path is a supported degradation (SC-012).

---

## `backbone.ts`

```ts
export interface LoadedBackbone {
  readonly alpha: Alpha
  /** Pooled embedding for training. Length 512 at alpha 0.50, 256 at 0.25. */
  embed(image: ImageSource): Promise<Float32Array>
  /** Batched variant. Result length === images.length * embeddingSize. */
  embedBatch(images: readonly ImageSource[]): Promise<Float32Array>
  /** Spatial activation for Grad-CAM. Not persisted (see data-model.md). */
  activation(image: ImageSource, layer: TargetLayer): Promise<SpatialActivation>
  readonly embeddingSize: number
  dispose(): void
}

export function loadBackbone(url: string, alpha: Alpha): Promise<LoadedBackbone>
export function warmUp(backbone: LoadedBackbone): Promise<void>
```

**Contract**:
- Loads a **Layers** model and truncates it at the requested layer. A graph model must be rejected
  with a clear error, because `tf.model({inputs, outputs})` cannot slice one (R1).
- Backbone weights are frozen. `embed` must be deterministic for identical input.
- `warmUp` runs one throwaway pass so the first learner-visible inference is not the one paying
  shader-compilation cost.
- `dispose()` must return `tf.memory().numTensors` to its pre-load value.
- Converting a canvas, a video frame, or a decoded file into an `ImageSource` is the **feature
  layer's** job. `src/ml/` accepts the plain structure and never touches a DOM type, which is what
  lets the whole module be tested in a node environment (Principle VI).

---

## `train.ts`

```ts
export interface TrainRequest {
  readonly embeddings: Float32Array      // concatenated, embeddingSize per sample
  readonly labels: Uint8Array            // class index per sample
  readonly classCount: number            // ≥ 2 (FR-001)
  readonly embeddingSize: number
  readonly epochs?: number               // default 20
  readonly batchSize?: number            // default 16
  readonly validationSplit?: number      // default 0.2, dropped if any class has < 5 samples
  readonly seed?: number                 // required by tests for determinism
  readonly onEpochEnd?: (epoch: number, loss: number, accuracy: number) => void
  readonly signal?: AbortSignal          // FR-007
}

export interface TrainedModel {
  readonly classCount: number
  predict(image: ImageSource, backbone: LoadedBackbone): Promise<ClassProbability[]>
  predictFromEmbedding(embedding: Float32Array): ClassProbability[]
  /** Raw head, needed by gradcam(). Implementation detail, not for feature code. */
  readonly head: unknown
  save(key: string): Promise<void>
  dispose(): void
}

export function trainClassifier(req: TrainRequest): Promise<TrainedModel>
export function loadModel(key: string, classCount: number): Promise<TrainedModel>
```

**Contract**:
- Rejects `classCount < 2`, an empty class, or a label outside `[0, classCount)` with a named,
  actionable error (FR-001, Acceptance Scenario 1.3).
- **Must train on imbalanced input without refusing** (FR-009). Imbalance is reported by
  `metrics.ts`, never enforced here.
- Aborting via `signal` must leave no tensors allocated and must not save a partial model.
- Returned probabilities sum to 1 ± 1e-5 and are ordered by `classIndex` (Acceptance Scenario 1.1).
- With an identical `seed` and identical input, two calls must produce identical probabilities. This
  is what makes the whole suite deterministic.

---

## `explain/gradcam.ts`

```ts
export interface GradCamRequest {
  readonly image: ImageSource
  readonly classIndex: number            // any class, not just the predicted one (FR-016)
  readonly targetLayer?: TargetLayer     // default 'conv_pw_13_relu'
}

export function gradCam(
  model: TrainedModel,
  backbone: LoadedBackbone,
  req: GradCamRequest,
): Promise<HeatMap>
```

**Contract**:
- Implements the standard formulation: spatially averaged gradients as channel weights, weighted sum
  of activations, ReLU, normalise by the map's own maximum (R3).
- Output `width`/`height` is 7 for `conv_pw_13_relu` and 14 for `conv_pw_11_relu`.
- Values in [0,1] with at least one cell equal to 1, unless every gradient is zero — in which case
  it returns an all-zero map rather than dividing by zero, and the caller must be able to detect
  that.
- Must complete within 1 s on a mid-range laptop (SC-003).
- **Test obligation**: asserted against a stored reference map within tolerance, and asserted to
  produce *different* maps for different `classIndex` values on the same image. A method that
  ignores the class is the classic silent Grad-CAM bug.

---

## `explain/occlusion.ts`

```ts
export interface OcclusionRequest {
  readonly image: ImageSource
  readonly classIndex: number
  readonly gridSize?: number             // default 12 ⇒ a 12×12 map of 144 variants
  readonly patchScale?: number           // default 1.0 (patch = one cell)
  readonly strideScale?: number          // default 1.0 (no overlap) — see the R4 correction
  readonly chunkSize?: number            // default 24 variants per batch (R4)
  readonly onProgress?: (done: number, total: number) => void
  readonly signal?: AbortSignal
}

export function occlusionSensitivity(
  model: TrainedModel,
  backbone: LoadedBackbone,
  req: OcclusionRequest,
): Promise<HeatMap>
```

**Contract**:
- Each cell's value is the **drop** in the chosen class's probability when that cell is covered,
  clamped at 0, then normalised by the largest drop.
- The returned map is `gridSize × gridSize` — 12×12 by default, **not** 7 or 14. With the default
  `strideScale` of 1.0 the variant count is exactly `gridSize²` = 144; a fractional stride would
  multiply both the count and the map size and is not the default for that reason (R4).
- All variants in a chunk go through the backbone in **one batched pass** — not one call per variant
  (R4). This is the performance requirement, and it is testable by call count.
- `onProgress` fires at least once per chunk; `signal` cancels promptly, leaving no tensors
  allocated (Acceptance Scenario 3.3).
- Must complete a 12×12 grid within 5 s on a mid-range laptop (SC-003).
- **Test obligation**: must agree, within tolerance, with a naive reference implementation that
  predicts one variant at a time. This is the single highest-value test in the project — a batching
  error still produces a plausible-looking heat map, so only a numeric comparison against a
  known-correct slow path will catch it (R13).

---

## `explain/agreement.ts`

```ts
export interface Agreement {
  readonly spearman: number              // [-1, 1]
  readonly topKIoU: number               // [0, 1], over the hottest 20% of cells
  readonly band: 'strong' | 'partial' | 'disagreement'
}

/** Resamples both maps to a common 14×14 grid before comparing. */
export function agreement(a: HeatMap, b: HeatMap): Agreement
```

**Contract**: bands are `strong` at `spearman ≥ 0.6`, `partial` at `0.2 ≤ spearman < 0.6`,
`disagreement` below `0.2` (R5). Maps of differing native resolution are resampled, not rejected.
The caller **must** surface a `disagreement` band explicitly and must not blend the two maps
(FR-018).

---

## `explain/colormap.ts`

```ts
/** Inferno ramp. Returns RGBA, 4 bytes per input value. */
export function applyColormap(map: HeatMap, opacity: number): Uint8ClampedArray
export function legendStops(count: number): readonly string[]
```

**Contract**: perceptually uniform and monotonic in lightness (R6). `opacity` in [0,1] maps to the
alpha channel, supporting FR-019. Must not be swapped for a brand-coloured ramp — Principle V
exempts heat maps precisely so this stays a data visualisation.

---

## `metrics.ts`

```ts
export interface ClassMetrics {
  readonly classIndex: number
  readonly sampleCount: number
  readonly accuracy: number              // [0,1]
}

export interface EvaluationResult {
  readonly perClass: readonly ClassMetrics[]
  readonly confusion: readonly (readonly number[])[]   // row = true, column = predicted
  readonly overallAccuracy: number
  readonly imbalanceRatio: number        // largest ÷ smallest sample count
  readonly imbalanced: boolean           // imbalanceRatio ≥ 2
}

export function evaluate(
  model: TrainedModel,
  embeddings: Float32Array,
  labels: Uint8Array,
  classCount: number,
  embeddingSize: number,
): EvaluationResult
```

**Contract**: `confusion` is square with side `classCount`, rows indexed by true class. Rows sum to
that class's sample count. `imbalanced` is a report only — it must never gate training (FR-009,
FR-021), because the fairness module depends on a learner being able to train a deliberately skewed
model and see what happens (FR-036).

---

## Cross-cutting obligations

1. **Memory neutrality.** Every exported function must leave `tf.memory().numTensors` unchanged,
   except those documented to return a disposable handle. A development-only assertion enforces this
   and fails the test suite on a leak (R8).
2. **Determinism.** Given a seed, identical inputs produce bit-identical outputs on the `cpu`
   backend. Tests pin `tf.setBackend('cpu')`.
3. **No DOM, no network, no camera.** Enforced by an import-boundary lint rule, not by convention.
4. **Cancellation.** Every function accepting an `AbortSignal` must honour it within one chunk or
   epoch and must not leak on abort.
5. **Errors are actionable.** Every thrown error names what was wrong and what the caller should do,
   because these messages surface to a 14-year-old through the interface layer.
