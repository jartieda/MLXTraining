import type { HeatMap } from '../types'

/**
 * T054 / R6 / FR-017, FR-019 — the heat-map colour ramp.
 *
 * **Inferno**, and the choice is a correctness one rather than an aesthetic one.
 * A perceptually uniform ramp makes equal steps in evidence look like equal steps
 * in colour, which is the property that lets a heat map be read as data. It is
 * also monotonic in lightness, so it survives greyscale printing and is legible
 * with any form of colour-vision deficiency (SC-009).
 *
 * **Jet is explicitly rejected.** Its non-monotonic lightness invents visual
 * boundaries where the data is smooth — in an explainability tool that means
 * teaching a learner to see structure the model does not have, which is the exact
 * opposite of what this product exists to do.
 *
 * This file is the one place Principle V exempts from the Technovation token rule
 * (see the eslint override for it). The exemption exists precisely so the ramp can
 * stay a data visualisation instead of becoming brand decoration, so swapping in
 * navy-to-orange would defeat the reason the exemption was granted.
 */

/**
 * Polynomial fit to matplotlib's `inferno`, evaluated once into a 256-entry table
 * at module load.
 *
 * The fit is used rather than 256 embedded triples because it is a fifth of the
 * size and reproduces the original to well under one 8-bit level — and because
 * the property that matters is checkable: `tests/unit/colormap.test.ts` asserts
 * that relative luminance is monotonically non-decreasing across all 256 entries,
 * which it is, exactly.
 */
const INFERNO_COEFFICIENTS: readonly (readonly [number, number, number])[] = [
  [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
  [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
  [11.60249308247187, -3.972853965665698, -15.9423941062914],
  [-41.70399613139459, 17.43639888205313, 44.35414519872813],
  [77.162935699427, -33.40235894210092, -81.80730925738993],
  [-71.31942824499214, 32.62606426397723, 73.20951985803202],
  [25.13112622477341, -12.24266895238567, -23.07032500287172],
]

export const RAMP_SIZE = 256

function evaluate(t: number): readonly [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let power = 1
  for (const [cr, cg, cb] of INFERNO_COEFFICIENTS) {
    r += cr * power
    g += cg * power
    b += cb * power
    power *= t
  }
  return [
    Math.round(Math.min(1, Math.max(0, r)) * 255),
    Math.round(Math.min(1, Math.max(0, g)) * 255),
    Math.round(Math.min(1, Math.max(0, b)) * 255),
  ]
}

/** 256 × 3 bytes, coldest first. Built once. */
const RAMP: Uint8ClampedArray = (() => {
  const table = new Uint8ClampedArray(RAMP_SIZE * 3)
  for (let i = 0; i < RAMP_SIZE; i++) {
    const [r, g, b] = evaluate(i / (RAMP_SIZE - 1))
    table[i * 3] = r
    table[i * 3 + 1] = g
    table[i * 3 + 2] = b
  }
  return table
})()

/** The RGB triple for a normalised value in [0,1]. */
export function rampColour(value: number): readonly [number, number, number] {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const index = Math.round(clamped * (RAMP_SIZE - 1))
  return [RAMP[index * 3] ?? 0, RAMP[index * 3 + 1] ?? 0, RAMP[index * 3 + 2] ?? 0]
}

/**
 * Colours a heat map, returning RGBA at the map's **native** resolution — 4 bytes
 * per input value, in the same row-major order.
 *
 * Upsampling to the display size is the caller's job (`HeatmapCanvas` lets the
 * browser do it bilinearly). Doing it here would mean this function had to know
 * the display size, and would throw away the honest coarseness that R3 says is
 * pedagogically relevant.
 *
 * `opacity` scales the alpha channel uniformly, which is what FR-019's slider
 * drives. It is applied here rather than as a CSS `opacity` on the canvas so that
 * a learner comparing two maps at the same slider position is comparing the same
 * blend, whatever else is on the page.
 */
export function applyColormap(map: HeatMap, opacity: number): Uint8ClampedArray {
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
  const out = new Uint8ClampedArray(map.values.length * 4)

  for (let i = 0; i < map.values.length; i++) {
    const [r, g, b] = rampColour(map.values[i] ?? 0)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    // Scaled by the cell's own value as well as by the slider, so a cold cell is
    // nearly transparent and the frozen frame shows through where there is no
    // evidence. A uniform alpha would tint the whole photograph dark purple and
    // hide the thing being explained.
    out[i * 4 + 3] = Math.round(alpha * Math.min(1, Math.max(0, map.values[i] ?? 0)))
  }

  return out
}

/**
 * `count` CSS colour strings for the legend, coldest first.
 *
 * The legend's labels must stay relative — "low evidence" to "high evidence" —
 * because every map is normalised by its own maximum (R3). Printing a number
 * would invite a learner to compare two maps as if the scale were absolute, and
 * it is not: the hottest cell is 1.0 in every map, however weak the evidence was.
 */
export function legendStops(count: number): readonly string[] {
  if (count < 2) return []
  return Array.from({ length: count }, (_, i) => {
    const [r, g, b] = rampColour(i / (count - 1))
    return `rgb(${String(r)} ${String(g)} ${String(b)})`
  })
}
