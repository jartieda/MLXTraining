#!/usr/bin/env node
/**
 * Generates the committed test fixtures (T015).
 *
 * Principle VI requires the ML tests to run "against committed fixture images with a
 * fixed random seed so results are deterministic and regressions are attributable".
 * Generating them from a script rather than checking in photographs means:
 *   - the fixtures are reproducible and reviewable (this file is the spec for them),
 *   - they contain no real person, which matters for a product about not collecting
 *     images of minors,
 *   - the three classes are separable by construction, so a failing training test
 *     indicts the trainer rather than the data.
 *
 * Determinism comes from a seeded LCG, never Math.random.
 *
 * Outputs:
 *   tests/fixtures/class-{stripes-h,stripes-v,circle}-{0..7}.png   224x224 RGB
 *   tests/fixtures/camera.y4m                                      320x240, 15 frames
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')

const SIZE = 224
const SAMPLES_PER_CLASS = 8

/** Deterministic LCG (numerical recipes). Same seed, same fixtures, forever. */
function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

// ---------------------------------------------------------------- PNG encoding

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/** Encodes 8-bit RGB, no interlace, filter type 0. Kept minimal on purpose: the test
 *  helper decodes exactly this subset, so encoder and decoder stay in step. */
function encodePng(rgb, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour RGB
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // One filter byte (0 = None) per scanline.
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- the 3 classes

/**
 * Horizontal stripes, vertical stripes, and a filled circle. Chosen because a frozen
 * MobileNet's convolutional features separate orientation and shape strongly, so a
 * correctly wired classification head reaches high accuracy on very few samples - which
 * is what makes an accuracy assertion in a unit test meaningful rather than flaky.
 */
const CLASSES = {
  'stripes-h': (x, y, p) => {
    const on = Math.floor((y + p.phase) / p.period) % 2 === 0
    return on ? [235, 235, 235] : [25, 25, 25]
  },
  'stripes-v': (x, y, p) => {
    const on = Math.floor((x + p.phase) / p.period) % 2 === 0
    return on ? [235, 235, 235] : [25, 25, 25]
  },
  circle: (x, y, p) => {
    const dx = x - SIZE / 2 - p.offsetX
    const dy = y - SIZE / 2 - p.offsetY
    const inside = dx * dx + dy * dy < p.radius * p.radius
    return inside ? [240, 240, 240] : [20, 20, 20]
  },
}

function renderSample(className, index, rand) {
  const params = {
    // Jitter keeps the samples from being byte-identical - a trainer that memorised one
    // image would otherwise still pass - while staying well inside the class.
    period: 12 + Math.floor(rand() * 8),
    phase: Math.floor(rand() * 12),
    radius: 55 + Math.floor(rand() * 20),
    offsetX: Math.floor((rand() - 0.5) * 24),
    offsetY: Math.floor((rand() - 0.5) * 24),
  }
  const noise = 8
  const rgb = Buffer.alloc(SIZE * SIZE * 3)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = CLASSES[className](x, y, params)
      const n = Math.floor((rand() - 0.5) * noise)
      const o = (y * SIZE + x) * 3
      rgb[o] = Math.min(255, Math.max(0, r + n))
      rgb[o + 1] = Math.min(255, Math.max(0, g + n))
      rgb[o + 2] = Math.min(255, Math.max(0, b + n))
    }
  }
  return encodePng(rgb, SIZE, SIZE)
}

// ---------------------------------------------------------------- Y4M for the fake camera

/**
 * R13: Playwright's --use-file-for-fake-video-capture needs an uncompressed Y4M file.
 * The clip cycles through the three classes so an end-to-end run can capture samples
 * that actually differ, which is what makes a trained-model assertion possible at all.
 */
function makeY4m(width, height, frames) {
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`, 'ascii')
  const parts = [header]
  const names = Object.keys(CLASSES)
  const rand = lcg(20260821)

  for (let f = 0; f < frames; f++) {
    const className = names[Math.floor(f / (frames / names.length)) % names.length]
    const params = { period: 14, phase: f * 2, radius: 40, offsetX: 0, offsetY: 0 }

    const yPlane = Buffer.alloc(width * height)
    const uPlane = Buffer.alloc((width / 2) * (height / 2), 128)
    const vPlane = Buffer.alloc((width / 2) * (height / 2), 128)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Scale the 224-space pattern onto the camera frame.
        const sx = Math.floor((x / width) * SIZE)
        const sy = Math.floor((y / height) * SIZE)
        const [r, g, b] = CLASSES[className](sx, sy, params)
        const luma = 0.299 * r + 0.587 * g + 0.114 * b + (rand() - 0.5) * 4
        yPlane[y * width + x] = Math.min(255, Math.max(0, Math.round(luma)))
      }
    }
    parts.push(Buffer.from('FRAME\n', 'ascii'), yPlane, uPlane, vPlane)
  }
  return Buffer.concat(parts)
}

// ---------------------------------------------------------------- main

await mkdir(OUT, { recursive: true })

let written = 0
for (const className of Object.keys(CLASSES)) {
  // Seed per class, so adding a class never perturbs an existing one's fixtures.
  const rand = lcg(0x5eed + className.length * 7919)
  for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
    const png = renderSample(className, i, rand)
    await writeFile(join(OUT, `class-${className}-${i}.png`), png)
    written++
  }
}
console.log(`Wrote ${written} PNG fixtures (${SIZE}x${SIZE}, 3 classes)`)

const y4m = makeY4m(320, 240, 15)
await writeFile(join(OUT, 'camera.y4m'), y4m)
console.log(`Wrote camera.y4m (${(y4m.length / 1024 / 1024).toFixed(1)} MiB, 320x240, 15 frames)`)
