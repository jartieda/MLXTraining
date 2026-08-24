import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tf from '@tensorflow/tfjs'
import { gradCam } from '@/ml/explain/gradcam'
import { loadBackbone, type LoadedBackbone } from '@/ml/backbone'
import { trainClassifier, type TrainedModel } from '@/ml/train'
import { initBackend } from '@/ml/backend'
import { isMlError } from '@/ml/types'
import { loadFixture, FIXTURE_CLASSES } from '../helpers/fixtures.ts'
import {
  backboneUrl,
  backboneAvailable,
  registerFileLoadRouter,
  MISSING_BACKBONE_REASON,
} from '../helpers/localModel.ts'

/**
 * T050 / FR-013, FR-016, R3 — Grad-CAM.
 *
 * **The class-sensitivity assertion is the reason this file exists.** A Grad-CAM
 * implementation that ignores `classIndex` — because the gather was dropped, or
 * the gradient was taken of the summed logits instead of one class's — produces a
 * heat map that looks entirely plausible. It is smooth, it highlights the
 * subject, and it is the same map for every class. Nothing in the interface would
 * show it, and the product's central claim (FR-016: explain ANY class) would be
 * quietly false. Only a numeric comparison between two classes' maps catches it.
 *
 * The stored reference map is the second guard: it catches a change that alters
 * the numbers without breaking class sensitivity, such as dropping the ReLU or
 * normalising by a global maximum instead of the map's own.
 *
 * Regenerate the reference deliberately, never casually:
 *   UPDATE_GRADCAM_REFERENCE=1 npx vitest run tests/unit/gradcam.test.ts
 */

registerFileLoadRouter()

const REFERENCE_DIR = join(fileURLToPath(import.meta.url), '..', '..', 'fixtures', 'reference')
const REFERENCE_FILE = join(REFERENCE_DIR, 'gradcam-conv_pw_13_relu-class0.json')
const TOLERANCE = 1e-3

const available = backboneAvailable(0.5)
const suite = available ? describe : describe.skip
if (!available) console.warn(`Skipping Grad-CAM tests: ${MISSING_BACKBONE_REASON}`)

/** Two well-separated classes over fixture images, trained with a fixed seed. */
async function trainOnFixtures(backbone: LoadedBackbone): Promise<TrainedModel> {
  const perClass = 6
  const images = []
  const labels: number[] = []

  // Only the first two fixture classes: the third adds a minute of embedding time
  // for nothing this file asserts.
  for (const [classIndex, className] of FIXTURE_CLASSES.slice(0, 2).entries()) {
    for (let i = 0; i < perClass; i++) {
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
    seed: 1234,
  })
}

suite('gradCam', () => {
  let backbone: LoadedBackbone
  let model: TrainedModel

  beforeAll(async () => {
    // Contract obligation 2: `cpu` so the reference map is reproducible.
    await initBackend('cpu')
    backbone = await loadBackbone(backboneUrl(0.5), 0.5)
    model = await trainOnFixtures(backbone)
  }, 300_000)

  afterAll(() => {
    model.dispose()
    backbone.dispose()
  })

  it('returns a 7×7 map for conv_pw_13_relu (R3)', async () => {
    const map = await gradCam(model, backbone, {
      image: loadFixture('stripes-h', 0),
      classIndex: 0,
    })

    expect(map.width).toBe(7)
    expect(map.height).toBe(7)
    expect(map.values.length).toBe(49)
    expect(map.method).toBe('gradcam')
    expect(map.classIndex).toBe(0)
    expect(map.params.targetLayer).toBe('conv_pw_13_relu')
  })

  it('returns a 14×14 map for conv_pw_11_relu, the "finer detail" option (R3)', async () => {
    // The two resolutions are offered to learners as a teaching point about
    // explanation resolution, so the difference has to be real rather than an
    // upsample of the same 7×7 map.
    const map = await gradCam(model, backbone, {
      image: loadFixture('stripes-h', 0),
      classIndex: 0,
      targetLayer: 'conv_pw_11_relu',
    })

    expect(map.width).toBe(14)
    expect(map.height).toBe(14)
    expect(map.values.length).toBe(196)
    expect(map.params.targetLayer).toBe('conv_pw_11_relu')
  })

  it('normalises to [0,1] with at least one cell at exactly 1 (R3)', async () => {
    const map = await gradCam(model, backbone, {
      image: loadFixture('stripes-h', 0),
      classIndex: 0,
    })

    let max = -Infinity
    let min = Infinity
    for (const value of map.values) {
      max = Math.max(max, value)
      min = Math.min(min, value)
    }

    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeCloseTo(1, 6)
  })

  it('is a ReLU of the weighted sum, so no cell is negative', async () => {
    // The ReLU is what makes the map show evidence FOR the class rather than a
    // signed mixture. Dropping it produces a map that still looks fine and means
    // something different.
    const map = await gradCam(model, backbone, {
      image: loadFixture('circle', 0),
      classIndex: 1,
    })
    for (const value of map.values) expect(value).toBeGreaterThanOrEqual(0)
  })

  it('IS CLASS-SENSITIVE: a different classIndex gives a different map (FR-016)', async () => {
    // The classic silent Grad-CAM bug, and the single most important assertion in
    // this file. An implementation that ignores the class produces a plausible,
    // smooth, subject-highlighting map — the same one for every class.
    const image = loadFixture('stripes-h', 0)
    const forClass0 = await gradCam(model, backbone, { image, classIndex: 0 })
    const forClass1 = await gradCam(model, backbone, { image, classIndex: 1 })

    let maxDifference = 0
    for (let i = 0; i < forClass0.values.length; i++) {
      maxDifference = Math.max(
        maxDifference,
        Math.abs((forClass0.values[i] ?? 0) - (forClass1.values[i] ?? 0)),
      )
    }

    expect(
      maxDifference,
      'the map is identical for two different classes — gradCam is ignoring classIndex',
    ).toBeGreaterThan(0.01)
  })

  it('is deterministic for the same image and class', async () => {
    const image = loadFixture('circle', 2)
    const first = await gradCam(model, backbone, { image, classIndex: 0 })
    const second = await gradCam(model, backbone, { image, classIndex: 0 })
    expect(Array.from(second.values)).toEqual(Array.from(first.values))
  })

  it('explains ANY class, not only the predicted one (FR-016)', async () => {
    // A learner asking "why not the other one?" is the whole point of FR-016, so
    // requesting a class the model did not predict must work rather than refuse.
    const image = loadFixture('stripes-h', 0)
    const probabilities = await model.predict(image, backbone)
    const predicted = probabilities.reduce((a, b) => (b.probability > a.probability ? b : a))
    const other = predicted.classIndex === 0 ? 1 : 0

    const map = await gradCam(model, backbone, { image, classIndex: other })
    expect(map.classIndex).toBe(other)
    expect(map.values.length).toBe(49)
  })

  it('refuses a classIndex outside the model, with a named error', async () => {
    await expect(
      gradCam(model, backbone, { image: loadFixture('circle', 0), classIndex: 7 }),
    ).rejects.toSatisfy((e: unknown) => isMlError(e) && e.code === 'CLASS_INDEX_OUT_OF_RANGE')
  })

  it('matches the stored reference map within tolerance', async () => {
    const map = await gradCam(model, backbone, {
      image: loadFixture('stripes-h', 0),
      classIndex: 0,
    })
    const values = Array.from(map.values)

    if (process.env.UPDATE_GRADCAM_REFERENCE) {
      mkdirSync(dirname(REFERENCE_FILE), { recursive: true })
      writeFileSync(REFERENCE_FILE, JSON.stringify({ width: 7, height: 7, values }, null, 2))
      console.warn(`Wrote a new Grad-CAM reference to ${REFERENCE_FILE}. Review the diff.`)
      return
    }

    if (!existsSync(REFERENCE_FILE)) {
      throw new Error(
        `No Grad-CAM reference at ${REFERENCE_FILE}. Generate it with ` +
          `UPDATE_GRADCAM_REFERENCE=1 npx vitest run tests/unit/gradcam.test.ts, and review the result ` +
          `before committing — this file is what detects a silently changed gradient computation.`,
      )
    }

    const reference = JSON.parse(readFileSync(REFERENCE_FILE, 'utf8')) as {
      width: number
      height: number
      values: number[]
    }

    expect(reference.width).toBe(map.width)
    expect(reference.values).toHaveLength(values.length)

    const deviations: string[] = []
    for (let i = 0; i < values.length; i++) {
      const difference = Math.abs((values[i] ?? 0) - (reference.values[i] ?? 0))
      if (difference > TOLERANCE) {
        deviations.push(`cell ${String(i)}: ${String(values[i])} vs ${String(reference.values[i])}`)
      }
    }

    expect(
      deviations,
      'the gradient computation has changed. If deliberate, regenerate the reference and say why in the commit.',
    ).toEqual([])
  }, 60_000)

  it('leaks no tensors (R8)', async () => {
    const before = tf.memory().numTensors
    await gradCam(model, backbone, { image: loadFixture('circle', 1), classIndex: 0 })
    await gradCam(model, backbone, {
      image: loadFixture('circle', 1),
      classIndex: 1,
      targetLayer: 'conv_pw_11_relu',
    })
    expect(tf.memory().numTensors).toBe(before)
  })
})

/**
 * The zero-gradient case, isolated so it can construct the degenerate model it
 * needs rather than hoping the fixture-trained one produces zero gradients.
 */
suite('gradCam with no gradient anywhere', () => {
  let backbone: LoadedBackbone

  beforeAll(async () => {
    await initBackend('cpu')
    backbone = await loadBackbone(backboneUrl(0.5), 0.5)
  }, 300_000)

  afterAll(() => {
    backbone.dispose()
  })

  it('returns an all-zero map rather than dividing by zero (R3)', async () => {
    const model = await trainOnFixtures(backbone)
    try {
      // Zeroing the output layer's weights makes every gradient through the head
      // exactly zero. Normalising by the map's own maximum then divides by zero,
      // which yields NaN — and a NaN map paints as a blank or garbage overlay with
      // no indication that anything went wrong.
      const output = model.head.pooled.getLayer('head_output')
      output.setWeights(output.getWeights().map((w) => tf.zerosLike(w)))

      const map = await gradCam(model, backbone, {
        image: loadFixture('circle', 0),
        classIndex: 0,
      })

      for (const value of map.values) {
        expect(Number.isNaN(value)).toBe(false)
        expect(value).toBe(0)
      }
    } finally {
      model.dispose()
    }
  }, 300_000)

  it('lets the caller detect the all-zero case', async () => {
    // The contract requires the caller to be able to tell. Without it, the
    // interface shows an empty overlay that reads as "the model looked nowhere",
    // which is a claim about the model rather than about the computation.
    const model = await trainOnFixtures(backbone)
    try {
      const output = model.head.pooled.getLayer('head_output')
      output.setWeights(output.getWeights().map((w) => tf.zerosLike(w)))

      const map = await gradCam(model, backbone, {
        image: loadFixture('circle', 0),
        classIndex: 0,
      })
      expect(map.params.degenerate).toBe(1)
    } finally {
      model.dispose()
    }
  }, 300_000)
})
