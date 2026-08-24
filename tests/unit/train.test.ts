import { describe, it, expect, beforeAll } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { trainClassifier } from '@/ml/train'
import { isMlError } from '@/ml/types'
import { initBackend } from '@/ml/backend'

/**
 * T021 / FR-007, FR-009 / contracts/ml-core.md → train.ts
 *
 * Two of these assertions are load-bearing beyond the usual:
 *
 * - **"trains imbalanced input without refusing"** (FR-009). It is tempting to reject a
 *   40-vs-5 split as bad data, and it would even look like care. It would break the
 *   fairness module (FR-036), whose whole lesson is that a learner trains a deliberately
 *   skewed model and *sees* what it does. Imbalance is reported by metrics.ts and gated
 *   nowhere.
 *
 * - **determinism under a seed** (contract obligation 2). Without it none of the
 *   explanation tests can assert anything numeric, so the whole suite's value rests here.
 */

/** Synthetic embeddings: each class is a distinct direction plus a little noise. */
function makeEmbeddings(
  counts: readonly number[],
  embeddingSize = 8,
  noise = 0.01,
): { embeddings: Float32Array; labels: Uint8Array } {
  const total = counts.reduce((a, b) => a + b, 0)
  const embeddings = new Float32Array(total * embeddingSize)
  const labels = new Uint8Array(total)

  let row = 0
  counts.forEach((count, classIndex) => {
    for (let i = 0; i < count; i++) {
      for (let d = 0; d < embeddingSize; d++) {
        // Deterministic pseudo-noise: a hash of the indices, not Math.random, so a
        // failure is reproducible.
        const jitter = (((row * 31 + d * 17) % 97) / 97 - 0.5) * noise
        embeddings[row * embeddingSize + d] = (d % counts.length === classIndex ? 1 : 0) + jitter
      }
      labels[row] = classIndex
      row++
    }
  })

  return { embeddings, labels }
}

beforeAll(async () => {
  // Contract obligation 2: the suite pins `cpu` so results are bit-reproducible.
  await initBackend('cpu')
})

describe('trainClassifier — refusals', () => {
  it('refuses fewer than two classes, naming the problem (FR-001)', async () => {
    const { embeddings, labels } = makeEmbeddings([5])
    await expect(
      trainClassifier({ embeddings, labels, classCount: 1, embeddingSize: 8 }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'TOO_FEW_CLASSES')
  })

  it('refuses an empty class and reports which index is empty (Scenario 1.3)', async () => {
    // Class 1 has no samples. Scenario 1.3 requires the interface to *name* the empty
    // class, so the error has to carry the index — a bare "not enough data" is useless
    // to a learner staring at four classes.
    const { embeddings, labels } = makeEmbeddings([5, 0, 5])
    await expect(
      trainClassifier({ embeddings, labels, classCount: 3, embeddingSize: 8 }),
    ).rejects.toSatisfy(
      (e: unknown) => isMlError(e) && e.code === 'EMPTY_CLASS' && e.details.classIndex === 1,
    )
  })

  it('refuses no samples at all', async () => {
    await expect(
      trainClassifier({
        embeddings: new Float32Array(0),
        labels: new Uint8Array(0),
        classCount: 2,
        embeddingSize: 8,
      }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'NO_SAMPLES')
  })

  it('refuses a label outside [0, classCount)', async () => {
    const { embeddings } = makeEmbeddings([3, 3])
    const labels = new Uint8Array([0, 1, 0, 1, 0, 7])
    await expect(
      trainClassifier({ embeddings, labels, classCount: 2, embeddingSize: 8 }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'LABEL_OUT_OF_RANGE')
  })

  it('refuses when the embedding array length disagrees with the label count', async () => {
    const { labels } = makeEmbeddings([3, 3])
    await expect(
      trainClassifier({
        embeddings: new Float32Array(5 * 8),
        labels,
        classCount: 2,
        embeddingSize: 8,
      }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'EMBEDDING_SIZE_MISMATCH')
  })
})

describe('trainClassifier — training', () => {
  it('trains imbalanced input without refusing (FR-009)', async () => {
    // 40 vs 5 is the exact split the fairness module asks a learner to try (T082).
    // A refusal here would be a defect, not a safeguard.
    const { embeddings, labels } = makeEmbeddings([40, 5])
    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 5,
      seed: 1,
    })
    try {
      expect(model.classCount).toBe(2)
    } finally {
      model.dispose()
    }
  }, 60_000)

  it('returns probabilities that sum to 1 ± 1e-5, ordered by classIndex (Scenario 1.1)', async () => {
    const { embeddings, labels } = makeEmbeddings([6, 6, 6])
    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 3,
      embeddingSize: 8,
      epochs: 5,
      seed: 7,
    })
    try {
      const probs = model.predictFromEmbedding(embeddings.slice(0, 8))
      expect(probs).toHaveLength(3)
      expect(probs.map((p) => p.classIndex)).toEqual([0, 1, 2])
      const sum = probs.reduce((a, p) => a + p.probability, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-5)
      for (const p of probs) {
        expect(p.probability).toBeGreaterThanOrEqual(0)
        expect(p.probability).toBeLessThanOrEqual(1)
      }
    } finally {
      model.dispose()
    }
  }, 60_000)

  it('actually learns: a class-0 embedding scores highest for class 0', async () => {
    // Without this the suite would happily pass on a head that outputs a constant.
    const { embeddings, labels } = makeEmbeddings([12, 12], 8, 0.001)
    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 40,
      seed: 3,
    })
    try {
      const first = model.predictFromEmbedding(embeddings.slice(0, 8))
      const best = first.reduce((a, b) => (b.probability > a.probability ? b : a))
      expect(best.classIndex).toBe(0)
    } finally {
      model.dispose()
    }
  }, 120_000)

  it('is deterministic: the same seed and input give identical probabilities', async () => {
    const { embeddings, labels } = makeEmbeddings([8, 8])
    const request = {
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 6,
      seed: 42,
    } as const

    const a = await trainClassifier(request)
    const b = await trainClassifier(request)
    try {
      const pa = a.predictFromEmbedding(embeddings.slice(0, 8)).map((p) => p.probability)
      const pb = b.predictFromEmbedding(embeddings.slice(0, 8)).map((p) => p.probability)
      expect(pb).toEqual(pa)
    } finally {
      a.dispose()
      b.dispose()
    }
  }, 120_000)

  it('a different seed gives a different model, proving the seed is actually used', async () => {
    const { embeddings, labels } = makeEmbeddings([8, 8])
    const base = { embeddings, labels, classCount: 2, embeddingSize: 8, epochs: 3 } as const

    const a = await trainClassifier({ ...base, seed: 1 })
    const b = await trainClassifier({ ...base, seed: 2 })
    try {
      const pa = a.predictFromEmbedding(embeddings.slice(0, 8)).map((p) => p.probability)
      const pb = b.predictFromEmbedding(embeddings.slice(0, 8)).map((p) => p.probability)
      expect(pb).not.toEqual(pa)
    } finally {
      a.dispose()
      b.dispose()
    }
  }, 120_000)

  it('reports epoch progress', async () => {
    const { embeddings, labels } = makeEmbeddings([6, 6])
    const seen: number[] = []
    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 4,
      seed: 5,
      onEpochEnd: (epoch, loss, accuracy) => {
        seen.push(epoch)
        expect(Number.isFinite(loss)).toBe(true)
        expect(accuracy).toBeGreaterThanOrEqual(0)
      },
    })
    try {
      expect(seen).toEqual([0, 1, 2, 3])
    } finally {
      model.dispose()
    }
  }, 60_000)

  it('drops the validation split when a class has fewer than five samples (R2)', async () => {
    // A 20% split over a 3-sample class can leave that class entirely out of training,
    // which produces a model that has never seen it and an accuracy figure that lies.
    const { embeddings, labels } = makeEmbeddings([12, 3])
    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 3,
      validationSplit: 0.2,
      seed: 9,
    })
    try {
      expect(model.usedValidationSplit).toBe(false)
    } finally {
      model.dispose()
    }
  }, 60_000)

  it('keeps the validation split when every class has at least five samples', async () => {
    const { embeddings, labels } = makeEmbeddings([10, 10])
    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 3,
      validationSplit: 0.2,
      seed: 9,
    })
    try {
      expect(model.usedValidationSplit).toBe(true)
    } finally {
      model.dispose()
    }
  }, 60_000)
})

describe('trainClassifier — cancellation (FR-007)', () => {
  it('rejects with ABORTED when the signal is already aborted', async () => {
    const { embeddings, labels } = makeEmbeddings([6, 6])
    const controller = new AbortController()
    controller.abort()

    await expect(
      trainClassifier({
        embeddings,
        labels,
        classCount: 2,
        embeddingSize: 8,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'ABORTED')
  })

  it('aborts mid-run, leaving no tensors allocated', async () => {
    const { embeddings, labels } = makeEmbeddings([20, 20])
    const controller = new AbortController()
    const before = tf.memory().numTensors

    const promise = trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 200,
      seed: 11,
      signal: controller.signal,
      onEpochEnd: (epoch) => {
        if (epoch === 1) controller.abort()
      },
    })

    await expect(promise).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'ABORTED')
    expect(tf.memory().numTensors).toBe(before)
  }, 120_000)

  it('saves no model when aborted', async () => {
    // The obligation is that an abort leaves nothing persisted. `trainClassifier` never
    // saves at all — persistence is the caller's explicit `save(key)` — so this is a
    // regression guard: a well-meaning autosave added inside training would trip it.
    let saves = 0
    // A router returning null declines the URL and tfjs falls through to the next one,
    // but the router type is declared non-nullable, hence the named `decline` below.
    type SaveRouter = Parameters<typeof tf.io.registerSaveRouter>[0]
    const decline = null as unknown as tf.io.IOHandler
    const router: SaveRouter = (url) => {
      if (typeof url === 'string' && url.startsWith('countingtest://')) {
        saves++
        return {
          save: () =>
            Promise.resolve({
              modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' as const },
            }),
        }
      }
      return decline
    }
    tf.io.registerSaveRouter(router)

    const { embeddings, labels } = makeEmbeddings([10, 10])
    const controller = new AbortController()
    const promise = trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 100,
      seed: 13,
      signal: controller.signal,
      onEpochEnd: (epoch) => {
        if (epoch === 0) controller.abort()
      },
    })

    await expect(promise).rejects.toThrow()
    expect(saves).toBe(0)
  }, 120_000)
})

describe('trainClassifier — memory', () => {
  it('leaves no tensors behind once the model is disposed (R8)', async () => {
    const before = tf.memory().numTensors
    const { embeddings, labels } = makeEmbeddings([8, 8])
    const model = await trainClassifier({
      embeddings,
      labels,
      classCount: 2,
      embeddingSize: 8,
      epochs: 3,
      seed: 17,
    })
    model.predictFromEmbedding(embeddings.slice(0, 8))
    model.dispose()
    expect(tf.memory().numTensors).toBe(before)
  }, 60_000)
})
