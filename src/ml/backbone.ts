import * as tf from '@tensorflow/tfjs'
import {
  MODEL_INPUT_SIZE,
  MlError,
  type Alpha,
  type ImageSource,
  type SpatialActivation,
  type TargetLayer,
} from './types'

/**
 * T019 / R1, R2 / FR-006 — the frozen MobileNet v1 backbone.
 *
 * Three decisions in here are load-bearing:
 *
 * 1. **A Layers model, not a graph model.** Grad-CAM needs a named intermediate
 *    activation tensor, and only a Layers model can be sliced with
 *    `tf.model({inputs, outputs})`. The published MobileNet v2 and v3 TensorFlow.js
 *    artifacts are graph models, so a future contributor reaching for "a better backbone"
 *    would silently foreclose the product's central feature. That is checked and refused
 *    with a named error rather than left to fail somewhere inside tfjs.
 *
 * 2. **Truncated and frozen.** Only a small head is trained (R2), so the activations
 *    Grad-CAM explains do not drift between runs — a learner comparing two training runs
 *    sees the effect of her data, not of a moving feature extractor.
 *
 * 3. **`ImageSource` in, `Float32Array` out.** No DOM type crosses this boundary, which is
 *    what lets the whole module be tested in a node environment (Principle VI).
 */

export interface LoadedBackbone {
  readonly alpha: Alpha
  /** Pooled embedding for training. 512 floats at alpha 0.5, 256 at 0.25. */
  embed(image: ImageSource): Promise<Float32Array>
  /** Batched variant. Result length is `images.length * embeddingSize`. */
  embedBatch(images: readonly ImageSource[]): Promise<Float32Array>
  /** Spatial activation for Grad-CAM. Deliberately not persisted (data-model.md). */
  activation(image: ImageSource, layer: TargetLayer): Promise<SpatialActivation>
  readonly embeddingSize: number
  /**
   * The truncated Layers model. An implementation detail shared with `explain/gradcam.ts`,
   * which needs the activation tensor itself rather than a copied `Float32Array`.
   */
  readonly truncated: tf.LayersModel
  /**
   * A model from `layer`'s activation forward to the truncation point, or `null`
   * when `layer` IS the truncation point.
   *
   * Grad-CAM against the finer 14×14 layer needs this. `conv_pw_11_relu` has 256
   * channels while the trained head takes 512, so a gradient with respect to that
   * activation has to travel through the remaining backbone blocks before it
   * reaches the head — there is no way to feed the head directly from there
   * (R3's "finer detail" option is the reason this exists at all).
   */
  tailFrom(layer: TargetLayer): tf.LayersModel | null
  dispose(): void
}

/** The layer the backbone is truncated at for training and for the default heat map. */
const TRUNCATE_AT: TargetLayer = 'conv_pw_13_relu'

/**
 * Turns an `ImageSource` of any size into a normalised `[1, 224, 224, 3]` batch.
 *
 * MobileNet v1 was trained on inputs scaled to [-1, 1], not [0, 1]. Getting this wrong
 * produces embeddings that still train a usable-looking classifier on easy fixtures while
 * being materially worse on real photographs — a silent degradation, so the scaling lives
 * in one place with a note rather than being repeated at each call site.
 */
function toBatch(images: readonly ImageSource[]): tf.Tensor4D {
  return tf.tidy(() => {
    const frames = images.map((image) => {
      if (image.data.length !== image.width * image.height * 4) {
        throw new MlError(
          'IMAGE_SIZE_MISMATCH',
          `Image data is ${String(image.data.length)} bytes but ${String(image.width)}×${String(image.height)} RGBA needs ${String(image.width * image.height * 4)}.`,
          { width: image.width, height: image.height },
        )
      }

      const rgba = tf.tensor3d(new Uint8Array(image.data), [image.height, image.width, 4], 'int32')
      const rgb = rgba.slice([0, 0, 0], [image.height, image.width, 3])
      const resized =
        image.width === MODEL_INPUT_SIZE && image.height === MODEL_INPUT_SIZE
          ? rgb.toFloat()
          : tf.image.resizeBilinear(rgb.toFloat(), [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE], true)
      return resized.div<tf.Tensor3D>(127.5).sub<tf.Tensor3D>(1)
    })
    return tf.stack(frames) as tf.Tensor4D
  })
}

/** Shared by `embed` and `activation`: the spatial map from a truncated sub-model. */
function truncateTo(full: tf.LayersModel, layer: TargetLayer): tf.LayersModel {
  let output: tf.SymbolicTensor
  try {
    output = full.getLayer(layer).output as tf.SymbolicTensor
  } catch {
    throw new MlError(
      'BACKBONE_LAYER_MISSING',
      `The backbone has no layer named "${layer}". It is probably not MobileNet v1 — check the URL passed to loadBackbone.`,
      { layer },
    )
  }
  return tf.model({ inputs: full.inputs, outputs: output })
}

/**
 * Builds a model from one named layer's activation forward to another's, by
 * re-applying the layers in between to a fresh input.
 *
 * `tf.model({inputs, outputs})` cannot express this: its `inputs` must be an
 * actual `InputLayer` of the source model, not an arbitrary intermediate tensor.
 * Re-application is the standard Keras answer.
 *
 * It is safe here for one specific reason: **MobileNet v1 is strictly sequential**
 * between these layers — no residual connections, no branches — so applying each
 * layer to the previous output reproduces the original graph exactly. The same
 * trick against MobileNet v2 or a ResNet would silently drop the skip connections
 * and produce confident nonsense, which is worth knowing before anyone reuses it.
 */
function buildTail(full: tf.LayersModel, from: TargetLayer, to: TargetLayer): tf.LayersModel {
  const layers = full.layers
  const fromIndex = layers.findIndex((layer) => layer.name === from)
  const toIndex = layers.findIndex((layer) => layer.name === to)

  if (fromIndex < 0 || toIndex < 0 || toIndex <= fromIndex) {
    throw new MlError(
      'BACKBONE_LAYER_MISSING',
      `Cannot build a path from "${from}" to "${to}" in this backbone.`,
      { from, to },
    )
  }

  const shape = (layers[fromIndex]?.outputShape as number[]).slice(1)
  const input = tf.input({ shape })

  let current: tf.SymbolicTensor = input
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    const layer = layers[i]
    if (!layer) break
    current = layer.apply(current) as tf.SymbolicTensor
  }

  return tf.model({ inputs: input, outputs: current })
}

/**
 * Loads the backbone from `url` and truncates it at `conv_pw_13_relu`.
 *
 * The artifacts are fetched through tfjs's IO layer and inspected *before* being handed to
 * `loadLayersModel`, which is what makes the graph-model refusal a clear error rather than
 * an internal one about an undefined layer configuration.
 */
export async function loadBackbone(url: string, alpha: Alpha): Promise<LoadedBackbone> {
  // The artifacts are fetched through the IO layer and inspected before being
  // handed to `loadLayersModel`, which is what turns a graph model into a clear
  // refusal instead of an internal error about an undefined layer config.
  //
  // The HTTP fallback matters and is not defensive padding: `getLoadHandlers`
  // matches `http://`, `https://`, `indexeddb://` and registered schemes, but NOT
  // a root-relative path — and `/models/mobilenet_v1_0.50_224/model.json` is
  // exactly what a statically-hosted build asks for. `tf.loadLayersModel` applies
  // this same fallback internally; calling `getLoadHandlers` directly meant
  // reimplementing its resolution and getting it wrong, which left the lab with a
  // disabled capture button in the browser while every node test passed against a
  // `file://` router.
  const handler = tf.io.getLoadHandlers(url)[0] ?? tf.io.browserHTTPRequest(url)
  if (!handler.load) {
    throw new MlError(
      'MODEL_NOT_FOUND',
      `Nothing can load "${url}". Expected an http(s) URL, a path, an indexeddb:// key, or a registered scheme.`,
      { url },
    )
  }

  const artifacts = await handler.load()

  // A Keras Layers model carries either a `model_config` (a full save file) or a `config`
  // with a `layers` array (a bare topology). A graph model carries neither, and declares
  // `format: 'graph-model'`. Both checks are applied: `format` is absent from some older
  // published artifacts, so structure is the reliable signal and `format` the clear one.
  const topology = artifacts.modelTopology as
    | { model_config?: unknown; config?: { layers?: unknown }; node?: unknown }
    | undefined
  const looksLikeGraph =
    artifacts.format === 'graph-model' ||
    (topology !== undefined &&
      topology.model_config === undefined &&
      !Array.isArray(topology.config?.layers))

  if (looksLikeGraph) {
    throw new MlError(
      'GRAPH_MODEL_UNSUPPORTED',
      `"${url}" is a TensorFlow.js graph model. This lab needs a Layers model, because a heat map requires a named intermediate activation and tf.model({inputs, outputs}) cannot slice a graph model. Use the mobilenet_v1_*_224 Layers artifacts (R1).`,
      { url },
    )
  }

  const full = await tf.loadLayersModel(tf.io.fromMemory(artifacts))

  let truncated: tf.LayersModel
  try {
    truncated = truncateTo(full, TRUNCATE_AT)
  } catch (error) {
    full.dispose()
    throw error
  }

  // `trainable = false` on both: the head is the only thing that learns (R2). Setting it
  // after truncation covers the shared layer objects either model exposes.
  full.trainable = false
  truncated.trainable = false

  // Pooling the truncated output once, here, rather than per call: the embedding is
  // `GlobalAveragePooling2D` over the spatial map, and it is the only thing training uses.
  const embeddingSize = (truncated.outputShape as number[]).at(-1) ?? 0
  if (embeddingSize <= 0) {
    full.dispose()
    truncated.dispose()
    throw new MlError(
      'BACKBONE_LAYER_MISSING',
      `Could not determine the embedding size from the truncated backbone's output shape.`,
    )
  }

  // Cached per target layer so a learner toggling "finer detail" does not rebuild the
  // sub-model on every frame. `conv_pw_13_relu` reuses `truncated` rather than a second copy.
  const subModels = new Map<TargetLayer, tf.LayersModel>([[TRUNCATE_AT, truncated]])
  const tails = new Map<TargetLayer, tf.LayersModel>()
  let disposed = false

  function assertLive(): void {
    if (disposed) {
      throw new MlError(
        'MODEL_NOT_FOUND',
        'This backbone has been disposed. Load it again before using it.',
      )
    }
  }

  function subModel(layer: TargetLayer): tf.LayersModel {
    const existing = subModels.get(layer)
    if (existing) return existing
    const created = truncateTo(full, layer)
    created.trainable = false
    subModels.set(layer, created)
    return created
  }

  const backbone: LoadedBackbone = {
    alpha,
    embeddingSize,
    truncated,

    embed: async (image) => {
      assertLive()
      const result = await backbone.embedBatch([image])
      return result
    },

    embedBatch: async (images) => {
      assertLive()
      if (images.length === 0) return new Float32Array(0)

      const pooled = tf.tidy(() => {
        const batch = toBatch(images)
        const spatial = truncated.predict(batch) as tf.Tensor4D
        // Global average pooling over the spatial dimensions — the 512-float vector that
        // is cached per sample at capture time (R2, D4) so training never runs the backbone.
        return spatial.mean<tf.Tensor2D>([1, 2])
      })

      try {
        return await pooled.data<'float32'>()
      } finally {
        pooled.dispose()
      }
    },

    activation: async (image, layer) => {
      assertLive()
      const model = subModel(layer)
      const spatial = tf.tidy(() => model.predict(toBatch([image])) as tf.Tensor4D)

      try {
        const [, height, width, channels] = spatial.shape
        const values = await spatial.data<'float32'>()
        return {
          values,
          width: width ?? 0,
          height: height ?? 0,
          channels: channels ?? 0,
          layer,
        }
      } finally {
        spatial.dispose()
      }
    },

    tailFrom: (layer) => {
      assertLive()
      if (layer === TRUNCATE_AT) return null

      const existing = tails.get(layer)
      if (existing) return existing

      const created = buildTail(full, layer, TRUNCATE_AT)
      created.trainable = false
      tails.set(layer, created)
      return created
    },

    dispose: () => {
      if (disposed) return
      disposed = true

      // Tail models MUST be disposed and sub-models must NOT be, and the asymmetry
      // is not arbitrary. `buildTail` re-applies each layer, which increments its
      // reference count, so the tail holds a count that has to be given back.
      // `truncateTo` uses `tf.model({inputs, outputs})`, which reuses existing
      // nodes without applying anything and so takes no count at all — disposing
      // one of those would free weights the others still need and the next dispose
      // would throw "already disposed".
      for (const tail of tails.values()) tail.dispose()
      tails.clear()
      // Only `full` is disposed, and that is not an oversight. A model built with
      // `tf.model({inputs, outputs})` reuses the *same layer objects*, and
      // `LayersModel.dispose()` disposes each of its layers — so disposing a sub-model
      // frees weights the others still reference, and the second dispose throws
      // "Layer 'conv1' is already disposed". Disposing the owner alone releases every
      // weight exactly once, because every sub-model's layers are a subset of its own.
      subModels.clear()
      full.dispose()
    },
  }

  return backbone
}

/**
 * Runs one throwaway pass so that the first learner-visible inference is not the one
 * paying WebGL shader-compilation cost — which on a low-end Chromebook is the difference
 * between a lab that feels responsive and one that appears to freeze on first use.
 */
export async function warmUp(backbone: LoadedBackbone): Promise<void> {
  const blank: ImageSource = {
    data: new Uint8ClampedArray(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 4).fill(128),
    width: MODEL_INPUT_SIZE,
    height: MODEL_INPUT_SIZE,
  }
  await backbone.embed(blank)
}
