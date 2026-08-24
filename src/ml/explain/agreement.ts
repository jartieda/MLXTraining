import type { HeatMap } from '../types'

/**
 * T065 / FR-015, FR-018 / R5 — do the two explanations agree?
 *
 * Two numbers, computed after resampling both maps to a common 14×14 grid:
 *
 * - **Spearman rank correlation** over all cells, as the headline figure.
 * - **IoU of the top 20% hottest cells**, as a "do they point at the same place"
 *   figure.
 *
 * Rank correlation is the right tool because the two methods produce values on
 * incomparable scales: Grad-CAM's are weighted activation sums, occlusion's are
 * probability drops. Only the *ordering* of importance is meaningfully shared, and
 * Pearson correlation would be distorted by the very different value
 * distributions.
 *
 * The top-k IoU is not redundant. Rank correlation over mostly-cold cells can look
 * respectable while the hot regions sit in different places — which is exactly the
 * case a learner most needs to notice, and the one a single headline number would
 * hide.
 *
 * FR-018 governs what the caller does with this: a `disagreement` band must
 * produce an explicit statement that neither map is guaranteed correct. The
 * interface must not quietly average the two or present the prettier one, and
 * nothing here returns a blended map for it to be tempted by.
 */

export interface Agreement {
  /** [-1, 1]. The headline figure. */
  readonly spearman: number
  /** [0, 1], over the hottest 20% of cells. */
  readonly topKIoU: number
  readonly band: AgreementBand
  /** Cells compared, after resampling. Reported so the figure can be qualified. */
  readonly cells: number
}

export type AgreementBand = 'strong' | 'partial' | 'disagreement'

/** R5's band thresholds. Exported so the interface and its tests share them. */
export const STRONG_THRESHOLD = 0.6
export const PARTIAL_THRESHOLD = 0.2
/** Share of cells counted as "hot" for the IoU figure. */
export const TOP_K_FRACTION = 0.2
/** The common grid both maps are resampled onto. */
export const COMPARISON_SIZE = 14

/**
 * Nearest-neighbour resample onto a square grid.
 *
 * Nearest rather than bilinear, deliberately: this is preparing values for a RANK
 * correlation, and interpolation invents intermediate values that were never
 * computed — which shifts the ranking of cells that the methods actually
 * disagreed about. Blurring the input to an agreement measure would make two maps
 * look more alike than they are, biasing every figure here in the flattering
 * direction.
 */
export function resample(map: HeatMap, size: number): Float32Array {
  if (map.width === size && map.height === size) return new Float32Array(map.values)

  const out = new Float32Array(size * size)
  for (let row = 0; row < size; row++) {
    // The +0.5 samples the centre of each target cell rather than its corner,
    // which keeps a 7 -> 14 upsample symmetric.
    const sourceRow = Math.min(map.height - 1, Math.floor(((row + 0.5) * map.height) / size))
    for (let column = 0; column < size; column++) {
      const sourceColumn = Math.min(map.width - 1, Math.floor(((column + 0.5) * map.width) / size))
      out[row * size + column] = map.values[sourceRow * map.width + sourceColumn] ?? 0
    }
  }
  return out
}

/**
 * Fractional ranks, averaging ties.
 *
 * Tie handling is load-bearing here rather than a nicety. An occlusion map
 * routinely has dozens of cells at exactly 0 — every region whose covering
 * changed nothing — and a naive ranking would order those arbitrarily, making the
 * correlation depend on array order rather than on the data.
 */
export function ranks(values: Float32Array): Float64Array {
  const order = Array.from({ length: values.length }, (_, i) => i).sort(
    (a, b) => (values[a] ?? 0) - (values[b] ?? 0),
  )

  const result = new Float64Array(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && (values[order[j + 1]!] ?? 0) === (values[order[i]!] ?? 0)) j++

    // Average rank for the whole tied run, 1-based.
    const averageRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) result[order[k]!] = averageRank
    i = j + 1
  }

  return result
}

/** Pearson correlation of two equal-length series. */
function pearson(a: Float64Array, b: Float64Array): number {
  const n = a.length
  if (n === 0) return 0

  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i] ?? 0
    meanB += b[i] ?? 0
  }
  meanA /= n
  meanB /= n

  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA
    const db = (b[i] ?? 0) - meanB
    covariance += da * db
    varianceA += da * da
    varianceB += db * db
  }

  // One of the series is constant, so no correlation is defined. Returning 0
  // rather than NaN: a NaN would propagate into the band classification and out to
  // the interface as "NaN agreement", and 0 lands honestly in `disagreement`.
  if (varianceA === 0 || varianceB === 0) return 0

  return covariance / Math.sqrt(varianceA * varianceB)
}

/** IoU of the hottest `fraction` of cells in each map. */
export function topKIoU(a: Float32Array, b: Float32Array, fraction: number): number {
  const k = Math.max(1, Math.round(a.length * fraction))

  const hottest = (values: Float32Array): Set<number> => {
    const order = Array.from({ length: values.length }, (_, i) => i).sort(
      (x, y) => (values[y] ?? 0) - (values[x] ?? 0),
    )
    return new Set(order.slice(0, k))
  }

  const setA = hottest(a)
  const setB = hottest(b)

  let intersection = 0
  for (const index of setA) if (setB.has(index)) intersection++

  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function classifyBand(spearman: number): AgreementBand {
  if (spearman >= STRONG_THRESHOLD) return 'strong'
  if (spearman >= PARTIAL_THRESHOLD) return 'partial'
  return 'disagreement'
}

/**
 * Compares two heat maps.
 *
 * Maps of differing native resolution are **resampled, not rejected** — a 7×7
 * Grad-CAM map and a 12×12 occlusion map is the normal case, and refusing it
 * would make the comparison view impossible.
 */
export function agreement(a: HeatMap, b: HeatMap): Agreement {
  const resampledA = resample(a, COMPARISON_SIZE)
  const resampledB = resample(b, COMPARISON_SIZE)

  const spearman = pearson(ranks(resampledA), ranks(resampledB))

  return {
    spearman,
    topKIoU: topKIoU(resampledA, resampledB, TOP_K_FRACTION),
    band: classifyBand(spearman),
    cells: COMPARISON_SIZE * COMPARISON_SIZE,
  }
}
