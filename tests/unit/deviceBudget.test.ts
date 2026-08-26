import { describe, it, expect } from 'vitest'
import {
  chooseDeviceBudget,
  variantCount,
  COARSE_GRID_SIZE,
  FINE_GRID_SIZE,
} from '@/features/lab/deviceBudget'
import type { BackendReport } from '@/ml/types'

/**
 * T118 / SC-003, R4, R7 — the mobile performance trade, tested as pure logic.
 *
 * The property that matters is not which grid it picks but that **it never picks
 * something that is not a grid**: every branch must return a usable occlusion
 * resolution, because Principle IV degrades speed and never removes capability. A
 * budget that returned zero, or null, would turn "slower on a Chromebook" into
 * "the comparison module does not work on a Chromebook", which is a different and
 * much worse product.
 */

const accelerated: BackendReport = {
  active: 'webgl',
  accelerated: true,
  attempted: ['webgl'],
}

const unaccelerated: BackendReport = {
  active: 'wasm',
  accelerated: false,
  attempted: ['webgl', 'wasm'],
}

describe('chooseDeviceBudget', () => {
  it('uses the full grid on an accelerated desktop', () => {
    const budget = chooseDeviceBudget(accelerated, 1440)
    expect(budget.occlusionGridSize).toBe(FINE_GRID_SIZE)
    expect(budget.reason).toBeNull()
  })

  it('coarsens when there is no hardware acceleration', () => {
    // 144 forward passes under WASM is not five seconds (SC-003) — it is closer to a
    // minute, during which a learner reloads and loses the pass she was waiting for.
    const budget = chooseDeviceBudget(unaccelerated, 1440)
    expect(budget.occlusionGridSize).toBe(COARSE_GRID_SIZE)
    expect(budget.reason).toBe('no-acceleration')
  })

  it('coarsens at 360 px, where the extra detail is not visible anyway', () => {
    const budget = chooseDeviceBudget(accelerated, 360)
    expect(budget.occlusionGridSize).toBe(COARSE_GRID_SIZE)
    expect(budget.reason).toBe('small-screen')
  })

  it('reports acceleration as the reason when both apply', () => {
    // Acceleration is the trigger that actually costs seconds, so it is the one
    // named — a learner told "small screen" would try rotating her phone.
    expect(chooseDeviceBudget(unaccelerated, 360).reason).toBe('no-acceleration')
  })

  it('assumes the full grid before the backend has reported', () => {
    // `null` is the state during start-up. Assuming the worst would permanently
    // coarsen a fast laptop whose report arrived a moment late.
    expect(chooseDeviceBudget(null, 1440).occlusionGridSize).toBe(FINE_GRID_SIZE)
  })

  it('always returns a usable grid, never zero or a non-integer', () => {
    // The property Principle IV actually requires: degrade speed, never remove
    // capability. Every branch must still produce a working occlusion pass.
    for (const backend of [null, accelerated, unaccelerated]) {
      for (const width of [0, 320, 360, 400, 401, 768, 1440, 3840]) {
        const { occlusionGridSize } = chooseDeviceBudget(backend, width)
        expect(Number.isInteger(occlusionGridSize)).toBe(true)
        // `occlusionSensitivity` refuses a grid below 2×2.
        expect(occlusionGridSize).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('coarse is a real saving rather than a gesture', () => {
    // 64 against 144 — 56% fewer forward passes. A reduction that saved 10% would
    // not be worth the extra state and the extra sentence in the interface.
    expect(variantCount(COARSE_GRID_SIZE)).toBe(64)
    expect(variantCount(FINE_GRID_SIZE)).toBe(144)
    expect(variantCount(COARSE_GRID_SIZE) / variantCount(FINE_GRID_SIZE)).toBeLessThan(0.5)
  })
})
