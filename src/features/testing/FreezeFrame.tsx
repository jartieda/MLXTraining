import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { MODEL_INPUT_SIZE, type ImageSource } from '@/ml/types'
import { hashFrame } from './frameHash'
import { decodeImage } from '@/features/capture/imageCrop'

/**
 * T055 / FR-012, D8 — freeze a frame and hash it.
 *
 * The hash is the point of this component as much as the freezing is. It becomes
 * part of the explanation cache key (D8), which matters because a learner in the
 * comparison view switches class and method repeatedly on ONE frozen frame — and
 * recomputing a five-second occlusion pass each time would make that view feel
 * broken.
 *
 * A frozen frame is also the only sound basis for an explanation. Explaining a
 * live frame would mean the heat map described a picture that no longer exists by
 * the time it renders, which is a subtly dishonest thing to show.
 */

export interface FrozenFrame {
  /** The pixels, at the model's own input size. */
  readonly image: ImageSource
  /** Identifies this frame for the explanation cache (D8). */
  readonly hash: string
  /** For display and for `HeatmapCanvas`. */
  readonly canvas: HTMLCanvasElement
}

export interface FreezeFrameProps {
  readonly video: HTMLVideoElement | null
  readonly frozen: FrozenFrame | null
  readonly onFreeze: (frame: FrozenFrame | null) => void
  /** Test photos of the challenge this project came from, if any. */
  readonly testPhotos?: readonly { readonly url: string; readonly label: string }[]
}

export function FreezeFrame({ video, frozen, onFreeze, testPhotos = [] }: FreezeFrameProps) {
  const { t } = useTranslation('testing')
  const displayRef = useRef<HTMLCanvasElement>(null)
  const [problem, setProblem] = useState(false)

  const freeze = useCallback(() => {
    if (!video || video.videoWidth === 0) {
      setProblem(true)
      return
    }
    setProblem(false)

    // A dedicated canvas per frozen frame, not the shared scratch one: this canvas
    // is handed to `HeatmapCanvas` as the base image and has to survive until the
    // learner unfreezes. Reusing a scratch canvas would let the next live frame
    // overwrite the picture being explained.
    const canvas = document.createElement('canvas')
    canvas.width = MODEL_INPUT_SIZE
    canvas.height = MODEL_INPUT_SIZE

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      setProblem(true)
      return
    }

    // The same centre crop as capture and live prediction. A different transform
    // here would mean the heat map explained a differently-framed picture from the
    // one the model scored.
    const side = Math.min(video.videoWidth, video.videoHeight)
    context.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      MODEL_INPUT_SIZE,
      MODEL_INPUT_SIZE,
    )

    const { data } = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

    onFreeze({
      image: { data, width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE },
      hash: hashFrame(data),
      canvas,
    })
  }, [video, onFreeze])

  /** Explain a photo instead of a camera frame: a file of hers or a challenge photo. */
  const freezePhoto = useCallback(
    async (blob: Blob) => {
      const decoded = await decodeImage(blob)
      if (!decoded) {
        setProblem(true)
        return
      }
      setProblem(false)
      onFreeze({ image: decoded.image, hash: hashFrame(decoded.image.data), canvas: decoded.canvas })
    },
    [onFreeze],
  )

  async function freezeUrl(url: string) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(String(response.status))
      await freezePhoto(await response.blob())
    } catch {
      setProblem(true)
    }
  }

  // Mirror the frozen frame into a visible canvas. Drawn rather than shown via a
  // data URL so no copy of the frame is ever encoded into a string that could end
  // up somewhere it should not (Principle I).
  useEffect(() => {
    const display = displayRef.current
    if (!display || !frozen) return
    display.width = MODEL_INPUT_SIZE
    display.height = MODEL_INPUT_SIZE
    display.getContext('2d')?.drawImage(frozen.canvas, 0, 0)
  }, [frozen])

  return (
    <div className="flex flex-col gap-2">
      {frozen ? (
        <>
          <canvas
            ref={displayRef}
            role="img"
            aria-label={t('freeze.alt')}
            className="h-auto w-full max-w-[224px] rounded border border-blue"
            style={{ aspectRatio: '1 / 1' }}
          />
          <p aria-live="polite" className="text-sm text-ink-muted">
            {t('freeze.frozen')}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              onFreeze(null)
            }}
          >
            {t('freeze.unfreeze')}
          </Button>
        </>
      ) : (
        <>
          <Button onClick={freeze} disabled={!video} block>
            {t('freeze.action')}
          </Button>
          <p className="text-sm text-ink-muted">{t('freeze.hint')}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('freeze.photoLabel')}</span>
            <input
              type="file"
              accept="image/*"
              className="text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void freezePhoto(file)
              }}
            />
          </label>
          {testPhotos.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t('freeze.testPhotos')}</p>
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {testPhotos.map((photo) => (
                  <li key={photo.url}>
                    <button
                      type="button"
                      onClick={() => void freezeUrl(photo.url)}
                      className="flex flex-col items-center gap-1 rounded border border-border-subtle p-1 text-xs"
                    >
                      <img src={photo.url} alt="" className="h-16 w-16 rounded object-cover" />
                      {photo.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm text-magenta">
              {t('common:error.generic')}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
