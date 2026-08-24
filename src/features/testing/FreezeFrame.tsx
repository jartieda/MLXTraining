import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { MODEL_INPUT_SIZE, type ImageSource } from '@/ml/types'
import { hashFrame } from './frameHash'

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
}

export function FreezeFrame({ video, frozen, onFreeze }: FreezeFrameProps) {
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
