import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { occlusionSensitivity, DEFAULT_CHUNK_SIZE } from '@/ml/explain/occlusion'
import { loadBackbone, type LoadedBackbone } from '@/ml/backbone'
import { trainClassifier, type TrainedModel } from '@/ml/train'
import { initBackend } from '@/ml/backend'
import type { ImageSource } from '@/ml/types'
import { loadFixture, FIXTURE_CLASSES } from '../helpers/fixtures.ts'
import {
  backboneUrl,
  backboneAvailable,
  registerFileLoadRouter,
  MISSING_BACKBONE_REASON,
} from '../helpers/localModel.ts'

/**
 * T060 / R4, R13 — **the highest-value test in the project.**
 *
 * The batched implementation is compared, numerically, against a naive reference
 * that predicts one variant at a time. That is the entire point of this file, and
 * the reasoning is worth stating plainly:
 *
 *   A batching error still produces a plausible-looking heat map.
 *
 * Mis-slice the embeddings by one, transpose row and column, or drop the last
 * partial chunk, and the result is still a smooth 12×12 map with a hot region
 * somewhere sensible. It renders beautifully. A learner would read it, believe it,
 * and draw a conclusion about her model from a picture of nothing. No amount of
 * manual testing catches that — only a comparison against a known-correct-but-slow
 * path does, which is precisely the class of bug Principle VI exists for.
 *
 * The second assertion is by **call count**: batching is a performance requirement
 * (SC-003), and an implementation that quietly reverted to one call per variant
 * would still pass the numeric comparison while missing the budget by 6×.
 */

registerFileLoadRouter()

const available = backboneAvailable(0.5)
const suite = available ? describe : describe.skip
if (!available) console.warn(`Skipping occlusion reference tests: ${MISSING_BACKBONE_REASON}`)

/** Kept small: this file runs the naive path, which is deliberately slow. */
const REFERENCE_GRID = 4

/**
 * The naive reference: one variant, one forward pass, in a plain loop.
 *
 * Deliberately written to mirror the prototype's structure rather than the
 * optimised implementation's, so the two do not share a mistake. It builds its own
 * occluded copies, computes its own drop, and normalises by its own maximum. If
 * this and `occlusionSensitivity` agree, the batching did not change the answer.
 */
async function naiveOcclusion(
  model: TrainedModel,
  backbone: LoadedBackbone,
  image: ImageSource,
  classIndex: number,
  gridSize: number,
): Promise<{ values: number[]; calls: number }> {
  let calls = 0
  const cellSize = Math.min(image.width, image.height) / gridSize
  const patch = Math.max(1, Math.round(cellSize))

  const baseline = await model.predict(image, backbone)
  calls++
  const baseProbability = baseline[classIndex]?.probability ?? 0

  const values: number[] = []

  for (let row = 0; row < gridSize; row++) {
    for (let column = 0; column < gridSize; column++) {
      const data = new Uint8ClampedArray(image.data)
      const startX = Math.round(column * cellSize)
      const startY = Math.round(row * cellSize)

      for (let y = startY; y < Math.min(image.height, startY + patch); y++) {
        for (let x = startX; x < Math.min(image.width, startX + patch); x++) {
          const offset = (y * image.width + x) * 4
          data[offset] = 128
          data[offset + 1] = 128
          data[offset + 2] = 128
        }
      }

      // One call per variant — the slow path this file exists to compare against.
      const probabilities = await model.predict(
        { data, width: image.width, height: image.height },
        backbone,
      )
      calls++
      values.push(Math.max(0, baseProbability - (probabilities[classIndex]?.probability ?? 0)))
    }
  }

  const maximum = Math.max(...values, 0)
  return {
    values: maximum > 0 ? values.map((value) => value / maximum) : values,
    calls,
  }
}

async function trainOnFixtures(backbone: LoadedBackbone): Promise<TrainedModel> {
  const images = []
  const labels: number[] = []
  for (const [classIndex, className] of FIXTURE_CLASSES.slice(0, 2).entries()) {
    for (let i = 0; i < 6; i++) {
      images.push(loadFixture(className, i))
      labels.push(classIndex)
    }
  }
  const embeddings = await backbone.embedBatch(images)
  return trainClassifier({
    embeddings,
    labels: new Uint8Array(labels),
    classCount: 2,
    embeddingSize: backbone.embeddingSize,
    epochs: 30,
    seed: 4321,
  })
}

suite('batched occlusion against a naive reference', () => {
  let backbone: LoadedBackbone
  let model: TrainedModel

  beforeAll(async () => {
    await initBackend('cpu')
    backbone = await loadBackbone(backboneUrl(0.5), 0.5)
    model = await trainOnFixtures(backbone)
  }, 300_000)

  afterAll(() => {
    model.dispose()
    backbone.dispose()
  })

  it('AGREES WITH THE NAIVE REFERENCE within tolerance', async () => {
    const image = loadFixture('stripes-h', 0)

    const reference = await naiveOcclusion(model, backbone, image, 0, REFERENCE_GRID)
    const batched = await occlusionSensitivity(model, backbone, {
      image,
      classIndex: 0,
      gridSize: REFERENCE_GRID,
      chunkSize: 5, // Deliberately not a divisor of 16, so the last chunk is partial.
    })

    expect(batched.values.length).toBe(reference.values.length)

    const deviations: string[] = []
    for (let i = 0; i < reference.values.length; i++) {
      const difference = Math.abs((batched.values[i] ?? 0) - (reference.values[i] ?? 0))
      // Batched and single-image paths differ only by floating-point accumulation
      // order, so the agreement should be tight. A slack tolerance here would let a
      // genuine off-by-one slip through.
      if (difference > 1e-4) {
        deviations.push(
          `cell ${String(i)}: batched ${String(batched.values[i])} vs reference ${String(reference.values[i])}`,
        )
      }
    }

    expect(
      deviations,
      'the batched implementation does not agree with the naive one — a batching error still renders a plausible heat map, which is why this test exists',
    ).toEqual([])
  }, 300_000)

  it('agrees for a class the model did NOT predict', async () => {
    // The drop for a losing class is small, so a scaling or normalisation error
    // shows up here more readily than on the winning class.
    const image = loadFixture('stripes-h', 0)
    const reference = await naiveOcclusion(model, backbone, image, 1, REFERENCE_GRID)
    const batched = await occlusionSensitivity(model, backbone, {
      image,
      classIndex: 1,
      gridSize: REFERENCE_GRID,
      chunkSize: 7,
    })

    for (let i = 0; i < reference.values.length; i++) {
      expect(batched.values[i] ?? 0).toBeCloseTo(reference.values[i] ?? 0, 4)
    }
  }, 300_000)

  it('gives the same answer whatever the chunk size', async () => {
    // Chunking is an implementation detail and must not be observable in the
    // result. If it is, the slicing is wrong.
    const image = loadFixture('circle', 0)
    const options = { image, classIndex: 0, gridSize: REFERENCE_GRID } as const

    const inOnePass = await occlusionSensitivity(model, backbone, { ...options, chunkSize: 64 })
    const inThrees = await occlusionSensitivity(model, backbone, { ...options, chunkSize: 3 })
    const oneAtATime = await occlusionSensitivity(model, backbone, { ...options, chunkSize: 1 })

    for (let i = 0; i < inOnePass.values.length; i++) {
      expect(inThrees.values[i] ?? 0).toBeCloseTo(inOnePass.values[i] ?? 0, 5)
      expect(oneAtATime.values[i] ?? 0).toBeCloseTo(inOnePass.values[i] ?? 0, 5)
    }
  }, 300_000)

  it('USES BATCHED CALLS: 144 variants take ~6 backbone passes, not 144', async () => {
    // The performance requirement, asserted structurally. A revert to one call per
    // variant would still produce a correct map and would miss SC-003 by 6×, so
    // correctness alone cannot defend it.
    const spy = vi.spyOn(backbone, 'embedBatch')

    await occlusionSensitivity(model, backbone, {
      image: loadFixture('circle', 0),
      classIndex: 0,
      gridSize: 12,
      chunkSize: DEFAULT_CHUNK_SIZE,
    })

    // 144 variants at 24 per chunk = 6 chunks, plus one unbatched baseline pass.
    const batchedCalls = spy.mock.calls.filter((call) => (call[0]?.length ?? 0) > 1)
    expect(batchedCalls.length).toBeLessThanOrEqual(7)
    expect(batchedCalls.length).toBeGreaterThanOrEqual(6)

    // And every batched call carried a real batch.
    for (const call of batchedCalls) {
      expect(call[0]?.length ?? 0).toBeGreaterThan(1)
      expect(call[0]?.length ?? 0).toBeLessThanOrEqual(DEFAULT_CHUNK_SIZE)
    }

    // The total variant count is exactly 144 — the R4 correction. A fractional
    // stride would silently make it 529.
    const totalVariants = batchedCalls.reduce((sum, call) => sum + (call[0]?.length ?? 0), 0)
    expect(totalVariants).toBe(144)

    spy.mockRestore()
  }, 600_000)

  it('leaks no tensors across a full 12×12 sweep (R8)', async () => {
    const before = tf.memory().numTensors
    await occlusionSensitivity(model, backbone, {
      image: loadFixture('circle', 1),
      classIndex: 0,
      gridSize: 12,
    })
    expect(tf.memory().numTensors).toBe(before)
  }, 600_000)
})
