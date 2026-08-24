import type { LoadedBackbone } from '../backbone'
import type { TrainedModel } from '../train'
import { MlError, assertNotAborted, type HeatMap, type ImageSource } from '../types'

/**
 * T064 / FR-014 / R4 — perturbation-based explanation.
 *
 * A port of `computeOcclusionHeatmap` and `normalizeHeatmap` from the project's
 * prototype (`docs/prototype/occlusion-prototype.js`, vendored by T009b), with two
 * changes:
 *
 * 1. The score being perturbed is the learner's classifier probability for the
 *    chosen class, not a detector's confidence for a matched box. The prototype's
 *    `findMatchingPrediction` / IoU machinery disappears entirely with it — there
 *    is only one thing being scored here, so there is nothing to match.
 *
 * 2. **All variants in a chunk go through the backbone in ONE batched pass.** The
 *    prototype's sequential loop is the single reason occlusion feels slow: 144
 *    separate calls pay the per-call overhead 144 times. One stack of 24 through
 *    the backbone is one dispatch. This is the difference between roughly 30 s and
 *    SC-003's under-5 s budget, and it is what `tests/unit/occlusion-reference.test.ts`
 *    verifies by call count as well as numerically.
 *
 * The method is worth keeping alongside Grad-CAM for more than constitutional
 * reasons (Principle III): it is model-agnostic, and its logic — "cover this bit,
 * see if the answer changes" — is immediately intuitive to a beginner in a way
 * that gradients are not.
 *
 * **Stride is one full cell — no overlap.** An earlier revision of R4 specified
 * both "144 variants" and "50% overlap", which cannot both hold: a half-cell
 * stride over a 12×12 grid gives 23×23 = 529 positions, 3.7× the work and a 23×23
 * map. Overlap was dropped rather than the budget raised, because it buys a
 * smoother-looking map — cosmetic — at a cost that would put SC-003 out of reach
 * on the reference phone. If a smoother map is ever wanted, upsample the 144-cell
 * one; do not compute more forward passes.
 */

export interface OcclusionRequest {
  readonly image: ImageSource
  readonly classIndex: number
  /** Default 12 ⇒ a 12×12 map of 144 variants. */
  readonly gridSize?: number
  /** Patch size as a multiple of one cell. Default 1.0. */
  readonly patchScale?: number
  /** Stride as a multiple of one cell. Default 1.0, i.e. no overlap. */
  readonly strideScale?: number
  /** Variants per batched forward pass. Default 24 (R4). */
  readonly chunkSize?: number
  readonly onProgress?: (done: number, total: number) => void
  readonly signal?: AbortSignal
}

export const DEFAULT_GRID_SIZE = 12
export const DEFAULT_CHUNK_SIZE = 24

/**
 * The occluding colour.
 *
 * 128 is "the dataset mean" of R4 in the only sense that matters here: the
 * backbone normalises inputs to [-1, 1] by subtracting 127.5 and dividing, so a
 * mid-grey patch maps to approximately zero — the centre of the input
 * distribution. Occluding with black or white instead would inject a strong
 * out-of-distribution signal and the map would partly measure the model's reaction
 * to that rather than the absence of the covered content.
 */
const OCCLUSION_GREY = 128

/** How many patch positions fit along one axis, given the patch and stride. */
export function positionsPerAxis(gridSize: number, patchScale: number, strideScale: number): number {
  if (strideScale >= 1) return gridSize
  // A fractional stride multiplies both the variant count and the map size. Kept
  // computable rather than forbidden, so a lesson can demonstrate the cost.
  return Math.floor((gridSize - patchScale) / strideScale) + 1
}

/**
 * Builds one occluded copy of `image`, covering the cell at (row, column).
 *
 * A fresh copy per variant, because the batch needs all of a chunk's variants
 * alive at once. Mutating and restoring a single buffer would be cheaper and would
 * make batching impossible, which is the whole point of this file.
 */
function occlude(
  image: ImageSource,
  row: number,
  column: number,
  cellSize: number,
  patchPixels: number,
  strideScale: number,
): ImageSource {
  const data = new Uint8ClampedArray(image.data)

  const startX = Math.round(column * cellSize * strideScale)
  const startY = Math.round(row * cellSize * strideScale)
  const endX = Math.min(image.width, startX + patchPixels)
  const endY = Math.min(image.height, startY + patchPixels)

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const offset = (y * image.width + x) * 4
      data[offset] = OCCLUSION_GREY
      data[offset + 1] = OCCLUSION_GREY
      data[offset + 2] = OCCLUSION_GREY
      // Alpha is left alone: these are opaque frames, and zeroing it would make
      // the patch transparent rather than grey once composited.
    }
  }

  return { data, width: image.width, height: image.height }
}

export async function occlusionSensitivity(
  model: TrainedModel,
  backbone: LoadedBackbone,
  req: OcclusionRequest,
): Promise<HeatMap> {
  const gridSize = req.gridSize ?? DEFAULT_GRID_SIZE
  const patchScale = req.patchScale ?? 1
  const strideScale = req.strideScale ?? 1
  const chunkSize = req.chunkSize ?? DEFAULT_CHUNK_SIZE

  if (!Number.isInteger(gridSize) || gridSize < 2) {
    throw new MlError('IMAGE_SIZE_MISMATCH', `The occlusion grid must be at least 2×2; got ${String(gridSize)}.`)
  }

  if (
    !Number.isInteger(req.classIndex) ||
    req.classIndex < 0 ||
    req.classIndex >= model.classCount
  ) {
    throw new MlError(
      'CLASS_INDEX_OUT_OF_RANGE',
      `Cannot explain class ${String(req.classIndex)}: this model has ${String(model.classCount)} classes.`,
      { classIndex: req.classIndex, classCount: model.classCount },
    )
  }

  assertNotAborted(req.signal)

  const side = positionsPerAxis(gridSize, patchScale, strideScale)
  const total = side * side
  const cellSize = Math.min(req.image.width, req.image.height) / gridSize
  const patchPixels = Math.max(1, Math.round(cellSize * patchScale))

  // The unoccluded score, against which every drop is measured. One extra forward
  // pass, and the only one that is not batched.
  const baseline = await model.predict(req.image, backbone)
  const baseProbability = baseline[req.classIndex]?.probability ?? 0

  const drops = new Float32Array(total)
  let done = 0

  for (let start = 0; start < total; start += chunkSize) {
    assertNotAborted(req.signal)

    const end = Math.min(total, start + chunkSize)
    const variants: ImageSource[] = []
    for (let index = start; index < end; index++) {
      variants.push(
        occlude(
          req.image,
          Math.floor(index / side),
          index % side,
          cellSize,
          patchPixels,
          strideScale,
        ),
      )
    }

    // THE batched call. One `embedBatch` per chunk — not one per variant — which is
    // the performance requirement and is asserted by call count in T060.
    const embeddings = await backbone.embedBatch(variants)
    const embeddingSize = backbone.embeddingSize

    for (let i = 0; i < variants.length; i++) {
      const embedding = embeddings.subarray(i * embeddingSize, (i + 1) * embeddingSize)
      const probabilities = model.predictFromEmbedding(embedding)
      const occludedProbability = probabilities[req.classIndex]?.probability ?? 0
      // Clamped at 0: a cell whose covering made the model MORE confident is not
      // evidence for the class, and letting it go negative would break the
      // normalisation and paint as a cold cell anyway.
      drops[start + i] = Math.max(0, baseProbability - occludedProbability)
    }

    done = end
    // At least once per chunk (contract). This is the only feedback a learner gets
    // during a five-second wait, so it is not optional.
    req.onProgress?.(done, total)
  }

  assertNotAborted(req.signal)

  // Normalise by the largest drop, exactly as the prototype's `normalizeHeatmap`
  // did — and with the same guard: an all-zero map is left alone rather than
  // divided by zero. That case is real and informative, meaning no single cell
  // mattered to this class on this frame.
  let maximum = 0
  for (const value of drops) maximum = Math.max(maximum, value)
  if (maximum > 0) {
    for (let i = 0; i < drops.length; i++) drops[i] = (drops[i] ?? 0) / maximum
  }

  return {
    values: drops,
    width: side,
    height: side,
    method: 'occlusion',
    classIndex: req.classIndex,
    params: {
      gridSize,
      patchSize: patchPixels,
      stride: Math.round(cellSize * strideScale),
      degenerate: maximum > 0 ? 0 : 1,
    },
  }
}
