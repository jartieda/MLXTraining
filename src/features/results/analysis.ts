import type { RunClassMetric } from '@/lib/db'

/**
 * The pure reasoning behind the results views: which pair the model confuses, what
 * changed between two runs, and what to call an exported file.
 *
 * Separated from the components for two reasons. It is the part with edge cases
 * worth testing directly — a class added between runs, a renamed class, a project
 * called "¿fruta o no?" — and keeping it out of the `.tsx` files means the
 * components stay component-only, which is what `react-refresh` wants and what
 * makes them cheap to read.
 */

// ────────────────────────────────────────────────────────── confusion

export interface ConfusedPair {
  readonly trueClass: string
  readonly predictedClass: string
  readonly count: number
  readonly share: number
}

/** Below this share of a class's own photos, a mix-up is noise rather than a finding. */
export const CONFUSION_NOTABLE_SHARE = 0.25

/**
 * The most-confused off-diagonal pair, or `null` when nothing stands out.
 *
 * Measured as a share of the true class's row, so a large class cannot win by size
 * alone — the same reasoning as the cell shading, and the reason the imbalance
 * notice and the matrix never tell a learner two different stories about one run.
 */
export function mostConfusedPair(
  perClass: readonly RunClassMetric[],
  confusion: readonly (readonly number[])[],
): ConfusedPair | null {
  let worst: ConfusedPair | null = null

  perClass.forEach((trueClass, rowIndex) => {
    const row = confusion[rowIndex] ?? []
    const rowTotal = row.reduce((sum, value) => sum + value, 0)
    if (rowTotal === 0) return

    perClass.forEach((predictedClass, columnIndex) => {
      if (rowIndex === columnIndex) return
      const count = row[columnIndex] ?? 0
      const share = count / rowTotal
      if (share >= CONFUSION_NOTABLE_SHARE && (worst === null || share > worst.share)) {
        worst = {
          trueClass: trueClass.className,
          predictedClass: predictedClass.className,
          count,
          share,
        }
      }
    })
  })

  return worst
}

// ────────────────────────────────────────────────────────── run comparison

export type Direction = 'better' | 'worse' | 'same' | 'added' | 'removed'

export interface ClassDelta {
  readonly classId: string
  readonly className: string
  /** How its accuracy moved. */
  readonly direction: Direction
  readonly baselineAccuracy: number | null
  readonly currentAccuracy: number | null
  readonly baselineCount: number | null
  readonly currentCount: number | null
  /**
   * Whether its sample count moved, tracked separately from `direction`.
   *
   * Separate because the two answer different questions and routinely disagree.
   * `evaluate` scores a run against the photographs it trained on, so on a
   * separable problem both runs read 100% however lopsided the classes were — and a
   * learner who has just taken six more photographs of her minority class would be
   * told "nothing changed", which is false and is the opposite of the fairness
   * lesson's point. FR-010 asks which classes *changed*, not only which got more
   * accurate, and adding photographs to a class changes it.
   */
  readonly countChanged: boolean
}

/** Below this, a difference is rounding rather than a change worth a sentence. */
export const MEANINGFUL_DELTA = 0.01

/**
 * Matches two runs' per-class figures **by class id**, never by position or name.
 *
 * A learner who adds a class between runs shifts every later index, and one who
 * renames a class breaks every name match. In both cases positional or name-based
 * matching produces a comparison that is confidently wrong rather than visibly
 * broken, which is the worst outcome available. Matching by id also surfaces a class
 * present in only one run as added or removed — usually the very thing she changed.
 */
export function compareRuns(
  baseline: readonly RunClassMetric[],
  current: readonly RunClassMetric[],
): readonly ClassDelta[] {
  const byId = new Map(baseline.map((entry) => [entry.classId, entry]))
  const deltas: ClassDelta[] = []

  for (const entry of current) {
    const before = byId.get(entry.classId)
    if (!before) {
      deltas.push({
        classId: entry.classId,
        className: entry.className,
        direction: 'added',
        baselineAccuracy: null,
        currentAccuracy: entry.accuracy,
        baselineCount: null,
        currentCount: entry.sampleCount,
        countChanged: true,
      })
      continue
    }

    const difference = entry.accuracy - before.accuracy
    deltas.push({
      classId: entry.classId,
      // The current name, because that is what she calls it now.
      className: entry.className,
      direction:
        Math.abs(difference) < MEANINGFUL_DELTA ? 'same' : difference > 0 ? 'better' : 'worse',
      baselineAccuracy: before.accuracy,
      currentAccuracy: entry.accuracy,
      baselineCount: before.sampleCount,
      currentCount: entry.sampleCount,
      countChanged: before.sampleCount !== entry.sampleCount,
    })
  }

  // A class that existed then and not now. Reported rather than dropped: deleting a
  // class is a change to the experiment, and a comparison that silently omits it
  // makes the overall accuracy move for no visible reason.
  const currentIds = new Set(current.map((entry) => entry.classId))
  for (const entry of baseline) {
    if (currentIds.has(entry.classId)) continue
    deltas.push({
      classId: entry.classId,
      className: entry.className,
      direction: 'removed',
      baselineAccuracy: entry.accuracy,
      currentAccuracy: null,
      baselineCount: entry.sampleCount,
      currentCount: null,
      countChanged: true,
    })
  }

  return deltas
}

/** Whether anything about this class moved between the two runs. */
export function hasChanged(delta: ClassDelta): boolean {
  return delta.direction !== 'same' || delta.countChanged
}

// ────────────────────────────────────────────────────────── export

/**
 * A project name turned into something a filesystem will accept.
 *
 * `\p{L}` keeps accented and non-Latin names intact rather than stripping them to
 * nothing — a learner who names her project "¿fruta o no?" should not get a file
 * called `_______`. The stripping also removes `/`, `\` and `.`, so a name
 * containing `../` cannot become a path the browser resolves somewhere else.
 */
export function safeFileName(projectName: string): string {
  const cleaned = projectName
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)

  return cleaned.length > 0 ? `${cleaned}-model` : 'model'
}
