import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import type { ImageSource } from '@/ml/types'

/**
 * Decodes the PNG subset that scripts/make-fixtures.mjs writes: 8-bit truecolour RGB,
 * no interlace, filter type 0 on every scanline.
 *
 * Deliberately narrow. We own the encoder, so supporting the whole PNG specification
 * here would be untested code guarding against inputs that cannot occur. Anything
 * outside the subset throws with a message naming what it found, so a future fixture
 * generated differently fails loudly instead of decoding to garbage that would then be
 * blamed on the ML core.
 */
export function decodePng(bytes: Buffer): ImageSource {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) throw new Error('Not a PNG: bad signature')
  }

  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      const colourType = data[9]
      const interlace = data[12]
      if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${String(bitDepth)}; expected 8`)
      if (colourType !== 2) {
        throw new Error(`Unsupported PNG colour type ${String(colourType)}; expected 2 (RGB)`)
      }
      if (interlace !== 0) throw new Error('Interlaced PNG is not supported')
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }

    offset += 12 + length
  }

  if (width === 0 || height === 0) throw new Error('PNG had no IHDR')

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 3
  const rgba = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter !== 0) {
      throw new Error(
        `PNG scanline ${String(y)} uses filter ${String(filter)}; this decoder only handles filter 0. ` +
          `Regenerate the fixtures with scripts/make-fixtures.mjs.`,
      )
    }
    for (let x = 0; x < width; x++) {
      const src = y * (stride + 1) + 1 + x * 3
      const dst = (y * width + x) * 4
      rgba[dst] = raw[src]!
      rgba[dst + 1] = raw[src + 1]!
      rgba[dst + 2] = raw[src + 2]!
      rgba[dst + 3] = 255
    }
  }

  return { data: rgba, width, height }
}

export function loadPng(path: string): ImageSource {
  return decodePng(readFileSync(path))
}
