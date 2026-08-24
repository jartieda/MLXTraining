import * as tf from '@tensorflow/tfjs'
import { buildHead, compileHead, type ClassifierHead } from './head'
import type { LoadedBackbone } from './backbone'
import {
  MlError,
  abortError,
  assertNotAborted,
  type ClassProbability,
  type ImageSource,
} from './types'

/**
 * T022 / R2 / FR-006, FR-007, FR-009 — training the head on cached embeddings.
 *
 * The expensive work — the backbone forward pass — already happened at capture time
 * (D4, R2), so this fits a ~50k-parameter head over a few hundred cached vectors. That is
 * what makes SC-002's 30 s budget comfortable rather than tight, and it is why nothing in
 * this file touches an image.
 *
 * FR-009 is the requirement most likely to be "improved" into a bug: imbalanced input
 * trains, always. Refusing a 40-vs-5 split would look like care and would break the
 * fairness module (FR-036), whose entire lesson is that a learner trains a skewed model
 * deliberately and sees the consequence. Imbalance is *reported* by metrics.ts.
 */

export interface TrainRequest {
  /** Concatenated pooled embeddings, `embeddingSize` floats per sample. */
  readonly embeddings: Float32Array
  readonly labels: Uint8Array
  readonly classCount: number
  readonly embeddingSize: number
  readonly epochs?: number
  readonly batchSize?: number
  /** Dropped automatically if any class has fewer than 5 samples (R2). */
  readonly validationSplit?: number
  readonly seed?: number
  readonly onEpochEnd?: (epoch: number, loss: number, accuracy: number) => void
  readonly signal?: AbortSignal
}

export interface TrainedModel {
  readonly classCount: number
  readonly embeddingSize: number
  /** Whether a validation split was actually used, after the R2 minimum-count rule. */
  readonly usedValidationSplit: boolean
  predict(image: ImageSource, backbone: LoadedBackbone): Promise<ClassProbability[]>
  predictFromEmbedding(embedding: Float32Array): ClassProbability[]
  /** The head. Needed by `explain/gradcam.ts`; not for feature code. */
  readonly head: ClassifierHead
  save(key: string): Promise<void>
  dispose(): void
}

export const DEFAULT_EPOCHS = 20
export const DEFAULT_BATCH_SIZE = 16
export const DEFAULT_VALIDATION_SPLIT = 0.2
/** Below this per-class count a validation split can starve a class entirely (R2). */
export const MIN_SAMPLES_FOR_VALIDATION = 5

/** Where a saved head lives. Local only — a model never leaves the device (FR-048). */
export function modelStorageUrl(key: string): string {
  return `indexeddb://${key}`
}

/**
 * A small deterministic PRNG (mulberry32). Used to shuffle the training set when a seed is
 * supplied, with `shuffle: false` passed to `fit` — tfjs's own shuffle calls `Math.random`
 * and cannot be seeded, so leaving it on would make the whole suite non-reproducible and
 * contract obligation 2 untestable.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function validate(req: TrainRequest): number[] {
  const { embeddings, labels, classCount, embeddingSize } = req

  if (classCount < 2) {
    throw new MlError(
      'TOO_FEW_CLASSES',
      `A classifier needs at least two classes to tell apart; got ${String(classCount)}. Add another class and capture a few examples for it.`,
      { classCount },
    )
  }

  if (labels.length === 0) {
    throw new MlError(
      'NO_SAMPLES',
      'There are no samples to train on. Capture a few examples for each class first.',
    )
  }

  if (embeddings.length !== labels.length * embeddingSize) {
    throw new MlError(
      'EMBEDDING_SIZE_MISMATCH',
      `Got ${String(labels.length)} labels but ${String(embeddings.length)} embedding values, which is not ${String(labels.length)} × ${String(embeddingSize)}. The cached embeddings and the sample list have drifted apart.`,
      { labels: labels.length, values: embeddings.length, embeddingSize },
    )
  }

  const counts = new Array<number>(classCount).fill(0)
  for (const label of labels) {
    if (label >= classCount) {
      throw new MlError(
        'LABEL_OUT_OF_RANGE',
        `A sample is labelled with class ${String(label)}, but this project only has ${String(classCount)} classes.`,
        { label, classCount },
      )
    }
    counts[label] = (counts[label] ?? 0) + 1
  }

  const emptyIndex = counts.findIndex((count) => count === 0)
  if (emptyIndex !== -1) {
    // Scenario 1.3 requires the interface to *name* the empty class, so the index travels
    // with the error; a bare "not enough data" is useless to a learner facing four classes.
    throw new MlError(
      'EMPTY_CLASS',
      `Class ${String(emptyIndex)} has no examples. Capture at least one for it, or delete the class.`,
      { classIndex: emptyIndex },
    )
  }

  return counts
}

export async function trainClassifier(req: TrainRequest): Promise<TrainedModel> {
  const {
    embeddings,
    labels,
    classCount,
    embeddingSize,
    epochs = DEFAULT_EPOCHS,
    batchSize = DEFAULT_BATCH_SIZE,
    validationSplit = DEFAULT_VALIDATION_SPLIT,
    seed,
    onEpochEnd,
    signal,
  } = req

  assertNotAborted(signal)
  const counts = validate(req)

  const smallest = Math.min(...counts)
  const usedValidationSplit = validationSplit > 0 && smallest >= MIN_SAMPLES_FOR_VALIDATION
  const effectiveSplit = usedValidationSplit ? validationSplit : 0

  const sampleCount = labels.length
  // Deterministic shuffle when seeded; identity order otherwise, since `fit` will shuffle.
  const order = Array.from({ length: sampleCount }, (_, i) => i)
  if (seed !== undefined) {
    const random = mulberry32(seed)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const a = order[i]
      const b = order[j]
      if (a !== undefined && b !== undefined) {
        order[i] = b
        order[j] = a
      }
    }
  }

  const head = buildHead({
    embeddingSize,
    classCount,
    ...(seed === undefined ? {} : { seed }),
  })
  compileHead(head)

  // `fit` is async and a tidy scope cannot span an await, so the two inputs outlive the
  // scope and are disposed in the `finally` below — that is what keeps an abort leak-free.
  // The scope is still needed for the *intermediate*: `tf.oneHot` takes a `tensor1d` that
  // nothing else would release, which is a one-tensor leak per training run and therefore
  // one per press of Train.
  const [xs, ys] = tf.tidy<[tf.Tensor2D, tf.Tensor2D]>(() => [
    tf.tensor2d(reorder(embeddings, order, embeddingSize), [sampleCount, embeddingSize], 'float32'),
    tf.oneHot(
      tf.tensor1d(
        order.map((i) => labels[i] ?? 0),
        'int32',
      ),
      classCount,
    ) as tf.Tensor2D,
  ])

  let aborted = false
  const onAbort = () => {
    aborted = true
    // `stopTraining` is the only cooperative exit tfjs offers; it takes effect at the end
    // of the current epoch, which satisfies "honours the signal within one epoch"
    // (contract obligation 4).
    head.pooled.stopTraining = true
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await head.pooled.fit(xs, ys, {
      epochs,
      batchSize,
      validationSplit: effectiveSplit,
      // See mulberry32 above: seeded runs shuffle once, deterministically, up front.
      shuffle: seed === undefined,
      verbose: 0,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          onEpochEnd?.(epoch, logs?.loss ?? Number.NaN, logs?.acc ?? logs?.accuracy ?? Number.NaN)
          if (aborted) head.pooled.stopTraining = true
        },
      },
    })

    if (aborted) throw abortError()

    return makeTrainedModel(head, usedValidationSplit)
  } catch (error) {
    // The head is disposed on every failure path, including abort, which is what makes
    // "aborting leaves no tensors allocated" true. Nothing is ever persisted here —
    // saving is the caller's explicit `save(key)` — so an abort also cannot leave a
    // partial model behind.
    head.dispose()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    xs.dispose()
    ys.dispose()
  }
}

/** Applies a permutation to the flat embedding array. */
function reorder(embeddings: Float32Array, order: readonly number[], stride: number): Float32Array {
  const out = new Float32Array(embeddings.length)
  order.forEach((source, target) => {
    out.set(embeddings.subarray(source * stride, source * stride + stride), target * stride)
  })
  return out
}

function makeTrainedModel(head: ClassifierHead, usedValidationSplit: boolean): TrainedModel {
  let disposed = false

  const model: TrainedModel = {
    classCount: head.classCount,
    embeddingSize: head.embeddingSize,
    usedValidationSplit,
    head,

    predictFromEmbedding: (embedding) => {
      if (disposed) throw new MlError('MODEL_NOT_FOUND', 'This model has been disposed.')
      if (embedding.length !== head.embeddingSize) {
        throw new MlError(
          'EMBEDDING_SIZE_MISMATCH',
          `Expected a ${String(head.embeddingSize)}-value embedding but got ${String(embedding.length)}. The sample was probably embedded by a different backbone width.`,
          { expected: head.embeddingSize, received: embedding.length },
        )
      }

      const probabilities = tf.tidy(() => {
        const input = tf.tensor2d(embedding, [1, head.embeddingSize], 'float32')
        // `training: false` so dropout is inactive; leaving it on would make a prediction
        // change every time a learner looked at it.
        const output = head.pooled.predict(input, { batchSize: 1 }) as tf.Tensor2D
        return output.dataSync<'float32'>()
      })

      return Array.from(probabilities, (probability, classIndex) => ({ classIndex, probability }))
    },

    predict: async (image, backbone) => {
      const embedding = await backbone.embed(image)
      return model.predictFromEmbedding(embedding)
    },

    save: async (key) => {
      if (disposed) throw new MlError('MODEL_NOT_FOUND', 'This model has been disposed.')
      await head.pooled.save(modelStorageUrl(key))
    },

    dispose: () => {
      if (disposed) return
      disposed = true
      head.dispose()
    },
  }

  return model
}

/**
 * Reloads a head saved by `save(key)`. `classCount` is supplied by the caller because the
 * mapping from output index to class lives in the local `models.classOrder` record
 * (data-model.md) — the saved artifact alone cannot say which class index 0 was.
 */
export async function loadModel(key: string, classCount: number): Promise<TrainedModel> {
  let pooled: tf.LayersModel
  try {
    pooled = await tf.loadLayersModel(modelStorageUrl(key))
  } catch {
    throw new MlError(
      'MODEL_NOT_FOUND',
      `No saved model found for "${key}". It may have been cleared by the browser — train again.`,
      { key },
    )
  }

  const embeddingSize = pooled.inputs[0]?.shape.at(-1) ?? 0
  if (embeddingSize <= 0) {
    pooled.dispose()
    throw new MlError('MODEL_NOT_FOUND', `The saved model for "${key}" has an unreadable input shape.`)
  }

  // A fresh head is built and the saved weights are copied in, rather than wrapping the
  // loaded model directly. The Grad-CAM path needs the *spatial* twin sharing these
  // weights (see head.ts), and a plain `loadLayersModel` gives only the pooled path.
  const head = buildHead({ embeddingSize, classCount })
  try {
    head.pooled.setWeights(pooled.getWeights())
  } finally {
    pooled.dispose()
  }

  compileHead(head)
  return makeTrainedModel(head, false)
}
