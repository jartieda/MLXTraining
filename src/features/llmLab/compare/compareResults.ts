/** One row of a side-by-side comparison: a word or an answer, with its probability in A and B. */
export interface ComparedRow {
  readonly label: string
  /** `null`: not among what the engine reported for that prompt. Not measured, not 0 %. */
  readonly a: number | null
  readonly b: number | null
  /** `b - a` in [-1, 1], or `null` when either side is not measured. */
  readonly delta: number | null
}

export type ChangeBand = 'same' | 'small' | 'large' | 'unknown'

/** Band thresholds, in probability (5 and 20 percentage points). Exported so tests share them. */
export const SAME_THRESHOLD = 0.05
export const LARGE_THRESHOLD = 0.2

export interface ComparisonVerdict {
  readonly rows: readonly ComparedRow[]
  readonly topA: string | null
  readonly topB: string | null
  /** Change of the answer that was most likely in A. */
  readonly delta: number | null
  readonly band: ChangeBand
}

export interface Scored {
  readonly label: string
  readonly probability: number | null
}

function normalise(label: string): string {
  return label.trim().toLocaleLowerCase('es')
}

function top(items: readonly Scored[]): string | null {
  let best: Scored | null = null
  for (const item of items) {
    if (item.probability === null) continue
    if (best === null || item.probability > (best.probability ?? -1)) best = item
  }
  return best?.label ?? null
}

export function changeBand(delta: number | null, topChanged: boolean): ChangeBand {
  if (topChanged) return 'large'
  if (delta === null) return 'unknown'
  const size = Math.abs(delta)
  if (size < SAME_THRESHOLD) return 'same'
  if (size < LARGE_THRESHOLD) return 'small'
  return 'large'
}

/**
 * Align the answers of A and B on one scale. Rows are the union of both sides, keyed by
 * the answer itself rather than its position or letter, so swapping the order of the
 * options compares "the same answer" and not "the same letter".
 */
export function compareScored(a: readonly Scored[], b: readonly Scored[]): ComparisonVerdict {
  const rows = new Map<string, { label: string; a: number | null; b: number | null }>()
  for (const item of a) rows.set(normalise(item.label), { label: item.label, a: item.probability, b: null })
  for (const item of b) {
    const existing = rows.get(normalise(item.label))
    if (existing) existing.b = item.probability
    else rows.set(normalise(item.label), { label: item.label, a: null, b: item.probability })
  }

  const ordered = [...rows.values()]
    .map((row) => ({
      ...row,
      delta: row.a !== null && row.b !== null ? row.b - row.a : null,
    }))
    .sort((left, right) => Math.max(right.a ?? 0, right.b ?? 0) - Math.max(left.a ?? 0, left.b ?? 0))

  const topA = top(a)
  const topB = top(b)
  const topChanged = topA !== null && topB !== null && normalise(topA) !== normalise(topB)
  const rowOfTopA = topA === null ? undefined : ordered.find((row) => normalise(row.label) === normalise(topA))
  const delta = rowOfTopA?.delta ?? null
  // The top answer of A vanished from B's candidates: that is a change, just not a measured one.
  const vanished = rowOfTopA !== undefined && rowOfTopA.b === null && topB !== null
  return { rows: ordered, topA, topB, delta, band: changeBand(delta, topChanged || vanished) }
}

/** Free-text answers: no probabilities, so the band is the share of words that differ. */
export function freeTextBand(changedWords: number, totalWords: number): ChangeBand {
  if (changedWords === 0) return 'same'
  return changedWords / Math.max(1, totalWords) < LARGE_THRESHOLD ? 'small' : 'large'
}
