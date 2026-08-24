import * as tf from '@tensorflow/tfjs'
import type { LoadedBackbone } from '../backbone'
import type { TrainedModel } from '../train'
import { MlError, type HeatMap, type TargetLayer } from '../types'

/**
 * T053 / FR-013, FR-016 / R3 — gradient-based explanation.
 *
 * The standard Grad-CAM formulation, against the frozen truncated backbone's
 * activation tensor:
 *
 *   1. A       = truncated(x)                    [1, 7, 7, C]
 *   2. grads   = ∂(score for classIndex) / ∂A    [1, 7, 7, C]
 *   3. weights = mean of grads over the spatial axes         [1, 1, 1, C]
 *   4. cam     = relu(sum over channels of A · weights)      [1, 7, 7]
 *   5. normalise by the map's OWN maximum
 *
 * Because the backbone is frozen, the gradient only has to traverse the small
 * head, so this is cheap — comfortably inside SC-003's one-second budget.
 *
 * Four details are load-bearing, and each one produces a plausible-looking wrong
 * map if got wrong:
 *
 * - **`gather` on one class, before the sum.** Taking the gradient of the summed
 *   output instead gives a map that is identical for every class. It looks smooth,
 *   it highlights the subject, and it makes FR-016 silently false. T050 asserts
 *   two classes differ for exactly this reason.
 * - **The ReLU at step 4.** Without it the map is a signed mixture rather than
 *   evidence *for* the class.
 * - **Normalising by the map's own maximum**, not a global one. This is what makes
 *   the legend meaningful, and it is also why the legend must be labelled
 *   relatively ("low → high evidence") rather than as a quantity.
 * - **The all-zero-gradient guard.** Dividing by a zero maximum yields NaN, and a
 *   NaN map paints as a blank or garbage overlay with nothing to say it failed.
 *
 * No upsampling happens here. The map is returned at its native 7×7 or 14×14 and
 * the caller scales it for display. That coarseness is real and pedagogically
 * relevant (R3): a 7×7 map upsampled to 224 px cannot localise a small object, and
 * the interface must not imply more precision than exists.
 */

export interface GradCamRequest {
  readonly image: import('../types').ImageSource
  /** Any class, not only the predicted one (FR-016). */
  readonly classIndex: number
  readonly targetLayer?: TargetLayer
}

export async function gradCam(
  model: TrainedModel,
  backbone: LoadedBackbone,
  req: GradCamRequest,
): Promise<HeatMap> {
  const targetLayer = req.targetLayer ?? 'conv_pw_13_relu'

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

  // The spatial activation, as a copy of plain numbers. Taken through the
  // backbone's public `activation` so this module never has to know how the
  // sub-model for a target layer is built or cached.
  const activation = await backbone.activation(req.image, targetLayer)

  // For the finer 14×14 layer the gradient must travel through the remaining
  // backbone blocks before it reaches the head: `conv_pw_11_relu` has half the
  // channels the trained head accepts, so there is no shortcut. `null` at the
  // truncation point, where the activation feeds the head directly.
  const tail = backbone.tailFrom(targetLayer)

  const { values, degenerate } = tf.tidy(() => {
    const a = tf.tensor4d(
      activation.values,
      [1, activation.height, activation.width, activation.channels],
      'float32',
    )

    // The head's SPATIAL path, which shares its weights with the pooled path used
    // for training and inference (see head.ts). Using an independently built model
    // here would compute gradients of an untrained network while everything else
    // looked correct.
    const spatialHead = model.head.spatial

    // `tf.grad` types its callback as `Tensor -> Tensor`, so the rank is narrowed
    // inside rather than in the signature.
    const gradients = tf.grad((input: tf.Tensor) => {
      const atTruncation = tail
        ? (tail.apply(input, { training: false }) as tf.Tensor4D)
        : input
      const logits = spatialHead.apply(atTruncation, { training: false }) as tf.Tensor2D
      // `gather` on the one class, and only then a sum to a scalar. This is the
      // line that makes the map class-specific.
      return logits.gather([req.classIndex], 1).sum()
    })(a) as tf.Tensor4D

    // Spatial mean per channel: how much this channel matters to this class.
    const weights = gradients.mean<tf.Tensor4D>([1, 2], true)

    const cam = tf.relu(a.mul(weights).sum(3)) as tf.Tensor3D

    const maximum = cam.max().dataSync()[0] ?? 0

    // Every gradient was zero — the map carries no information. Returning zeros
    // rather than NaN, and flagging it, so the caller can say "no evidence could
    // be computed" instead of showing an empty overlay a learner would read as a
    // claim about the model.
    if (!Number.isFinite(maximum) || maximum <= 0) {
      return { values: new Float32Array(activation.width * activation.height), degenerate: true }
    }

    return { values: cam.div(maximum).dataSync<'float32'>(), degenerate: false }
  })

  return {
    // `dataSync` inside `tidy` returns a view over a buffer tidy may reuse, so the
    // values are copied out at the boundary — the contract promises plain data
    // that outlives the call.
    values: new Float32Array(values),
    width: activation.width,
    height: activation.height,
    method: 'gradcam',
    classIndex: req.classIndex,
    // `degenerate` travels in `params` so it is part of the cache key too: a map
    // computed when the gradients were all zero must not be served later as though
    // it were a real result (D8).
    params: { targetLayer, degenerate: degenerate ? 1 : 0 },
  }
}

/**
 * Describes in words where the strongest evidence falls (T057, FR-017, SC-009).
 *
 * A canvas is invisible to a screen reader, so this is the only route to the same
 * information — which makes it a requirement rather than a nicety. It lives here,
 * next to the computation, so the positional language is derived from the actual
 * map rather than reconstructed in the interface layer.
 *
 * The returned value is a **structure, not a sentence**: the wording has to be
 * translated (FR-044), and building an English sentence here would put
 * untranslatable text in the ML core.
 */
export interface HeatMapSummary {
  /** Row band of the hottest cell. */
  readonly vertical: 'top' | 'middle' | 'bottom'
  /** Column band of the hottest cell. */
  readonly horizontal: 'left' | 'centre' | 'right'
  /** Share of cells carrying at least half the maximum evidence, in [0,1]. */
  readonly spread: number
  /** True when the evidence is spread widely rather than concentrated. */
  readonly diffuse: boolean
  /** True when the map is all zero — no evidence could be computed. */
  readonly degenerate: boolean
}

const DIFFUSE_THRESHOLD = 0.35

export function summariseHeatMap(map: HeatMap): HeatMapSummary {
  let hottestIndex = 0
  let hottest = -Infinity
  let warmCells = 0

  for (let i = 0; i < map.values.length; i++) {
    const value = map.values[i] ?? 0
    if (value > hottest) {
      hottest = value
      hottestIndex = i
    }
  }

  for (const value of map.values) {
    if (value >= hottest / 2) warmCells++
  }

  const row = Math.floor(hottestIndex / map.width)
  const column = hottestIndex % map.width

  // Thirds rather than a centre point: on a 7×7 grid "row 3 of 7" means nothing to
  // a learner, and "the middle" is both true and useful.
  const band = (index: number, size: number): 0 | 1 | 2 => {
    const third = size / 3
    if (index < third) return 0
    if (index < third * 2) return 1
    return 2
  }

  const spread = map.values.length === 0 ? 0 : warmCells / map.values.length

  return {
    vertical: (['top', 'middle', 'bottom'] as const)[band(row, map.height)],
    horizontal: (['left', 'centre', 'right'] as const)[band(column, map.width)],
    spread,
    // A map where most cells are warm is not pointing anywhere in particular, and
    // saying "the top left" about it would be a more confident claim than the data
    // supports.
    diffuse: spread > DIFFUSE_THRESHOLD,
    degenerate: hottest <= 0,
  }
}
