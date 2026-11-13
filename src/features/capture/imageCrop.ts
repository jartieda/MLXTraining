import { MODEL_INPUT_SIZE, type ImageSource } from '@/ml/types'

/**
 * The centre crop every picture goes through before the model sees it: camera
 * capture, uploads, live prediction, frozen frames and the challenge photos. One
 * shared transform, so a heat map always explains the same framing the model scored.
 *
 * Returns a dedicated canvas (callers that display or keep the picture need one that
 * nothing else will draw over) and its pixels at the model's input size.
 */
export function cropToModelInput(
  source: CanvasImageSource,
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; image: ImageSource } | null {
  const canvas = document.createElement('canvas')
  canvas.width = MODEL_INPUT_SIZE
  canvas.height = MODEL_INPUT_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || width === 0 || height === 0) return null

  const side = Math.min(width, height)
  context.drawImage(
    source,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  )
  const { data } = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
  return { canvas, image: { data, width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE } }
}

/** Decode an image file or a fetched image. `null` when the browser cannot read it. */
export async function decodeImage(blob: Blob): Promise<{ canvas: HTMLCanvasElement; image: ImageSource } | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  try {
    return cropToModelInput(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}
