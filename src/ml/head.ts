import * as tf from '@tensorflow/tfjs'
import type { LayersModel } from '@tensorflow/tfjs'

/**
 * T022 / R2 — the trainable classification head.
 *
 * Architecture from R2:
 *
 *   GlobalAveragePooling2D → Dropout(0.2) → Dense(100, relu) → Dropout(0.2) → Dense(n, softmax)
 *
 * **Why two models over one set of layers.** The head has to be usable from two
 * directions:
 *
 *   - training and inference feed a *pooled* embedding, because the pooled vector is what
 *     is cached per sample at capture time so that pressing Train never runs the backbone
 *     (R2, and the whole reason SC-002 is comfortable rather than tight);
 *   - Grad-CAM feeds the *spatial* activation `[1, 7, 7, C]`, because it needs gradients
 *     with respect to that tensor (R3).
 *
 * Building two `tf.model`s over the **same layer objects** gives both without duplicating
 * weights: training the pooled path updates exactly the weights the spatial path reads.
 * Building two independent models instead would be the subtle catastrophe — training would
 * work, Grad-CAM would run, and every heat map would explain an untrained network.
 *
 * `GlobalAveragePooling2D` over `[7, 7, C]` is the mean over the spatial axes, which is
 * precisely what `backbone.embedBatch` computes, so the two entry points see identical
 * features.
 */

export const HIDDEN_UNITS = 100
export const DROPOUT_RATE = 0.2

export interface ClassifierHead {
  /** Input `[batch, embeddingSize]` — the training and inference path. */
  readonly pooled: LayersModel
  /** Input `[batch, h, w, channels]` — the Grad-CAM path. Shares `pooled`'s weights. */
  readonly spatial: LayersModel
  readonly classCount: number
  readonly embeddingSize: number
  dispose(): void
}

export interface BuildHeadOptions {
  readonly embeddingSize: number
  readonly classCount: number
  /** Spatial side of the activation the Grad-CAM path accepts. 7 or 14 (R3). */
  readonly spatialSize?: number
  /**
   * Seeds the weight initialisers and the dropout masks.
   *
   * A seeded dropout mask is the same mask every step, which is weaker regularisation
   * than fresh noise. That trade is deliberate and one-directional: with `seed` omitted —
   * the production path — dropout is properly stochastic, and only a caller that has
   * asked for reproducibility gets the fixed mask. Contract obligation 2 requires
   * bit-identical output for a given seed, and tfjs offers no way to have both.
   */
  readonly seed?: number
}

export function buildHead({
  embeddingSize,
  classCount,
  spatialSize = 7,
  seed,
}: BuildHeadOptions): ClassifierHead {
  // Distinct offsets so the two Dense layers do not start from the same numbers, which
  // would make the hidden layer's rows correlated at step 0.
  const kernelSeed = seed === undefined ? undefined : seed
  const outputSeed = seed === undefined ? undefined : seed + 1

  const pool = tf.layers.globalAveragePooling2d({ name: 'head_pool' })
  const dropout1 = tf.layers.dropout({
    name: 'head_dropout_1',
    rate: DROPOUT_RATE,
    ...(seed === undefined ? {} : { seed }),
  })
  const hidden = tf.layers.dense({
    name: 'head_hidden',
    units: HIDDEN_UNITS,
    activation: 'relu',
    kernelInitializer: tf.initializers.glorotNormal({ ...(kernelSeed === undefined ? {} : { seed: kernelSeed }) }),
  })
  const dropout2 = tf.layers.dropout({
    name: 'head_dropout_2',
    rate: DROPOUT_RATE,
    ...(seed === undefined ? {} : { seed: seed + 2 }),
  })
  const output = tf.layers.dense({
    name: 'head_output',
    units: classCount,
    activation: 'softmax',
    kernelInitializer: tf.initializers.glorotNormal({ ...(outputSeed === undefined ? {} : { seed: outputSeed }) }),
  })

  // Pooled path: the embedding is already pooled, so `pool` is skipped.
  const pooledInput = tf.input({ shape: [embeddingSize], name: 'head_pooled_input' })
  const pooledOutput = output.apply(
    dropout2.apply(hidden.apply(dropout1.apply(pooledInput))),
  ) as tf.SymbolicTensor
  const pooled = tf.model({ inputs: pooledInput, outputs: pooledOutput, name: 'head_pooled' })

  // Spatial path: same layer objects, with the pooling in front.
  const spatialInput = tf.input({
    shape: [spatialSize, spatialSize, embeddingSize],
    name: 'head_spatial_input',
  })
  const spatialOutput = output.apply(
    dropout2.apply(hidden.apply(dropout1.apply(pool.apply(spatialInput)))),
  ) as tf.SymbolicTensor
  const spatial = tf.model({ inputs: spatialInput, outputs: spatialOutput, name: 'head_spatial' })

  return {
    pooled,
    spatial,
    classCount,
    embeddingSize,
    dispose: () => {
      // The optimiser first, and explicitly: `LayersModel.dispose()` frees the layers'
      // weights but not Adam's accumulators, which are two extra variables per trainable
      // weight plus a step counter. That is ~15 tensors left behind per training run —
      // invisible in a single run and fatal in a classroom session where a learner
      // retrains a dozen times (R8).
      pooled.optimizer?.dispose()

      // **Both** models are disposed here, which is the opposite of what backbone.ts
      // does, and the difference is not arbitrary. `Layer.apply()` increments the layer's
      // reference count, and the shared layers below are applied twice — once on the
      // pooled path, once on the spatial one — so each holds a count of 2 and a single
      // `dispose()` merely decrements it, freeing nothing. The backbone's sub-models are
      // built by `tf.model({inputs, outputs})`, which reuses existing nodes without
      // applying anything, so their count stays at 1 and a second dispose throws
      // "already disposed" instead.
      //
      // Getting this backwards leaks the head's weights on every training run, which a
      // classroom session hits a dozen times over.
      spatial.dispose()
      pooled.dispose()
    },
  }
}

/**
 * Compiles the pooled path for training. Adam at 1e-3 with categorical cross-entropy (R2).
 * Only the pooled model is compiled: the spatial path is read-only, used for gradients.
 */
export function compileHead(head: ClassifierHead): void {
  head.pooled.compile({
    optimizer: tf.train.adam(1e-3),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  })
}
