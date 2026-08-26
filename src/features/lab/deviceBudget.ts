import { DEFAULT_GRID_SIZE } from '@/ml/explain/occlusion'
import type { BackendReport } from '@/ml/types'

/**
 * T118 / SC-002, SC-003, R4, R7 — what this device can afford.
 *
 * SC-003 budgets the batched occlusion pass at 5 s and R4's budget assumes WebGL.
 * A 12×12 grid is 144 forward passes, and on a phone that has fallen back to WASM
 * that is not five seconds — it is closer to a minute, during which the learner
 * concludes the lab has hung and reloads, losing the pass she was waiting for.
 *
 * **The reduction is in resolution, never in capability** (Principle IV: "degrading
 * speed rather than removing capability", and FR-047's warn-don't-refuse). Both
 * explanation methods still run, the comparison still happens, and the agreement
 * score is still computed — the perturbation map is simply coarser, which is a
 * property R3 already says is pedagogically honest rather than a defect. An 8×8 map
 * is 64 variants: the same lesson at 44% of the cost.
 *
 * The interface says which grid it used, because a learner comparing her 8×8 map
 * with a classmate's 12×12 on a faster laptop needs to know why they differ.
 */

/** Grid sizes, coarsest first. Every one is a valid occlusion resolution. */
export const COARSE_GRID_SIZE = 8
export const FINE_GRID_SIZE = DEFAULT_GRID_SIZE

export interface DeviceBudget {
  readonly occlusionGridSize: number
  /** Why it was reduced, or `null` when it was not. */
  readonly reason: 'no-acceleration' | 'small-screen' | null
}

/**
 * Chooses an occlusion grid for this device.
 *
 * Two independent triggers, and acceleration is checked first because it is the one
 * that actually costs seconds. A 360 px screen on a fast phone with WebGL is not
 * slow; a 1440 px Chromebook with software rendering is. Screen width is a weak
 * proxy kept only because it correlates with the low-end Android hardware R7 names,
 * and it is applied only when the map would be unreadably small anyway.
 */
export function chooseDeviceBudget(
  backend: BackendReport | null,
  viewportWidth: number,
): DeviceBudget {
  if (backend && !backend.accelerated) {
    return { occlusionGridSize: COARSE_GRID_SIZE, reason: 'no-acceleration' }
  }

  // At 360 px the map renders into roughly a 320 px square, where a 12×12 cell is
  // 26 px — below the point where the extra detail is visible at all. Spending 80
  // extra forward passes on detail nobody can see is the trade this makes.
  if (viewportWidth <= 400) {
    return { occlusionGridSize: COARSE_GRID_SIZE, reason: 'small-screen' }
  }

  return { occlusionGridSize: FINE_GRID_SIZE, reason: null }
}

/** Variants a grid costs, for the interface to state before it starts. */
export function variantCount(gridSize: number): number {
  return gridSize * gridSize
}
