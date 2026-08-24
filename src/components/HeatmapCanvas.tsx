import { useEffect, useRef } from 'react'

/**
 * T014 — draws a heat map over a frozen frame.
 *
 * The component takes **already-coloured RGBA** at the map's native resolution rather than
 * raw values plus a colormap. Two reasons: it keeps a shared primitive free of any
 * `src/ml/` import, and the native resolution is method-specific (7 or 14 for Grad-CAM,
 * the grid size for occlusion — data-model.md), so a component that assumed one would
 * silently corrupt the other.
 *
 * Upsampling is done by the browser's own image smoothing, which is bilinear — the
 * cheapest correct way to get from a 7×7 map to a 224 px display. The coarseness is real
 * and pedagogically relevant (R3): this component must not pretend to more precision than
 * the map has, so nothing here sharpens or contours it.
 */

export interface HeatmapCanvasProps {
  /** The frozen frame the map explains. */
  readonly base: ImageBitmap | HTMLCanvasElement | HTMLImageElement | null
  /** RGBA, 4 bytes per cell, `mapWidth * mapHeight * 4` long. */
  readonly overlay: Uint8ClampedArray | null
  readonly mapWidth: number
  readonly mapHeight: number
  /** Display size in CSS pixels. Square, matching the model's own input aspect. */
  readonly displaySize?: number
  /**
   * Describes where the strongest evidence falls, in words (FR-017, SC-009). A canvas is
   * invisible to a screen reader, so this is the only route to the same information and
   * is therefore required rather than optional.
   */
  readonly textAlternative: string
  readonly className?: string
}

export function HeatmapCanvas({
  base,
  overlay,
  mapWidth,
  mapHeight,
  displaySize = 224,
  textAlternative,
  className = '',
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(displaySize * dpr)
    canvas.height = Math.round(displaySize * dpr)

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    if (base) ctx.drawImage(base, 0, 0, canvas.width, canvas.height)

    if (overlay && mapWidth > 0 && mapHeight > 0) {
      if (overlay.length !== mapWidth * mapHeight * 4) {
        // A length mismatch means the caller paired a map with the wrong dimensions,
        // which would render as a plausible-looking but wrong picture. Refuse instead.
        throw new Error(
          `Heat-map overlay is ${String(overlay.length)} bytes but ${String(mapWidth)}×${String(mapHeight)} needs ${String(mapWidth * mapHeight * 4)}.`,
        )
      }
      // Put the small map into its own tiny canvas, then let drawImage scale it. Writing
      // RGBA at display size instead would mean upsampling by hand, badly.
      const small = document.createElement('canvas')
      small.width = mapWidth
      small.height = mapHeight
      const smallCtx = small.getContext('2d')
      if (smallCtx) {
        // Copied into a fresh array: `ImageData` requires a plain `ArrayBuffer` backing,
        // and the caller's array may be `SharedArrayBuffer`-backed. At 144 cells the copy
        // is free, and it also stops a later mutation of the caller's buffer from
        // altering what was drawn.
        smallCtx.putImageData(new ImageData(new Uint8ClampedArray(overlay), mapWidth, mapHeight), 0, 0)
        ctx.drawImage(small, 0, 0, canvas.width, canvas.height)
      }
    }
  }, [base, overlay, mapWidth, mapHeight, displaySize])

  return (
    <figure className={`m-0 flex flex-col gap-2 ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={textAlternative}
        // Width in CSS is 100% up to the display size so the frame shrinks to fit 360 px
        // rather than forcing a horizontal scroll (FR-045, SC-004).
        className="h-auto w-full max-w-full rounded border border-border-subtle bg-surface-sunken"
        style={{ maxWidth: `${String(displaySize)}px`, aspectRatio: '1 / 1' }}
      />
      <figcaption className="text-sm text-ink-muted">{textAlternative}</figcaption>
    </figure>
  )
}
