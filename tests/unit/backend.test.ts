import { describe, it, expect, beforeEach } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { initBackend, resetBackendForTesting } from '@/ml/backend'

/**
 * T016, contract: contracts/ml-core.md -> backend.ts
 *
 * The contract that matters most here is "never throws". SC-012 and FR-047 make the
 * no-acceleration path a supported degradation rather than an error case: a learner on a
 * school Chromebook with no working WebGL must get a slower lab, not a broken one. A
 * backend selector that throws would turn that into a blank screen, and it would do so
 * only on the hardware we cannot easily test on.
 */
describe('initBackend', () => {
  beforeEach(() => {
    resetBackendForTesting()
  })

  it('reports an active backend without throwing', async () => {
    const report = await initBackend()
    expect(['webgl', 'wasm', 'cpu']).toContain(report.active)
  })

  it('records which backends it attempted, in preference order', async () => {
    const report = await initBackend()
    expect(report.attempted.length).toBeGreaterThan(0)
    // Whatever it settled on must be the last thing it tried.
    expect(report.attempted.at(-1)).toBe(report.active)
  })

  it('marks cpu and wasm as unaccelerated so the interface can warn (FR-047)', async () => {
    const report = await initBackend()
    expect(report.accelerated).toBe(report.active === 'webgl')
  })

  it('is idempotent: a second call returns the same report without re-initialising', async () => {
    const first = await initBackend()
    const second = await initBackend()
    expect(second).toEqual(first)
    expect(second.active).toBe(tf.getBackend())
  })

  it('falls back rather than throwing when the preferred backend is unavailable', async () => {
    // 'webgl' cannot initialise in a node environment, which is exactly the situation a
    // GPU-less Chromebook presents. The call must degrade, not reject.
    const report = await initBackend('webgl')
    expect(report.active).not.toBe('webgl')
    expect(report.attempted).toContain('webgl')
  })

  it('never reports a backend that tfjs did not actually activate', async () => {
    const report = await initBackend()
    expect(tf.getBackend()).toBe(report.active)
  })
})
