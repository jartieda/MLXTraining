/**
 * T017 — the shared vocabulary of the ML core, per contracts/ml-core.md.
 *
 * Every type here is DOM-free. That is the whole point: Principle VI requires `src/ml/`
 * to be testable in a node environment before any interface is wired to it, and the
 * moment a signature mentions `HTMLCanvasElement` or `ImageData` the module can only run
 * in a browser. Converting a canvas, a video frame or a decoded file into an
 * `ImageSource` is the feature layer's job, at that boundary and nowhere else.
 *
 * The ml4g/ml-core-import-boundary lint rule enforces this rather than trusting it.
 */

/** Backbone width. `0.5`, not `0.50` — the latter is not a distinct TypeScript literal. */
export type Alpha = 0.25 | 0.5

/**
 * The two Grad-CAM target layers. `conv_pw_13_relu` is 7×7 and the default;
 * `conv_pw_11_relu` is 14×14 and offered to learners as "finer detail" (R3).
 */
export type TargetLayer = 'conv_pw_13_relu' | 'conv_pw_11_relu'

export type BackendKind = 'webgl' | 'wasm' | 'cpu'

export type ExplanationMethod = 'gradcam' | 'occlusion'

/** The square input side MobileNet v1 expects. */
export const MODEL_INPUT_SIZE = 224

/**
 * A raw image, expressed without any DOM type.
 * `data` is RGBA, so `data.length === width * height * 4`.
 */
export interface ImageSource {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

/** Spatial activations of one convolutional layer, channels-last, row-major. */
export interface SpatialActivation {
  readonly values: Float32Array
  /** 7 for `conv_pw_13_relu`, 14 for `conv_pw_11_relu`. */
  readonly width: number
  readonly height: number
  /** 512 at alpha 0.5, 256 at 0.25 (halved again for `conv_pw_11_relu`). */
  readonly channels: number
  readonly layer: TargetLayer
}

/**
 * A heat map at its **native** resolution, normalised to [0,1].
 *
 * `width`/`height` are method-specific — 7 or 14 for `gradcam` depending on the target
 * layer, and the occlusion grid size (12 by default) for `occlusion`. A caller that
 * assumes 7 or 14 will silently corrupt every occlusion map, which is why the resolution
 * travels with the data rather than being inferred from the method.
 */
export interface HeatMap {
  readonly values: Float32Array
  readonly width: number
  readonly height: number
  readonly method: ExplanationMethod
  readonly classIndex: number
  readonly params: Readonly<Record<string, number | string>>
}

export interface ClassProbability {
  readonly classIndex: number
  /** [0,1]. Across a full result set these sum to 1 ± 1e-5. */
  readonly probability: number
}

export interface BackendReport {
  readonly active: BackendKind
  /** `false` obliges the interface to warn that things will be slower (FR-047). */
  readonly accelerated: boolean
  readonly attempted: readonly BackendKind[]
}

/**
 * Errors thrown out of `src/ml/` surface to a 14-year-old through the interface layer, so
 * every one carries a machine-readable `code` the feature layer maps to a translated
 * string, plus an English message that names what to do about it (contract obligation 5).
 */
export type MlErrorCode =
  | 'GRAPH_MODEL_UNSUPPORTED'
  | 'BACKBONE_LAYER_MISSING'
  | 'TOO_FEW_CLASSES'
  | 'EMPTY_CLASS'
  | 'LABEL_OUT_OF_RANGE'
  | 'EMBEDDING_SIZE_MISMATCH'
  | 'NO_SAMPLES'
  | 'ABORTED'
  | 'CLASS_INDEX_OUT_OF_RANGE'
  | 'IMAGE_SIZE_MISMATCH'
  | 'MODEL_NOT_FOUND'

export class MlError extends Error {
  readonly code: MlErrorCode
  /**
   * Interpolation values for the translated message — e.g. the name of the empty class,
   * which Acceptance Scenario 1.3 requires the interface to name.
   */
  readonly details: Readonly<Record<string, string | number>>

  constructor(code: MlErrorCode, message: string, details: Record<string, string | number> = {}) {
    super(message)
    this.name = 'MlError'
    this.code = code
    this.details = details
  }
}

/** Narrowing helper for the feature layer, which must not `instanceof` across a bundle split. */
export function isMlError(error: unknown): error is MlError {
  return error instanceof MlError || (error instanceof Error && error.name === 'MlError')
}

/** Thrown when an `AbortSignal` fires. Distinct because cancelling is not a failure. */
export function abortError(): MlError {
  return new MlError('ABORTED', 'The operation was cancelled before it finished.')
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

/** Number of cells in a heat map, which is the length its `values` must have. */
export function heatMapLength(map: Pick<HeatMap, 'width' | 'height'>): number {
  return map.width * map.height
}
