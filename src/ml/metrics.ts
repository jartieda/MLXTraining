import type { TrainedModel } from './train'
import { MlError } from './types'

/**
 * T025 / FR-020, FR-021 — the figures a learner judges her model by.
 *
 * Two properties here are contracts rather than choices:
 *
 * 1. **`confusion` rows are the TRUE class.** A transposed matrix still looks like a
 *    confusion matrix and reverses every conclusion drawn from it. Rows are true,
 *    columns predicted, and the accessible table in T084 labels them that way.
 *
 * 2. **`imbalanced` is a report and never a gate.** FR-009 forbids refusing imbalanced
 *    input and FR-021 requires warning about it. The fairness module (FR-036) depends on
 *    that pairing: a learner trains a deliberately skewed model, sees the minority class
 *    collapse, rebalances, and compares the two runs. A guard added here — however
 *    well-meaning — deletes a lesson from the curriculum, which is why nothing in this
 *    module can refuse anything.
 */

export interface ClassMetrics {
  readonly classIndex: number
  readonly sampleCount: number
  /** Share of this class's own samples predicted correctly. 0 for an empty class. */
  readonly accuracy: number
}

export interface EvaluationResult {
  readonly perClass: readonly ClassMetrics[]
  /** Row = true class, column = predicted class. */
  readonly confusion: readonly (readonly number[])[]
  readonly overallAccuracy: number
  /** Largest ÷ smallest sample count. `Infinity` if a class is empty. */
  readonly imbalanceRatio: number
  /** `imbalanceRatio >= IMBALANCE_THRESHOLD`. Advisory only. */
  readonly imbalanced: boolean
}

export const IMBALANCE_THRESHOLD = 2

/**
 * Largest ÷ smallest class count.
 *
 * An empty class gives `Infinity` rather than a division-by-zero `NaN`, because `NaN`
 * propagates into the interface as "NaN" next to every other figure and destroys a
 * learner's trust in all of them. `Infinity` is at least honest and formats.
 */
export function imbalanceRatio(counts: readonly number[]): number {
  if (counts.length === 0) return 1
  const largest = Math.max(...counts)
  const smallest = Math.min(...counts)
  if (smallest === 0) return largest === 0 ? 1 : Infinity
  return largest / smallest
}

export function evaluate(
  model: TrainedModel,
  embeddings: Float32Array,
  labels: Uint8Array,
  classCount: number,
  embeddingSize: number,
): EvaluationResult {
  if (embeddings.length !== labels.length * embeddingSize) {
    throw new MlError(
      'EMBEDDING_SIZE_MISMATCH',
      `Cannot evaluate: ${String(labels.length)} labels against ${String(embeddings.length)} embedding values at ${String(embeddingSize)} per sample.`,
      { labels: labels.length, values: embeddings.length, embeddingSize },
    )
  }

  const confusion: number[][] = Array.from({ length: classCount }, () =>
    new Array<number>(classCount).fill(0),
  )
  const counts = new Array<number>(classCount).fill(0)

  for (let i = 0; i < labels.length; i++) {
    const trueClass = labels[i] ?? 0
    if (trueClass >= classCount) {
      throw new MlError(
        'LABEL_OUT_OF_RANGE',
        `A sample is labelled with class ${String(trueClass)} but only ${String(classCount)} classes exist.`,
        { label: trueClass, classCount },
      )
    }

    const probabilities = model.predictFromEmbedding(
      embeddings.subarray(i * embeddingSize, (i + 1) * embeddingSize),
    )

    // Ties resolve to the lower index, matching `predict.topClass`. Two views of one
    // prediction disagreeing on a tie would be a small, maddening inconsistency.
    let predicted = 0
    let best = -Infinity
    for (const candidate of probabilities) {
      if (candidate.probability > best) {
        best = candidate.probability
        predicted = candidate.classIndex
      }
    }

    counts[trueClass] = (counts[trueClass] ?? 0) + 1
    const row = confusion[trueClass]
    if (row) row[predicted] = (row[predicted] ?? 0) + 1
  }

  const perClass: ClassMetrics[] = Array.from({ length: classCount }, (_, classIndex) => {
    const sampleCount = counts[classIndex] ?? 0
    const correct = confusion[classIndex]?.[classIndex] ?? 0
    return {
      classIndex,
      sampleCount,
      accuracy: sampleCount === 0 ? 0 : correct / sampleCount,
    }
  })

  let correctTotal = 0
  for (let c = 0; c < classCount; c++) correctTotal += confusion[c]?.[c] ?? 0

  const ratio = imbalanceRatio(counts)

  return {
    perClass,
    confusion,
    // Over all samples, not the mean of per-class accuracies. The two diverge exactly
    // when classes are unbalanced, and reporting the mean would flatter a skewed model —
    // the opposite of what FR-021 is for.
    overallAccuracy: labels.length === 0 ? 0 : correctTotal / labels.length,
    imbalanceRatio: ratio,
    imbalanced: ratio >= IMBALANCE_THRESHOLD,
  }
}
