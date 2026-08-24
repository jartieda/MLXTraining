import { describe, it, expect, beforeAll } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { evaluate, imbalanceRatio, IMBALANCE_THRESHOLD } from '@/ml/metrics'
import { trainClassifier } from '@/ml/train'
import { initBackend } from '@/ml/backend'
import type { TrainedModel } from '@/ml/train'

/**
 * T024 / FR-020, FR-021, FR-009 — evaluation metrics.
 *
 * The assertion that matters most is the last group: **`imbalanced` is report-only and
 * never gates training**. FR-021 asks for a warning and FR-009 forbids a refusal, and the
 * fairness module (FR-036) depends on that combination — a learner has to be able to train
 * a deliberately skewed model and watch what it does to the minority class. A well-meaning
 * guard added here would silently remove a lesson from the curriculum.
 *
 * Confusion-matrix orientation is the other easy silent error: rows are the **true** class.
 * Transposing it produces a matrix that still looks like a confusion matrix and reverses
 * every conclusion a learner draws from it.
 */

/** A stub model, so matrix mechanics are tested without a training run in the loop. */
function stubModel(classCount: number, predictor: (embedding: Float32Array) => number): TrainedModel {
  return {
    classCount,
    embeddingSize: 1,
    usedValidationSplit: false,
    head: null as never,
    predictFromEmbedding: (embedding) => {
      const predicted = predictor(embedding)
      return Array.from({ length: classCount }, (_, classIndex) => ({
        classIndex,
        probability: classIndex === predicted ? 1 : 0,
      }))
    },
    predict: () => Promise.reject(new Error('not used')),
    save: () => Promise.reject(new Error('not used')),
    dispose: () => undefined,
  }
}

beforeAll(async () => {
  await initBackend('cpu')
})

describe('evaluate — confusion matrix', () => {
  it('is square with side classCount', () => {
    const embeddings = new Float32Array([0, 1, 2])
    const labels = new Uint8Array([0, 1, 2])
    const result = evaluate(stubModel(3, (e) => e[0] ?? 0), embeddings, labels, 3, 1)

    expect(result.confusion).toHaveLength(3)
    for (const row of result.confusion) expect(row).toHaveLength(3)
  })

  it('indexes rows by the TRUE class, not the predicted one', () => {
    // Two samples of true class 0, both predicted as class 1. The count must land at
    // [0][1], never [1][0]. A transposed matrix reverses every reading of it.
    const embeddings = new Float32Array([0, 0])
    const labels = new Uint8Array([0, 0])
    const result = evaluate(stubModel(2, () => 1), embeddings, labels, 2, 1)

    expect(result.confusion[0]).toEqual([0, 2])
    expect(result.confusion[1]).toEqual([0, 0])
  })

  it("rows sum to that class's sample count", () => {
    const embeddings = new Float32Array([0, 0, 0, 1, 1])
    const labels = new Uint8Array([0, 0, 0, 1, 1])
    const result = evaluate(stubModel(2, (e) => (e[0] === 0 ? 0 : 1)), embeddings, labels, 2, 1)

    expect(result.confusion[0]?.reduce((a, b) => a + b, 0)).toBe(3)
    expect(result.confusion[1]?.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('holds integers, never fractions', () => {
    const embeddings = new Float32Array([0, 1])
    const labels = new Uint8Array([0, 1])
    const result = evaluate(stubModel(2, (e) => e[0] ?? 0), embeddings, labels, 2, 1)
    for (const row of result.confusion) {
      for (const cell of row) expect(Number.isInteger(cell)).toBe(true)
    }
  })
})

describe('evaluate — per-class figures', () => {
  it("reports each class's sample count and its own accuracy", () => {
    // Class 0: 4 samples, 3 correct. Class 1: 2 samples, both correct.
    const embeddings = new Float32Array([0, 0, 0, 9, 1, 1])
    const labels = new Uint8Array([0, 0, 0, 0, 1, 1])
    const result = evaluate(
      stubModel(2, (e) => (e[0] === 0 ? 0 : 1)),
      embeddings,
      labels,
      2,
      1,
    )

    expect(result.perClass[0]).toEqual({ classIndex: 0, sampleCount: 4, accuracy: 0.75 })
    expect(result.perClass[1]).toEqual({ classIndex: 1, sampleCount: 2, accuracy: 1 })
  })

  it('reports overall accuracy over all samples, not the mean of per-class accuracies', () => {
    // The two differ whenever classes are unbalanced, and conflating them is how a
    // skewed model gets reported as better than it is — exactly the case FR-021 is about.
    const embeddings = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 9])
    const labels = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    const result = evaluate(stubModel(2, () => 0), embeddings, labels, 2, 1)

    expect(result.overallAccuracy).toBeCloseTo(0.9, 10)
    const meanOfPerClass =
      result.perClass.reduce((a, c) => a + c.accuracy, 0) / result.perClass.length
    expect(meanOfPerClass).toBeCloseTo(0.5, 10)
  })

  it('reports a class with zero samples as zero accuracy rather than NaN', () => {
    // A NaN reaches the interface as "NaN%" and destroys a learner's confidence in every
    // other figure on the screen.
    const embeddings = new Float32Array([0, 0])
    const labels = new Uint8Array([0, 0])
    const result = evaluate(stubModel(3, () => 0), embeddings, labels, 3, 1)

    expect(result.perClass[2]).toEqual({ classIndex: 2, sampleCount: 0, accuracy: 0 })
  })

  it('returns one entry per class, ordered by classIndex', () => {
    const embeddings = new Float32Array([0, 1, 2, 3])
    const labels = new Uint8Array([3, 2, 1, 0])
    const result = evaluate(stubModel(4, () => 0), embeddings, labels, 4, 1)
    expect(result.perClass.map((c) => c.classIndex)).toEqual([0, 1, 2, 3])
  })
})

describe('imbalanceRatio', () => {
  it('is largest ÷ smallest', () => {
    expect(imbalanceRatio([40, 5])).toBe(8)
    expect(imbalanceRatio([10, 10, 10])).toBe(1)
    expect(imbalanceRatio([9, 3, 6])).toBe(3)
  })

  it('reports Infinity when a class is empty, rather than dividing by zero', () => {
    expect(imbalanceRatio([10, 0])).toBe(Infinity)
  })

  it('reports 1 for no classes at all, so callers need no special case', () => {
    expect(imbalanceRatio([])).toBe(1)
  })

  it('flags imbalance at the documented threshold of 2', () => {
    expect(IMBALANCE_THRESHOLD).toBe(2)
  })
})

describe('imbalance is report-only and never gates training (FR-009, FR-021)', () => {
  it('flags a 40-vs-5 split as imbalanced', () => {
    const counts = [40, 5]
    const total = counts.reduce((a, b) => a + b, 0)
    const embeddings = new Float32Array(total)
    const labels = new Uint8Array(total)
    let row = 0
    counts.forEach((count, classIndex) => {
      for (let i = 0; i < count; i++) {
        embeddings[row] = classIndex
        labels[row] = classIndex
        row++
      }
    })

    const result = evaluate(stubModel(2, (e) => e[0] ?? 0), embeddings, labels, 2, 1)
    expect(result.imbalanceRatio).toBe(8)
    expect(result.imbalanced).toBe(true)
  })

  it('does not flag a 1.5:1 split, so the notice means something when it appears', () => {
    const embeddings = new Float32Array([0, 0, 0, 1, 1])
    const labels = new Uint8Array([0, 0, 0, 1, 1])
    const result = evaluate(stubModel(2, (e) => e[0] ?? 0), embeddings, labels, 2, 1)
    expect(result.imbalanced).toBe(false)
  })

  it('TRAINING STILL SUCCEEDS on the same imbalanced input (FR-009)', async () => {
    // The pairing is the point: `imbalanced: true` and a trained model, from one dataset.
    // The fairness module (FR-036) is built on being able to do exactly this.
    const counts = [40, 5]
    const size = 4
    const total = counts.reduce((a, b) => a + b, 0)
    const embeddings = new Float32Array(total * size)
    const labels = new Uint8Array(total)
    let row = 0
    counts.forEach((count, classIndex) => {
      for (let i = 0; i < count; i++) {
        embeddings[row * size + classIndex] = 1
        labels[row] = classIndex
        row++
      }
    })

    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: size,
      epochs: 5,
      seed: 21,
    })

    try {
      const result = evaluate(model, embeddings, labels, 2, size)
      expect(result.imbalanced).toBe(true)
      // A real evaluation of a real model: the figures exist, and nothing refused.
      expect(result.perClass[0]?.sampleCount).toBe(40)
      expect(result.perClass[1]?.sampleCount).toBe(5)
      expect(result.overallAccuracy).toBeGreaterThanOrEqual(0)
    } finally {
      model.dispose()
    }
  }, 60_000)
})

describe('evaluate — memory', () => {
  it('leaks no tensors (R8)', async () => {
    const size = 4
    const embeddings = new Float32Array(8 * size)
    const labels = new Uint8Array(8)
    for (let i = 0; i < 8; i++) {
      embeddings[i * size + (i % 2)] = 1
      labels[i] = i % 2
    }

    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: size,
      epochs: 2,
      seed: 23,
    })
    try {
      const before = tf.memory().numTensors
      evaluate(model, embeddings, labels, 2, size)
      expect(tf.memory().numTensors).toBe(before)
    } finally {
      model.dispose()
    }
  }, 60_000)
})
