import type { ImageSource } from '@/ml/types'
import { MODEL_INPUT_SIZE } from '@/ml/types'

/**
 * T035 / FR-005, Scenario 1.4 — the camera.
 *
 * This module is the **boundary** where a DOM type becomes an `ImageSource`. That
 * conversion happens here and in the upload path (T043), and nowhere inside
 * `src/ml/`, which is what lets the whole ML core be tested in a node environment
 * (Principle VI, enforced by the import-boundary lint rule).
 *
 * Every failure mode is a named state rather than a thrown error, because
 * Scenario 1.4 requires the interface to explain the cause and offer the upload
 * path instead. "Camera unavailable" is useless to a learner; "another app is
 * using the camera" tells her what to do.
 */

export type CameraFacing = 'user' | 'environment'

export type CameraErrorKind =
  /** She said no, or the browser remembered a previous no. */
  | 'permission-denied'
  /** No camera on the device at all — a desktop without a webcam. */
  | 'no-device'
  /** A camera exists but something else holds it. Common on shared laptops. */
  | 'in-use'
  /** getUserMedia needs a secure context; an http:// origin has none. */
  | 'insecure-context'
  /** The browser has no getUserMedia — an old in-app webview. */
  | 'unsupported'
  | 'unknown'

export class CameraError extends Error {
  readonly kind: CameraErrorKind

  constructor(kind: CameraErrorKind, message: string) {
    super(message)
    this.name = 'CameraError'
    this.kind = kind
  }
}

export interface CameraDevice {
  readonly deviceId: string
  /** Empty until permission is granted — browsers withhold labels before that. */
  readonly label: string
}

export interface ActiveCamera {
  readonly stream: MediaStream
  readonly facing: CameraFacing
  readonly deviceId: string | null
  stop(): void
}

/**
 * Requested at 640×480 rather than the highest available.
 *
 * Every frame is downscaled to 224×224 before the backbone sees it, so a 4K
 * capture discards almost all of its own pixels — while costing a low-end
 * Chromebook real time per frame in the 10 fps live loop, and real battery on a
 * phone. 640×480 is comfortably above what 224×224 needs after a centre crop.
 */
const IDEAL_WIDTH = 640
const IDEAL_HEIGHT = 480

export function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined
}

function classify(error: unknown): CameraError {
  if (!(error instanceof Error)) {
    return new CameraError('unknown', 'The camera could not be started.')
  }

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'permission-denied',
        'This page is not allowed to use the camera. You can allow it in your browser settings, or upload photos instead.',
      )
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError(
        'no-device',
        'No camera was found on this device. You can upload photos instead.',
      )
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError(
        'in-use',
        'The camera is busy — another app or tab may be using it. Close that and try again, or upload photos instead.',
      )
    default:
      return new CameraError('unknown', 'The camera could not be started. You can upload photos instead.')
  }
}

/**
 * Starts a camera stream.
 *
 * `facing` is a *preference*, not a requirement: it is requested with `ideal`
 * rather than `exact` so that a laptop with only a front camera still starts
 * when the lab asks for a rear one, instead of failing with an
 * `OverconstrainedError` that reads to a learner as "no camera".
 */
export async function startCamera(
  options: { facing?: CameraFacing; deviceId?: string } = {},
): Promise<ActiveCamera> {
  if (!isCameraSupported()) {
    // Distinguished from a permission refusal because the remedy is different:
    // there is nothing she can allow, and an http:// origin is a deployment bug
    // rather than anything she did.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new CameraError(
        'insecure-context',
        'The camera only works over a secure connection (https). You can upload photos instead.',
      )
    }
    throw new CameraError(
      'unsupported',
      'This browser cannot use the camera. You can upload photos instead.',
    )
  }

  const facing = options.facing ?? 'environment'

  const video: MediaTrackConstraints = {
    width: { ideal: IDEAL_WIDTH },
    height: { ideal: IDEAL_HEIGHT },
    ...(options.deviceId === undefined
      ? { facingMode: { ideal: facing } }
      : { deviceId: { exact: options.deviceId } }),
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
  } catch (error) {
    throw classify(error)
  }

  const track = stream.getVideoTracks()[0]
  const settings = track?.getSettings()

  return {
    stream,
    facing: settings?.facingMode === 'user' ? 'user' : facing,
    deviceId: settings?.deviceId ?? null,
    stop: () => {
      // Every track, not just the first. A stream with one track left running
      // keeps the camera light on, which reads to a learner as the lab spying on
      // her after she has moved on.
      for (const active of stream.getTracks()) active.stop()
    },
  }
}

/**
 * Lists the cameras.
 *
 * Labels are empty until permission has been granted at least once — browsers
 * withhold them to prevent fingerprinting — so the interface must fall back to
 * "Camera 1", "Camera 2" rather than rendering blank options.
 */
export async function listCameras(): Promise<CameraDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }))
  } catch {
    return []
  }
}

/**
 * Switches to the other facing while preserving already-captured samples
 * (FR-005, Scenario 8.2).
 *
 * The old stream is stopped only after the new one starts. Stopping first would
 * leave a black preview if the new camera then failed — and on a phone, failing
 * to reacquire after releasing is a real possibility.
 */
export async function switchCamera(current: ActiveCamera): Promise<ActiveCamera> {
  const next = current.facing === 'user' ? 'environment' : 'user'
  const replacement = await startCamera({ facing: next })
  current.stop()
  return replacement
}

/**
 * Converts a video frame into an `ImageSource` — the DOM-to-ML boundary.
 *
 * The frame is **centre-cropped to a square** before being scaled to 224×224.
 * Squashing a 4:3 frame into a square instead would distort every subject, and
 * would do so consistently enough that the model would learn the distortion —
 * a learner's model would then fail on an undistorted photograph of the same
 * object, with nothing on screen to suggest why.
 */
export function frameToImageSource(
  video: HTMLVideoElement,
  scratch?: HTMLCanvasElement,
): ImageSource {
  const width = video.videoWidth
  const height = video.videoHeight
  if (width === 0 || height === 0) {
    throw new CameraError('unknown', 'The camera has not produced a frame yet.')
  }

  const canvas = scratch ?? document.createElement('canvas')
  canvas.width = MODEL_INPUT_SIZE
  canvas.height = MODEL_INPUT_SIZE

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new CameraError('unknown', 'This browser cannot read from the camera preview.')

  const side = Math.min(width, height)
  const sourceX = (width - side) / 2
  const sourceY = (height - side) / 2

  context.drawImage(video, sourceX, sourceY, side, side, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
  const { data } = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

  return { data, width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE }
}

/**
 * Encodes the current 224×224 canvas contents as a JPEG blob for storage.
 *
 * Quality 0.8 at 224×224 is about 15 KB (R10), which keeps a 100-sample project
 * near 1.7 MB. Storing at the model's own input resolution means nothing is
 * discarded that the model could have used, and nothing is kept that it cannot.
 */
export async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new CameraError('unknown', 'The captured frame could not be saved.'))
      },
      'image/jpeg',
      quality,
    )
  })
}

/** Waits until the element has a decoded frame, so the first capture is not blank. */
export async function waitForFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('loadeddata', done)
      resolve()
    }
    video.addEventListener('loadeddata', done, { once: true })
  })
}
