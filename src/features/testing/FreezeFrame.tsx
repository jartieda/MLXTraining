import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Meter } from '@/components/Meter'
import { useLab } from '@/features/lab/labStore'
import { classify, topClass, toWholePercentages } from '@/ml/predict'
import { MODEL_INPUT_SIZE, type ClassProbability, type ImageSource } from '@/ml/types'
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
  readonly source: 'camera' | 'photo' | 'test'
}

export interface FreezeFrameProps {
  readonly video: HTMLVideoElement | null
  readonly frozen: FrozenFrame | null
  readonly onFreeze: (frame: FrozenFrame | null) => void
  /** Test photos of the challenge this project came from, if any. */
  readonly testPhotos?: readonly { readonly url: string; readonly label: string }[]
}

type FrozenConfidence =
  | { readonly hash: string; readonly status: 'loading' | 'unavailable' | 'error' }
  | {
      readonly hash: string
      readonly status: 'ready'
      readonly probabilities: readonly ClassProbability[]
    }

export function FreezeFrame({ video, frozen, onFreeze, testPhotos = [] }: FreezeFrameProps) {
  const { t } = useTranslation('testing')
  const { classes, model, backbone } = useLab()
  const displayRef = useRef<HTMLCanvasElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState(false)
  const [confidence, setConfidence] = useState<FrozenConfidence | null>(null)

  useEffect(() => {
    if (!frozen) {
      setConfidence(null)
      return
    }
    if (!model || !backbone) {
      setConfidence({ hash: frozen.hash, status: 'unavailable' })
      return
    }

    let active = true
    setConfidence({ hash: frozen.hash, status: 'loading' })

    // Score the exact pixels being explained, rather than snapshotting the
    // asynchronously updated live bars.
    void classify(model, backbone, frozen.image)
      .then((probabilities) => {
        if (active) setConfidence({ hash: frozen.hash, status: 'ready', probabilities })
      })
      .catch(() => {
        if (active) setConfidence({ hash: frozen.hash, status: 'error' })
      })

    return () => {
      active = false
    }
  }, [frozen, model, backbone])

  const currentConfidence = frozen && confidence?.hash === frozen.hash ? confidence : null
  const confidenceStatus =
    currentConfidence?.status ?? (model && backbone ? 'loading' : 'unavailable')
  const probabilities =
    currentConfidence?.status === 'ready' ? currentConfidence.probabilities : []
  const percentages = toWholePercentages(probabilities)
  const leader = topClass(probabilities)

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
      source: 'camera',
    })
  }, [video, onFreeze])

  /** Explain a photo instead of a camera frame: a file of hers or a challenge photo. */
  const freezePhoto = useCallback(
    async (blob: Blob, source: 'photo' | 'test') => {
      const decoded = await decodeImage(blob)
      if (!decoded) {
        setProblem(true)
        return
      }
      setProblem(false)
      onFreeze({
        image: decoded.image,
        hash: hashFrame(decoded.image.data),
        canvas: decoded.canvas,
        source,
      })
    },
    [onFreeze],
  )

  async function freezeUrl(url: string) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(String(response.status))
      await freezePhoto(await response.blob(), 'test')
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

  const photoChoices = (
    <>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void freezePhoto(file, 'photo')
        }}
      />
      <Button
        variant="secondary"
        block
        onClick={() => {
          photoInputRef.current?.click()
        }}
      >
        {t('freeze.photoLabel')}
      </Button>
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
    </>
  )

  return (
    <div className="flex flex-col gap-2">
      {frozen ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,224px)_minmax(0,1fr)] sm:items-start">
          <div className="flex flex-col items-start gap-2">
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
            {frozen.source === 'camera' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onFreeze(null)
                }}
              >
                {t('freeze.unfreeze')}
              </Button>
            ) : null}
            <div className="flex w-full flex-col gap-3 pt-2">{photoChoices}</div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('freeze.confidenceHeading')}</h3>
            {confidenceStatus === 'loading' ? (
              <p className="text-sm text-ink-muted">{t('freeze.confidenceLoading')}</p>
            ) : null}
            {confidenceStatus === 'unavailable' ? (
              <p className="text-sm text-ink-muted">{t('freeze.confidenceUnavailable')}</p>
            ) : null}
            {confidenceStatus === 'error' ? (
              <p role="alert" className="text-sm text-magenta">
                {t('freeze.confidenceError')}
              </p>
            ) : null}
            {confidenceStatus === 'ready' ? (
              <>
                <div className="flex flex-col gap-2">
                  {classes.map((klass, index) => (
                    <Meter
                      key={klass.id}
                      label={klass.name}
                      value={probabilities[index]?.probability ?? 0}
                      valueText={`${String(percentages[index] ?? 0)}%`}
                      tone={leader?.classIndex === index ? 'leading' : 'neutral'}
                    />
                  ))}
                </div>
                <p className="text-sm text-ink-muted">{t('confidence.sumNote')}</p>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <Button onClick={freeze} disabled={!video} block>
            {t('freeze.action')}
          </Button>
          <p className="text-sm text-ink-muted">{t('freeze.hint')}</p>
          {photoChoices}
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
