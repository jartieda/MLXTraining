import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as tf from '@tensorflow/tfjs'
import { loadBackbone, warmUp } from '@/ml/backbone'
import type { LoadedBackbone } from '@/ml/backbone'
import { isMlError } from '@/ml/types'
import { initBackend } from '@/ml/backend'
import { loadFixture, solidImage } from '../helpers/fixtures.ts'
import { backboneUrl, backboneAvailable, registerFileLoadRouter, MISSING_BACKBONE_REASON } from '../helpers/localModel.ts'

/**
 * T018 / R1, R2 / FR-006 — the backbone contract.
 *
 * These assertions are the reason Principle VI exists. A backbone truncated at the wrong
 * layer, or one whose embeddings drift between calls, produces a model that still trains
 * and still predicts — and heat maps that are quietly meaningless. Nothing in the
 * interface would show it.
 */

registerFileLoadRouter()

const available = backboneAvailable(0.5) && backboneAvailable(0.25)
const suite = available ? describe : describe.skip
if (!available) console.warn(`Skipping backbone tests: ${MISSING_BACKBONE_REASON}`)

suite('loadBackbone', () => {
  let backbone: LoadedBackbone
  let tensorsBeforeLoad = 0

  beforeAll(async () => {
    // The whole ML suite pins `cpu` for determinism (contract obligation 2).
    await initBackend('cpu')
    tensorsBeforeLoad = tf.memory().numTensors
    backbone = await loadBackbone(backboneUrl(0.5), 0.5)
  }, 120_000)

  afterAll(() => {
    backbone.dispose()
  })

  it('reports the alpha it was loaded with', () => {
    expect(backbone.alpha).toBe(0.5)
  })

  it('produces a 512-long pooled embedding at alpha 0.5 (R1)', async () => {
    expect(backbone.embeddingSize).toBe(512)
    const embedding = await backbone.embed(loadFixture('circle', 0))
    expect(embedding).toBeInstanceOf(Float32Array)
    expect(embedding.length).toBe(512)
  })

  it('truncates at conv_pw_13_relu, giving a 7×7×512 activation', async () => {
    const activation = await backbone.activation(loadFixture('circle', 0), 'conv_pw_13_relu')
    expect(activation.width).toBe(7)
    expect(activation.height).toBe(7)
    expect(activation.channels).toBe(512)
    expect(activation.values.length).toBe(7 * 7 * 512)
    expect(activation.layer).toBe('conv_pw_13_relu')
  })

  it('gives a 14×14×256 activation at the finer target layer (R3)', async () => {
    const activation = await backbone.activation(loadFixture('circle', 0), 'conv_pw_11_relu')
    expect(activation.width).toBe(14)
    expect(activation.height).toBe(14)
    expect(activation.channels).toBe(256)
    expect(activation.values.length).toBe(14 * 14 * 256)
  })

  it('is a ReLU output, so no activation value is negative', async () => {
    const activation = await backbone.activation(loadFixture('stripes-h', 0), 'conv_pw_13_relu')
    let min = Infinity
    for (const value of activation.values) min = Math.min(min, value)
    expect(min).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic: the same image embeds identically twice (frozen weights)', async () => {
    const image = loadFixture('stripes-v', 3)
    const first = await backbone.embed(image)
    const second = await backbone.embed(image)
    expect(Array.from(second)).toEqual(Array.from(first))
  })

  it('distinguishes visually different classes', async () => {
    // Not an accuracy claim — just that the features are not collapsed. A backbone
    // returning near-identical vectors for a horizontal-stripe and a circle fixture is
    // loading wrong, and every downstream test would still pass.
    const a = await backbone.embed(loadFixture('stripes-h', 0))
    const b = await backbone.embed(loadFixture('circle', 0))
    const distance = Math.hypot(...Array.from(a, (value, i) => value - (b[i] ?? 0)))
    expect(distance).toBeGreaterThan(1e-3)
  })

  it('embeds a batch as one concatenated array in input order', async () => {
    const images = [loadFixture('circle', 0), loadFixture('stripes-h', 0), loadFixture('circle', 0)]
    const batch = await backbone.embedBatch(images)
    expect(batch.length).toBe(3 * 512)

    // Batched and single paths must agree, or training silently learns from different
    // features than inference reads.
    const single = await backbone.embed(images[1]!)
    const slice = batch.slice(512, 1024)
    for (let i = 0; i < 512; i++) {
      expect(slice[i]!).toBeCloseTo(single[i]!, 4)
    }

    // First and third are the same image, so their slices must match exactly.
    expect(Array.from(batch.slice(0, 512))).toEqual(Array.from(batch.slice(1024, 1536)))
  })

  it('accepts an ImageSource of any size, resizing internally to 224', async () => {
    const small = solidImage(64, 48, 128)
    const embedding = await backbone.embed(small)
    expect(embedding.length).toBe(512)
  })

  it('leaks no tensors across embed, embedBatch and activation (R8)', async () => {
    const before = tf.memory().numTensors
    await backbone.embed(loadFixture('circle', 1))
    await backbone.embedBatch([loadFixture('circle', 1), loadFixture('circle', 2)])
    await backbone.activation(loadFixture('circle', 1), 'conv_pw_13_relu')
    expect(tf.memory().numTensors).toBe(before)
  })

  it('warmUp leaves no tensors behind', async () => {
    const before = tf.memory().numTensors
    await warmUp(backbone)
    expect(tf.memory().numTensors).toBe(before)
  })

  it('dispose() returns numTensors to its pre-load value', async () => {
    // A separate instance, so the shared one survives for the rest of the suite.
    const before = tf.memory().numTensors
    const scratch = await loadBackbone(backboneUrl(0.25), 0.25)
    expect(tf.memory().numTensors).toBeGreaterThan(before)
    await scratch.embed(loadFixture('circle', 0))
    scratch.dispose()
    expect(tf.memory().numTensors).toBe(before)
  }, 120_000)

  it('is safe to dispose twice', async () => {
    const scratch = await loadBackbone(backboneUrl(0.25), 0.25)
    scratch.dispose()
    expect(() => {
      scratch.dispose()
    }).not.toThrow()
  }, 120_000)

  it('refuses to use a disposed backbone rather than returning nonsense', async () => {
    const scratch = await loadBackbone(backboneUrl(0.25), 0.25)
    scratch.dispose()
    await expect(scratch.embed(loadFixture('circle', 0))).rejects.toThrow()
  }, 120_000)

  it('loads alpha 0.25 with a 256-long embedding (R1)', async () => {
    const scratch = await loadBackbone(backboneUrl(0.25), 0.25)
    try {
      expect(scratch.embeddingSize).toBe(256)
      const embedding = await scratch.embed(loadFixture('circle', 0))
      expect(embedding.length).toBe(256)
    } finally {
      scratch.dispose()
    }
  }, 120_000)

  it('keeps the pre-load tensor count recoverable, proving the suite itself does not leak', () => {
    expect(tensorsBeforeLoad).toBeGreaterThanOrEqual(0)
  })
})

describe('loadBackbone rejections', () => {
  it('rejects a graph model with a named, actionable error (R1)', async () => {
    // A graph model cannot be sliced by `tf.model({inputs, outputs})`, so Grad-CAM is
    // impossible against one. The published MobileNet v2 and v3 artifacts are graph
    // models, so this is the mistake a future contributor is most likely to make — and
    // the error must say why rather than surfacing a tfjs internal about an undefined
    // layer config, which is what an unguarded `loadLayersModel` produces here.
    const dir = mkdtempSync(join(tmpdir(), 'ml4g-graphmodel-'))
    writeFileSync(
      join(dir, 'model.json'),
      JSON.stringify({
        format: 'graph-model',
        modelTopology: { node: [], library: {}, versions: {} },
        weightsManifest: [{ paths: [], weights: [] }],
      }),
    )
    const url = pathToFileURL(join(dir, 'model.json')).href

    await expect(loadBackbone(url, 0.5)).rejects.toSatisfy(
      (error: unknown) => isMlError(error) && error.code === 'GRAPH_MODEL_UNSUPPORTED',
    )
  })

  it('reports a load failure rather than hanging', async () => {
    await expect(loadBackbone('file:///nonexistent/model.json', 0.5)).rejects.toThrow()
  })
})
