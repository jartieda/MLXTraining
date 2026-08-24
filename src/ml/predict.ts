import type { LoadedBackbone } from './backbone'
import type { TrainedModel } from './train'
import type { ClassProbability, ImageSource } from './types'

/**
 * T023 / FR-011 — inference.
 *
 * A thin module by design: `TrainedModel` already owns the head, so this exists to give
 * the feature layer a stable, named entry point that does not require it to reach into a
 * model handle, and to hold the ordering and top-class rules in one place rather than
 * repeated at each call site.
 *
 * The result is always **ordered by `classIndex`** and always **complete** — one entry per
 * class, including classes with a near-zero probability. FR-011 requires every class's
 * confidence to be shown, and a caller that received a filtered or sorted list would have
 * to reconstruct the order to line the bars up with the class list, which is exactly the
 * kind of off-by-one that renders a plausible but wrong display.
 */

/** One backbone pass plus one head pass. Ordered by `classIndex`. */
export async function classify(
  model: TrainedModel,
  backbone: LoadedBackbone,
  image: ImageSource,
): Promise<ClassProbability[]> {
  return model.predict(image, backbone)
}

/**
 * The head pass alone, for a sample whose embedding is already cached (D4). This is the
 * path the results view uses to score a whole project without touching an image.
 */
export function predictFromEmbedding(
  model: TrainedModel,
  embedding: Float32Array,
): ClassProbability[] {
  return model.predictFromEmbedding(embedding)
}

/**
 * The winning class. Ties resolve to the lower `classIndex`, deterministically — a live
 * display that flickered between two equal classes would look broken, and on a freshly
 * initialised model exact ties do happen.
 */
export function topClass(probabilities: readonly ClassProbability[]): ClassProbability | null {
  let best: ClassProbability | null = null
  for (const candidate of probabilities) {
    if (!best || candidate.probability > best.probability) best = candidate
  }
  return best
}

/**
 * Formats a probability as a whole percentage.
 *
 * Rounding is done here rather than at each display site so that the per-class bars a
 * learner reads always sum to 100 (Acceptance Scenario 1.1, asserted by T039). Rounding
 * each value independently produces 33/33/33 or 34/33/34, and a learner who notices that
 * the numbers do not add up has been given a reason to distrust everything else the lab
 * tells her. The largest remainder takes the slack.
 */
export function toWholePercentages(probabilities: readonly ClassProbability[]): number[] {
  const scaled = probabilities.map((p) => p.probability * 100)
  const floored = scaled.map((value) => Math.floor(value))
  const deficit = 100 - floored.reduce((a, b) => a + b, 0)

  const byRemainder = scaled
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  const result = [...floored]
  for (let i = 0; i < Math.max(0, deficit); i++) {
    const target = byRemainder[i % byRemainder.length]
    if (target) result[target.index] = (result[target.index] ?? 0) + 1
  }
  return result
}
