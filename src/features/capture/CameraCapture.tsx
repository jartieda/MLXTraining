import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { useLab } from '@/features/lab/labStore'
import {
  CameraError,
  canvasToJpeg,
  frameToImageSource,
  listCameras,
  startCamera,
  switchCamera,
  waitForFrame,
  type ActiveCamera,
  type CameraDevice,
  type CameraErrorKind,
} from '@/lib/camera'
import * as db from '@/lib/db'

/**
 * T042, T047 / FR-002, FR-005, D4, D7, Scenario 1.4.
 *
 * Three things here are load-bearing.
 *
 * **The pooled embedding is computed AT CAPTURE TIME** (D4, R2). This is the
 * decision that makes SC-002's 30-second training budget comfortable rather than
 * tight: pressing Train then fits a small head over cached vectors instead of
 * running the backbone over every photo. It also means capture is the expensive
 * operation, which is why the burst is throttled and reports progress.
 *
 * **A quota error stops the burst and keeps what was written** (D7). Losing
 * captured photos silently is the worst failure this product has, so the burst
 * goes through `addSampleBurst`, which commits each photo on its own, and the
 * message states exactly how many were saved.
 *
 * **Every hardware and permission failure is a named state with a remedy**
 * (Scenario 1.4). "Camera unavailable" tells a learner nothing; "another app is
 * using the camera" tells her what to close. Each one also offers the upload
 * path, because the lab is fully usable without a camera at all (FR-003).
 */

/** Five frames a second while held. Fast enough to feel continuous, slow enough
 *  that each frame's backbone pass and IndexedDB write keep up on a phone. */
const BURST_INTERVAL_MS = 200

type Notice =
  | { readonly kind: 'saved'; readonly count: number; readonly className: string }
  | { readonly kind: 'quota'; readonly count: number }
  | { readonly kind: 'refused' }

export interface CameraCaptureProps {
  /**
   * Owned by the lab page rather than by this component, because the live
   * prediction panel (T046) and the freeze-frame control (T055) sample the same
   * element. Two `<video>` elements bound to one `MediaStream` would double the
   * decode cost for no benefit, and on a phone that is the difference between a
   * smooth preview and a stuttering one.
   */
  readonly videoRef: React.RefObject<HTMLVideoElement | null>
  /** Lets the lab page enable the panels that need a live frame. */
  readonly onActiveChange?: (active: boolean) => void
}

export function CameraCapture({ videoRef, onActiveChange }: CameraCaptureProps) {
  const { t } = useTranslation('capture')
  const {
    projectId,
    project,
    classes,
    selectedClassId,
    backbone,
    backboneLoading,
    refreshClasses,
  } = useLab()

  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const cameraRef = useRef<ActiveCamera | null>(null)
  const burstRef = useRef<{ stop: boolean; count: number }>({ stop: false, count: 0 })

  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<CameraErrorKind | null>(null)
  const [devices, setDevices] = useState<readonly CameraDevice[]>([])
  const [bursting, setBursting] = useState(false)
  const [burstCount, setBurstCount] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)

  const selectedClass = classes.find((klass) => klass.id === selectedClassId) ?? null

  const stop = useCallback(() => {
    burstRef.current.stop = true
    cameraRef.current?.stop()
    cameraRef.current = null
    setActive(false)
    setBursting(false)
  }, [])

  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  // Released on unmount without exception. A stream left running keeps the camera
  // light on after a learner has navigated away, which reads as the lab watching
  // her — and is the single most alarming bug this feature could ship with.
  useEffect(() => stop, [stop])

  async function start(deviceId?: string) {
    setStarting(true)
    setFailure(null)
    try {
      const camera = await startCamera(deviceId === undefined ? {} : { deviceId })
      cameraRef.current?.stop()
      cameraRef.current = camera

      const video = videoRef.current
      if (video) {
        video.srcObject = camera.stream
        await video.play().catch(() => undefined)
        await waitForFrame(video)
      }

      setActive(true)
      // Labels are withheld until permission has been granted at least once, so
      // the device list is only worth reading after a successful start.
      setDevices(await listCameras())
    } catch (error) {
      setFailure(error instanceof CameraError ? error.kind : 'unknown')
      setActive(false)
    } finally {
      setStarting(false)
    }
  }

  async function flip() {
    const camera = cameraRef.current
    if (!camera) return
    setStarting(true)
    try {
      const replacement = await switchCamera(camera)
      cameraRef.current = replacement
      const video = videoRef.current
      if (video) {
        video.srcObject = replacement.stream
        await video.play().catch(() => undefined)
        await waitForFrame(video)
      }
      // Scenario 8.2: already-captured photos are untouched by a camera switch.
      // Nothing here reads or writes a sample, which is the guarantee.
    } catch (error) {
      setFailure(error instanceof CameraError ? error.kind : 'unknown')
    } finally {
      setStarting(false)
    }
  }

  /** One frame → an ImageSource, a JPEG blob, and a pooled embedding (D4). */
  async function buildSample(): Promise<db.NewSample | null> {
    const video = videoRef.current
    if (!video || !projectId || !selectedClassId || !backbone || !project) return null

    scratchRef.current ??= document.createElement('canvas')
    const canvas = scratchRef.current

    // The DOM-to-ML boundary. `frameToImageSource` centre-crops and scales to
    // 224; nothing inside src/ml/ ever sees a video element (Principle VI).
    const image = frameToImageSource(video, canvas)
    const [blob, embedding] = await Promise.all([canvasToJpeg(canvas), backbone.embed(image)])

    return {
      projectId,
      classId: selectedClassId,
      image: blob,
      embedding,
      embeddingAlpha: project.backboneAlpha,
      source: 'camera',
    }
  }

  async function captureOne() {
    if (!selectedClass) return

    const estimate = await db.estimateStorage()
    if (estimate.shouldRefuse) {
      setNotice({ kind: 'refused' })
      return
    }

    const sample = await buildSample()
    if (!sample) return

    const result = await db.addSampleBurst([sample])
    await refreshClasses()
    setNotice(
      result.stoppedByQuota
        ? { kind: 'quota', count: result.saved }
        : { kind: 'saved', count: result.saved, className: selectedClass.name },
    )
  }

  /**
   * Press-and-hold burst (FR-002).
   *
   * Frames are captured one at a time in sequence rather than queued up: each one
   * costs a backbone pass, and letting a phone accumulate a backlog of undecoded
   * frames is how the preview freezes while the counter races ahead of what is
   * actually saved.
   */
  async function startBurst() {
    if (!selectedClass || bursting) return

    const estimate = await db.estimateStorage()
    if (estimate.shouldRefuse) {
      setNotice({ kind: 'refused' })
      return
    }

    burstRef.current = { stop: false, count: 0 }
    setBursting(true)
    setBurstCount(0)
    setNotice(null)

    let saved = 0
    let hitQuota = false

    while (!burstRef.current.stop) {
      const started = Date.now()
      const sample = await buildSample()
      if (!sample) break

      const result = await db.addSampleBurst([sample])
      if (result.stoppedByQuota) {
        hitQuota = true
        break
      }

      saved += result.saved
      setBurstCount(saved)

      const remaining = BURST_INTERVAL_MS - (Date.now() - started)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
    }

    setBursting(false)
    await refreshClasses()
    setNotice(
      hitQuota
        ? { kind: 'quota', count: saved }
        : { kind: 'saved', count: saved, className: selectedClass.name },
    )
  }

  function endBurst() {
    burstRef.current.stop = true
  }

  const canCapture = active && selectedClass !== null && backbone !== null && !backboneLoading

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{t('camera.heading')}</h3>

      {failure ? <CameraFailure kind={failure} onRetry={() => void start()} /> : null}

      <div className="relative overflow-hidden rounded border border-border-subtle bg-navy">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={t('camera.preview')}
          className="aspect-square w-full object-cover"
        />
        {!active ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="px-4 text-center text-sm text-ink-inverse">
              {starting ? t('camera.starting') : ''}
            </p>
          </div>
        ) : null}
      </div>

      {!active ? (
        <Button onClick={() => void start()} busy={starting} block>
          {t('camera.start')}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          {selectedClass ? (
            <p className="text-sm text-ink-muted">
              {t('classes.selected', { name: selectedClass.name })}
            </p>
          ) : (
            <p role="alert" className="text-sm text-magenta">
              {t('classes.selectFirst')}
            </p>
          )}

          <Button onClick={() => void captureOne()} disabled={!canCapture} block>
            {t('camera.capture')}
          </Button>

          <Button
            variant="secondary"
            disabled={!canCapture}
            block
            // Pointer events, not mouse events: the same handler then serves a
            // finger, a stylus and a mouse, which is what FR-045 and Scenario 8.4
            // both need. `onPointerLeave` and `onPointerCancel` matter as much as
            // `onPointerUp` — a finger sliding off the button must end the burst,
            // not leave it running invisibly.
            onPointerDown={() => void startBurst()}
            onPointerUp={endBurst}
            onPointerLeave={endBurst}
            onPointerCancel={endBurst}
            // Keyboard equivalent, because press-and-hold has none. Space or Enter
            // starts, and a second press stops (SC-009, FR-046).
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                if (bursting) endBurst()
                else void startBurst()
              }
            }}
          >
            {bursting ? t('camera.capturing', { count: burstCount }) : t('camera.burst')}
          </Button>

          <p className="text-sm text-ink-muted">{t('camera.burstHint')}</p>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void flip()} busy={starting}>
              {t('camera.switch')}
            </Button>
            <Button variant="ghost" onClick={stop}>
              {t('camera.stop')}
            </Button>
          </div>

          {devices.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">{t('camera.chooseDevice')}</span>
              <select
                onChange={(event) => void start(event.target.value)}
                className="min-h-touch rounded border border-border-subtle bg-surface px-2"
              >
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {/* Labels are empty before permission is granted, so a fallback
                        is required rather than optional — otherwise the picker
                        renders as a list of blank options. */}
                    {device.label || t('camera.deviceFallback', { index: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      )}

      {/* aria-live: a learner using a screen reader gets no feedback from a
          thumbnail appearing, so the count has to be announced. */}
      <p aria-live="polite" className="text-sm text-ink-muted">
        {notice?.kind === 'saved'
          ? t('camera.captured', { count: notice.count, name: notice.className })
          : null}
        {notice?.kind === 'quota' ? t('quota.burstStopped', { count: notice.count }) : null}
        {notice?.kind === 'refused' ? t('quota.refused') : null}
      </p>
    </div>
  )
}

/**
 * T047 / Scenario 1.4 — each failure named, with its own remedy.
 *
 * Every branch offers the upload path, because the lab genuinely works without a
 * camera (FR-003) and a dead end here would end a lesson for a learner on a
 * borrowed desktop.
 */
function CameraFailure({
  kind,
  onRetry,
}: {
  readonly kind: CameraErrorKind
  readonly onRetry: () => void
}) {
  const { t } = useTranslation('capture')

  const key =
    kind === 'permission-denied'
      ? 'denied'
      : kind === 'no-device'
        ? 'noDevice'
        : kind === 'in-use'
          ? 'inUse'
          : kind === 'insecure-context'
            ? 'insecure'
            : 'unsupported'

  return (
    <div role="alert" className="flex flex-col gap-2 rounded border border-orange bg-surface p-3">
      <h4 className="font-semibold">{t(`permission.${key}Title`)}</h4>
      <p className="text-sm">{t(`permission.${key}Body`)}</p>
      {/* Retrying is pointless where there is no camera or no secure context, so
          the button only appears where it could actually help. */}
      {kind === 'permission-denied' || kind === 'in-use' ? (
        <Button variant="secondary" onClick={onRetry}>
          {t('permission.tryAgain')}
        </Button>
      ) : null}
    </div>
  )
}
