import { describe, it, expect } from 'vitest'
import {
  agreement,
  classifyBand,
  ranks,
  resample,
  topKIoU,
  COMPARISON_SIZE,
  PARTIAL_THRESHOLD,
  STRONG_THRESHOLD,
  TOP_K_FRACTION,
} from '@/ml/explain/agreement'
import type { HeatMap, ExplanationMethod } from '@/ml/types'

/**
 * T062 / FR-015, R5 — agreement between two explanations.
 *
 * Two things here are worth more than they look.
 *
 * **Differing native resolutions are resampled, not rejected.** A 7×7 Grad-CAM map
 * against a 12×12 occlusion map is the *normal* case, not an edge case, so a
 * function that refused it would make the comparison view impossible to build.
 *
 * **Ties are averaged when ranking.** An occlusion map routinely has dozens of
 * cells at exactly zero — every region whose covering changed nothing — and a
 * naive ranking would order those arbitrarily, making the correlation depend on
 * array order rather than on the data. That is the kind of bug that shows up as an
 * agreement figure that changes when nothing did.
 */

function makeMap(
  values: readonly number[],
  size: number,
  method: ExplanationMethod = 'gradcam',
): HeatMap {
  return {
    values: new Float32Array(values),
    width: size,
    height: size,
    method,
    classIndex: 0,
    params: {},
  }
}

/** A map that is hot in one quadrant and cold elsewhere. */
function quadrantMap(size: number, hotRow: 0 | 1, hotColumn: 0 | 1): HeatMap {
  const values = new Array<number>(size * size).fill(0.05)
  const half = Math.floor(size / 2)
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const inHotRow = hotRow === 0 ? row < half : row >= half
      const inHotColumn = hotColumn === 0 ? column < half : column >= half
      if (inHotRow && inHotColumn) values[row * size + column] = 1
    }
  }
  return makeMap(values, size)
}

describe('resample', () => {
  it('leaves a map already at the comparison size untouched', () => {
    const map = makeMap(
      Array.from({ length: COMPARISON_SIZE * COMPARISON_SIZE }, (_, i) => i / 196),
      COMPARISON_SIZE,
    )
    expect(Array.from(resample(map, COMPARISON_SIZE))).toEqual(Array.from(map.values))
  })

  it('upsamples 7×7 to 14×14', () => {
    const map = makeMap(Array.from({ length: 49 }, (_, i) => i / 48), 7)
    const resampled = resample(map, 14)
    expect(resampled).toHaveLength(196)
  })

  it('downsamples 12×12 to 14×14 without inventing values', () => {
    // Nearest-neighbour, deliberately: this feeds a RANK correlation, and
    // interpolation would invent intermediate values that were never computed —
    // shifting the ranking of exactly the cells the two methods disagreed about,
    // and biasing every figure here in the flattering direction.
    const map = makeMap(Array.from({ length: 144 }, (_, i) => (i % 2 === 0 ? 0 : 1)), 12)
    const resampled = resample(map, COMPARISON_SIZE)
    for (const value of resampled) {
      expect([0, 1]).toContain(value)
    }
  })

  it('keeps a hot corner in the same corner', () => {
    // A resample that flipped or transposed would still produce a plausible
    // agreement figure, and every conclusion drawn from it would be wrong.
    const map = makeMap([1, 0, 0, 0], 2)
    const resampled = resample(map, 4)
    expect(resampled[0]).toBe(1)
    expect(resampled[15]).toBe(0)
  })
})

describe('ranks', () => {
  it('ranks ascending, one-based', () => {
    expect(Array.from(ranks(new Float32Array([10, 20, 30])))).toEqual([1, 2, 3])
  })

  it('AVERAGES TIES, so array order cannot affect the result', () => {
    // Four equal values share ranks 1..4, averaging to 2.5 each.
    expect(Array.from(ranks(new Float32Array([5, 5, 5, 5])))).toEqual([2.5, 2.5, 2.5, 2.5])
    // A mixed case: two zeros then two distinct values.
    expect(Array.from(ranks(new Float32Array([0, 0, 1, 2])))).toEqual([1.5, 1.5, 3, 4])
  })

  it('gives the same ranks for a permuted input, allowing for the permutation', () => {
    const a = ranks(new Float32Array([0, 0, 0, 1]))
    const b = ranks(new Float32Array([1, 0, 0, 0]))
    expect(Array.from(a).sort()).toEqual(Array.from(b).sort())
  })
})

describe('topKIoU', () => {
  it('is 1 for identical maps', () => {
    const values = new Float32Array(Array.from({ length: 100 }, (_, i) => i / 100))
    expect(topKIoU(values, values, TOP_K_FRACTION)).toBe(1)
  })

  it('is 0 when the hot regions are disjoint', () => {
    const a = new Float32Array(100).fill(0)
    const b = new Float32Array(100).fill(0)
    for (let i = 0; i < 20; i++) a[i] = 1
    for (let i = 80; i < 100; i++) b[i] = 1
    expect(topKIoU(a, b, TOP_K_FRACTION)).toBe(0)
  })

  it('is partial for a partial overlap', () => {
    const a = new Float32Array(100).fill(0)
    const b = new Float32Array(100).fill(0)
    for (let i = 0; i < 20; i++) a[i] = 1
    for (let i = 10; i < 30; i++) b[i] = 1
    // 10 shared of 30 in the union.
    expect(topKIoU(a, b, TOP_K_FRACTION)).toBeCloseTo(10 / 30, 6)
  })

  it('always compares at least one cell', () => {
    const a = new Float32Array([1, 0])
    expect(topKIoU(a, a, 0.001)).toBe(1)
  })
})

describe('classifyBand', () => {
  it('uses R5s thresholds of 0.6 and 0.2', () => {
    expect(STRONG_THRESHOLD).toBe(0.6)
    expect(PARTIAL_THRESHOLD).toBe(0.2)

    expect(classifyBand(0.9)).toBe('strong')
    expect(classifyBand(0.6)).toBe('strong')
    expect(classifyBand(0.59)).toBe('partial')
    expect(classifyBand(0.2)).toBe('partial')
    expect(classifyBand(0.19)).toBe('disagreement')
    expect(classifyBand(-0.8)).toBe('disagreement')
  })
})

describe('agreement', () => {
  it('reports strong agreement for two maps hot in the same place', () => {
    const a = quadrantMap(7, 0, 0)
    const b = quadrantMap(12, 0, 0)
    const result = agreement(a, b)

    expect(result.band).toBe('strong')
    expect(result.spearman).toBeGreaterThan(STRONG_THRESHOLD)
    expect(result.topKIoU).toBeGreaterThan(0.5)
  })

  it('reports DISAGREEMENT for maps hot in opposite corners', () => {
    // The case FR-018 is about: the interface must state explicitly that neither
    // map is guaranteed correct, and it can only do that if this returns the band.
    const a = quadrantMap(7, 0, 0)
    const b = quadrantMap(12, 1, 1)
    const result = agreement(a, b)

    expect(result.band).toBe('disagreement')
    expect(result.topKIoU).toBeLessThan(0.2)
  })

  it('RESAMPLES differing native resolutions rather than rejecting them', () => {
    // 7×7 Grad-CAM against 12×12 occlusion is the normal case, not an edge case.
    const gradcam = makeMap(Array.from({ length: 49 }, (_, i) => i / 48), 7, 'gradcam')
    const occlusion = makeMap(Array.from({ length: 144 }, (_, i) => i / 143), 12, 'occlusion')

    const result = agreement(gradcam, occlusion)
    expect(Number.isFinite(result.spearman)).toBe(true)
    expect(result.cells).toBe(COMPARISON_SIZE * COMPARISON_SIZE)
  })

  it('reports 1 for a map against itself', () => {
    const map = makeMap(Array.from({ length: 144 }, (_, i) => Math.sin(i) * 0.5 + 0.5), 12)
    const result = agreement(map, map)
    expect(result.spearman).toBeCloseTo(1, 6)
    expect(result.topKIoU).toBe(1)
    expect(result.band).toBe('strong')
  })

  it('reports about -1 for a map against its inverse', () => {
    const forward = makeMap(Array.from({ length: 144 }, (_, i) => i / 143), 12)
    const reversed = makeMap(Array.from({ length: 144 }, (_, i) => 1 - i / 143), 12)
    const result = agreement(forward, reversed)

    expect(result.spearman).toBeCloseTo(-1, 4)
    expect(result.band).toBe('disagreement')
  })

  it('returns 0 rather than NaN when one map is constant', () => {
    // An all-zero occlusion map is a real outcome — no covered region changed the
    // answer. A NaN here would reach the interface as "NaN agreement" and destroy
    // trust in every other figure on the screen.
    const flat = makeMap(new Array<number>(144).fill(0.5), 12)
    const varied = makeMap(Array.from({ length: 144 }, (_, i) => i / 143), 12)
    const result = agreement(flat, varied)

    expect(Number.isNaN(result.spearman)).toBe(false)
    expect(result.spearman).toBe(0)
    expect(result.band).toBe('disagreement')
  })

  it('handles two constant maps without dividing by zero', () => {
    const flat = makeMap(new Array<number>(49).fill(0), 7)
    const result = agreement(flat, flat)
    expect(Number.isNaN(result.spearman)).toBe(false)
  })

  it('is symmetric', () => {
    const a = quadrantMap(7, 0, 1)
    const b = quadrantMap(12, 1, 0)
    expect(agreement(a, b).spearman).toBeCloseTo(agreement(b, a).spearman, 10)
    expect(agreement(a, b).topKIoU).toBeCloseTo(agreement(b, a).topKIoU, 10)
  })

  it('does not blend the two maps (FR-018)', () => {
    // Nothing here returns a combined map, and that is deliberate: FR-018 forbids
    // the interface from quietly averaging two disagreeing explanations, and the
    // easiest way to hold that line is to give it nothing to average.
    const result = agreement(quadrantMap(7, 0, 0), quadrantMap(12, 1, 1))
    expect(Object.keys(result).sort()).toEqual(['band', 'cells', 'spearman', 'topKIoU'])
  })
})
