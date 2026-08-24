import { describe, it, expect } from 'vitest'
import { applyColormap, legendStops, rampColour, RAMP_SIZE } from '@/ml/explain/colormap'
import type { HeatMap } from '@/ml/types'

/**
 * T051 / R6 / FR-017, FR-019.
 *
 * The assertion that earns this file its place is **monotonic lightness**. It is
 * the property that makes the ramp readable as data: a non-monotonic ramp (jet
 * being the canonical offender) invents visual boundaries where the data is
 * smooth, and in an explainability tool that means teaching a learner to see
 * structure the model does not have.
 *
 * It is also the property most likely to be destroyed by a well-meaning change —
 * "let us use the Technovation colours here too" produces a ramp that fails this
 * test, which is exactly why Principle V's exemption for heat maps needs a test to
 * defend it rather than a comment.
 */

/** CIE relative luminance, the standard measure of perceived lightness. */
function luminance([r, g, b]: readonly [number, number, number]): number {
  const linear = (channel: number) => {
    const v = channel / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function heatMap(values: readonly number[], width: number, height: number): HeatMap {
  return {
    values: new Float32Array(values),
    width,
    height,
    method: 'gradcam',
    classIndex: 0,
    params: { targetLayer: 'conv_pw_13_relu' },
  }
}

describe('the ramp', () => {
  it('is monotonic in lightness across all 256 entries (R6)', () => {
    let previous = -Infinity
    const failures: string[] = []

    for (let i = 0; i < RAMP_SIZE; i++) {
      const current = luminance(rampColour(i / (RAMP_SIZE - 1)))
      if (current < previous) {
        failures.push(`entry ${String(i)}: ${String(current)} < ${String(previous)}`)
      }
      previous = current
    }

    expect(
      failures,
      'a non-monotonic ramp invents boundaries the data does not have (jet is rejected for exactly this)',
    ).toEqual([])
  })

  it('is perceptually spread rather than bunched at one end', () => {
    // A uniform ramp should traverse most of the available lightness range. A ramp
    // that spent 200 of its 256 entries within one perceptual step would still be
    // monotonic and would still be useless.
    const lowest = luminance(rampColour(0))
    const highest = luminance(rampColour(1))
    expect(highest - lowest).toBeGreaterThan(0.7)
  })

  it('runs dark at the cold end and bright at the hot end', () => {
    // "Hot" reading as bright is what makes the map legible to a beginner without
    // consulting the legend first.
    expect(luminance(rampColour(0))).toBeLessThan(0.05)
    expect(luminance(rampColour(1))).toBeGreaterThan(0.8)
  })

  it('is not a brand ramp: the hot end is not a Technovation accent', () => {
    // Principle V exempts heat maps precisely so this stays a data visualisation.
    // The exemption is not permission to use the brand palette here anyway.
    const hot = rampColour(1)
    for (const accent of [
      [4, 30, 66], // navy
      [0, 118, 207], // blue
      [255, 117, 0], // orange
      [236, 0, 137], // magenta
    ] as const) {
      const distance = Math.hypot(
        hot[0] - accent[0],
        hot[1] - accent[1],
        hot[2] - accent[2],
      )
      expect(distance).toBeGreaterThan(60)
    }
  })

  it('clamps out-of-range and non-finite values rather than reading past the table', () => {
    expect(rampColour(-1)).toEqual(rampColour(0))
    expect(rampColour(2)).toEqual(rampColour(1))
    expect(rampColour(Number.NaN)).toEqual(rampColour(0))
  })

  it('is deterministic', () => {
    expect(rampColour(0.37)).toEqual(rampColour(0.37))
  })
})

describe('applyColormap', () => {
  it("returns RGBA at the map's native resolution, 4 bytes per value", () => {
    const map = heatMap([0, 0.25, 0.5, 0.75], 2, 2)
    const rgba = applyColormap(map, 1)
    expect(rgba).toBeInstanceOf(Uint8ClampedArray)
    expect(rgba.length).toBe(4 * 4)
  })

  it('does not upsample — a 12×12 occlusion map stays 144 cells', () => {
    // data-model.md is explicit that resolution is method-specific. A colormap that
    // silently resized to 7 or 14 would corrupt every occlusion map, and the result
    // would still look like a heat map.
    const map: HeatMap = {
      values: new Float32Array(144).fill(0.5),
      width: 12,
      height: 12,
      method: 'occlusion',
      classIndex: 0,
      params: { gridSize: 12 },
    }
    expect(applyColormap(map, 1).length).toBe(144 * 4)
  })

  it('maps opacity to the alpha channel (FR-019)', () => {
    const map = heatMap([1, 1], 2, 1)
    expect(applyColormap(map, 1)[3]).toBe(255)
    expect(applyColormap(map, 0.5)[3]).toBe(128)
    expect(applyColormap(map, 0)[3]).toBe(0)
  })

  it('scales alpha by the cell value, so cold cells let the photo show through', () => {
    // A uniform alpha would tint the whole frozen frame dark purple and hide the
    // very thing being explained.
    const map = heatMap([0, 0.5, 1], 3, 1)
    const rgba = applyColormap(map, 1)
    expect(rgba[3]).toBe(0)
    expect(rgba[7]).toBe(128)
    expect(rgba[11]).toBe(255)
  })

  it('clamps an opacity outside [0,1]', () => {
    const map = heatMap([1], 1, 1)
    expect(applyColormap(map, 5)[3]).toBe(255)
    expect(applyColormap(map, -5)[3]).toBe(0)
  })

  it('preserves row-major order', () => {
    // Cell 0 is cold and cell 3 is hot, so the first pixel must be darker than the
    // last. A transposed or reversed walk would still produce a plausible picture.
    const map = heatMap([0, 0, 0, 1], 2, 2)
    const rgba = applyColormap(map, 1)
    const first = luminance([rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0])
    const last = luminance([rgba[12] ?? 0, rgba[13] ?? 0, rgba[14] ?? 0])
    expect(last).toBeGreaterThan(first)
  })

  it('handles an all-zero map, which is what a zero-gradient Grad-CAM returns', () => {
    const map = heatMap([0, 0, 0, 0], 2, 2)
    const rgba = applyColormap(map, 1)
    // Fully transparent, so the frame shows unaltered rather than a flat purple
    // wash a learner would read as "the model looked here".
    for (let i = 0; i < 4; i++) expect(rgba[i * 4 + 3]).toBe(0)
  })
})

describe('legendStops', () => {
  it('returns the requested number of stops', () => {
    expect(legendStops(5)).toHaveLength(5)
    expect(legendStops(12)).toHaveLength(12)
  })

  it('spans the whole ramp, coldest first', () => {
    const stops = legendStops(8)
    expect(stops[0]).toBe(stops[0]?.toLowerCase())
    // First and last must be the ramp's ends, or the legend misrepresents the map.
    const parse = (css: string) => css.match(/\d+/g)?.map(Number) ?? []
    expect(parse(stops[0] ?? '')).toEqual([...rampColour(0)])
    expect(parse(stops.at(-1) ?? '')).toEqual([...rampColour(1)])
  })

  it('returns nothing for a degenerate count, rather than dividing by zero', () => {
    expect(legendStops(1)).toEqual([])
    expect(legendStops(0)).toEqual([])
  })

  it('produces CSS a browser will accept', () => {
    for (const stop of legendStops(6)) {
      expect(stop).toMatch(/^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/)
    }
  })
})
