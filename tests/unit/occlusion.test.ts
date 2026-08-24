import { describe, it, expect, vi } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { occlusionSensitivity, positionsPerAxis, DEFAULT_GRID_SIZE } from '@/ml/explain/occlusion'
import type { LoadedBackbone } from '@/ml/backbone'
import type { TrainedModel } from '@/ml/train'
import { isMlError, type ClassProbability, type ImageSource } from '@/ml/types'

/**
 * T061 / FR-014, R4 — occlusion mechanics.
 *
 * Deliberately built on stubs rather than a real backbone. The numeric truth is
 * `occlusion-reference.test.ts`'s job, and it pays ~55 s on the CPU backend for a
 * single 12×12 sweep to do it. Repeating that here to check that `onProgress`
 * fires would make the suite slow enough that someone eventually stops running
 * it — and these assertions (map size, clamping, progress, cancellation) are about
 * control flow, which a stub exercises exactly as well.
 *
 * The stub is a real one, though: it counts calls and returns embeddings that vary
 * with the input, so a map computed from it is still a function of the pixels.
 */

const SIZE = 24
const EMBEDDING_SIZE = 4

function testImage(): ImageSource {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    // A left-to-right gradient, so covering different columns changes the mean
    // measurably and the resulting map is not flat.
    data[i * 4] = (i % SIZE) * 10
    data[i * 4 + 1] = 40
    data[i * 4 + 2] = 200 - (i % SIZE) * 5
    data[i * 4 + 3] = 255
  }
  return { data, width: SIZE, height: SIZE }
}

interface Stubs {
  readonly backbone: LoadedBackbone
  readonly model: TrainedModel
  readonly calls: { embedBatch: number; batchSizes: number[] }
}

/**
 * A backbone whose embedding is the image's mean channel values, and a model whose
 * class-0 probability rises with the mean red channel.
 *
 * That means occluding a bright-red region genuinely lowers the class-0 score, so
 * the drops are real numbers derived from real pixels rather than a constant.
 */
function makeStubs(): Stubs {
  const calls = { embedBatch: 0, batchSizes: [] as number[] }

  const embedOne = (image: ImageSource): Float32Array => {
    let r = 0
    let g = 0
    let b = 0
    const pixels = image.width * image.height
    for (let i = 0; i < pixels; i++) {
      r += image.data[i * 4] ?? 0
      g += image.data[i * 4 + 1] ?? 0
      b += image.data[i * 4 + 2] ?? 0
    }
    return new Float32Array([r / pixels / 255, g / pixels / 255, b / pixels / 255, 1])
  }

  const backbone: LoadedBackbone = {
    alpha: 0.5,
    embeddingSize: EMBEDDING_SIZE,
    truncated: null as never,
    tailFrom: () => null,
    embed: (image) => Promise.resolve(embedOne(image)),
    embedBatch: (images) => {
      calls.embedBatch++
      calls.batchSizes.push(images.length)
      const out = new Float32Array(images.length * EMBEDDING_SIZE)
      images.forEach((image, index) => {
        out.set(embedOne(image), index * EMBEDDING_SIZE)
      })
      return Promise.resolve(out)
    },
    activation: () => Promise.reject(new Error('not used')),
    dispose: () => undefined,
  }

  const score = (embedding: Float32Array): ClassProbability[] => {
    const red = embedding[0] ?? 0
    const p0 = Math.min(1, Math.max(0, red))
    return [
      { classIndex: 0, probability: p0 },
      { classIndex: 1, probability: 1 - p0 },
    ]
  }

  const model: TrainedModel = {
    classCount: 2,
    embeddingSize: EMBEDDING_SIZE,
    usedValidationSplit: false,
    head: null as never,
    predictFromEmbedding: score,
    predict: async (image) => score(await backbone.embed(image)),
    save: () => Promise.reject(new Error('not used')),
    dispose: () => undefined,
  }

  return { backbone, model, calls }
}

describe('positionsPerAxis', () => {
  it('is exactly gridSize at the default full-cell stride (the R4 correction)', () => {
    expect(positionsPerAxis(12, 1, 1)).toBe(12)
    expect(positionsPerAxis(8, 1, 1)).toBe(8)
  })

  it('grows for a fractional stride, which is why overlap is not the default', () => {
    // A half-cell stride over 12 cells gives 23 positions per axis — 529 variants,
    // 3.7× the work, and a 23×23 map. R4 dropped overlap rather than raise the
    // SC-003 budget, and this is the arithmetic that forced the choice.
    expect(positionsPerAxis(12, 1, 0.5)).toBe(23)
    expect(positionsPerAxis(12, 1, 0.5) ** 2).toBe(529)
  })
})

describe('occlusionSensitivity — the map', () => {
  it('is gridSize × gridSize — NOT 7 or 14', async () => {
    // The mistake data-model.md warns about: a caller or cache that assumed a
    // Grad-CAM resolution would corrupt every occlusion map, and the result would
    // still look like a heat map.
    const { model, backbone } = makeStubs()
    const map = await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 6,
    })

    expect(map.width).toBe(6)
    expect(map.height).toBe(6)
    expect(map.values.length).toBe(36)
    expect(map.method).toBe('occlusion')
    expect(map.params.gridSize).toBe(6)
  })

  it('defaults to a 12×12 grid of exactly 144 variants', async () => {
    const { model, backbone, calls } = makeStubs()
    const map = await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
    })

    expect(DEFAULT_GRID_SIZE).toBe(12)
    expect(map.values.length).toBe(144)
    expect(calls.batchSizes.reduce((a, b) => a + b, 0)).toBe(144)
  })

  it('holds the CLAMPED probability drop, normalised by the largest', async () => {
    const { model, backbone } = makeStubs()
    const map = await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 4,
    })

    let max = -Infinity
    for (const value of map.values) {
      expect(value).toBeGreaterThanOrEqual(0)
      max = Math.max(max, value)
    }
    expect(max).toBeCloseTo(1, 6)
  })

  it('clamps a NEGATIVE drop to zero rather than letting it through', async () => {
    // Covering a region can make the model MORE confident. That is not evidence
    // for the class, and a negative value would break the normalisation and paint
    // as a cold cell anyway — so it is clamped, not merely tolerated.
    const { backbone } = makeStubs()
    const model: TrainedModel = {
      classCount: 2,
      embeddingSize: EMBEDDING_SIZE,
      usedValidationSplit: false,
      head: null as never,
      // Every occluded variant scores HIGHER than the baseline.
      predictFromEmbedding: () => [
        { classIndex: 0, probability: 0.9 },
        { classIndex: 1, probability: 0.1 },
      ],
      predict: () =>
        Promise.resolve([
          { classIndex: 0, probability: 0.2 },
          { classIndex: 1, probability: 0.8 },
        ]),
      save: () => Promise.reject(new Error('not used')),
      dispose: () => undefined,
    }

    const map = await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 4,
    })

    for (const value of map.values) expect(value).toBe(0)
    // Flagged, so the interface can say "no cell mattered" rather than showing a
    // blank overlay a learner would read as a claim about the model.
    expect(map.params.degenerate).toBe(1)
  })

  it('records the patch and stride it actually used', async () => {
    const { model, backbone } = makeStubs()
    const map = await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 4,
    })
    // Part of the D8 cache key: a map computed at one patch size must be a miss
    // for a request at another.
    expect(map.params.patchSize).toBe(SIZE / 4)
    expect(map.params.stride).toBe(SIZE / 4)
  })

  it('varies with the image, so it is not a constant', async () => {
    const { model, backbone } = makeStubs()
    const map = await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 4,
    })
    const distinct = new Set(Array.from(map.values, (v) => v.toFixed(4)))
    expect(distinct.size).toBeGreaterThan(1)
  })
})

describe('occlusionSensitivity — progress (FR-014)', () => {
  it('fires onProgress at least once per chunk', async () => {
    const { model, backbone } = makeStubs()
    const reports: { done: number; total: number }[] = []

    await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 6,
      chunkSize: 9,
      onProgress: (done, total) => {
        reports.push({ done, total })
      },
    })

    // 36 variants at 9 per chunk = 4 chunks.
    expect(reports).toHaveLength(4)
    expect(reports.map((r) => r.done)).toEqual([9, 18, 27, 36])
    for (const report of reports) expect(report.total).toBe(36)
  })

  it('reports monotonically and finishes at the total', async () => {
    // A progress bar that jumps backwards, or stops at 97%, reads as a hang — and
    // this is the only feedback a learner gets during a five-second wait.
    const { model, backbone } = makeStubs()
    const seen: number[] = []

    await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 5,
      chunkSize: 7,
      onProgress: (done) => {
        seen.push(done)
      },
    })

    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen.at(-1)).toBe(25)
  })
})

describe('occlusionSensitivity — cancellation (Scenario 3.3)', () => {
  it('rejects with ABORTED when the signal is already aborted', async () => {
    const { model, backbone } = makeStubs()
    const controller = new AbortController()
    controller.abort()

    await expect(
      occlusionSensitivity(model, backbone, {
        image: testImage(),
        classIndex: 0,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'ABORTED')
  })

  it('cancels part-way through and stops doing work', async () => {
    const { model, backbone, calls } = makeStubs()
    const controller = new AbortController()

    const promise = occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 12,
      chunkSize: 12,
      signal: controller.signal,
      onProgress: (done) => {
        if (done >= 24) controller.abort()
      },
    })

    await expect(promise).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'ABORTED')
    // Honoured within one chunk (contract obligation 4): it stopped near 24 of
    // 144, not after grinding through all twelve chunks.
    expect(calls.embedBatch).toBeLessThan(5)
  })

  it('leaks no tensors when aborted', async () => {
    const { model, backbone } = makeStubs()
    const controller = new AbortController()
    const before = tf.memory().numTensors

    const promise = occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 8,
      chunkSize: 8,
      signal: controller.signal,
      onProgress: () => {
        controller.abort()
      },
    })

    await expect(promise).rejects.toThrow()
    expect(tf.memory().numTensors).toBe(before)
  })
})

describe('occlusionSensitivity — refusals', () => {
  it('refuses a grid smaller than 2×2', async () => {
    const { model, backbone } = makeStubs()
    await expect(
      occlusionSensitivity(model, backbone, { image: testImage(), classIndex: 0, gridSize: 1 }),
    ).rejects.toThrow()
  })

  it('refuses a classIndex outside the model', async () => {
    const { model, backbone } = makeStubs()
    await expect(
      occlusionSensitivity(model, backbone, { image: testImage(), classIndex: 5 }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'CLASS_INDEX_OUT_OF_RANGE')
  })

  it("does not mutate the caller's image", async () => {
    // Every variant is a copy. Occluding in place would corrupt the frozen frame a
    // learner is looking at, and the second method would then explain a
    // grey-patched picture.
    const { model, backbone } = makeStubs()
    const image = testImage()
    const original = new Uint8ClampedArray(image.data)

    await occlusionSensitivity(model, backbone, { image, classIndex: 0, gridSize: 4 })

    expect(Array.from(image.data)).toEqual(Array.from(original))
  })

  it('reads only from embedBatch, never from embed, inside the sweep', async () => {
    // `embed` is a single-image call. Using it inside the loop would be the exact
    // regression T060 guards against, seen from the other side.
    const { model, backbone, calls } = makeStubs()
    const embedSpy = vi.spyOn(backbone, 'embed')

    await occlusionSensitivity(model, backbone, {
      image: testImage(),
      classIndex: 0,
      gridSize: 6,
      chunkSize: 12,
    })

    // Exactly one: the unoccluded baseline.
    expect(embedSpy).toHaveBeenCalledTimes(1)
    expect(calls.embedBatch).toBe(3)
    embedSpy.mockRestore()
  })
})
