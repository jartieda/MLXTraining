import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { useLab } from '@/features/lab/labStore'
import * as db from '@/lib/db'
import { MODEL_INPUT_SIZE, type ImageSource } from '@/ml/types'

/**
 * T043 / FR-003 — photos already on the device, as a first-class sample source.
 *
 * Not a fallback bolted on for the camera-less case. A learner working from a
 * borrowed desktop, or one whose school blocks camera access, gets the same lab
 * through this path — and Scenario 1.4's failure states all point here, so it has
 * to be as complete as the camera.
 *
 * This is the **other** DOM-to-ML boundary (the camera being the first). A decoded
 * file becomes an `ImageSource` here and nowhere else; `src/ml/` never sees a
 * `File`, a `Blob` or an `ImageBitmap`, which is what keeps the whole core
 * testable in node (Principle VI).
 *
 * Files are processed one at a time on purpose. Decoding and embedding forty
 * photos concurrently exhausts memory on a mid-range phone, and there is nothing
 * to gain: the backbone is the bottleneck either way, and sequential work is what
 * lets the progress count mean something.
 */

interface Outcome {
  readonly added: number
  readonly rejected: number
  readonly failed: number
  readonly className: string
}

export function UploadSamples() {
  const { t } = useTranslation('capture')
  const { projectId, project, classes, selectedClassId, backbone, refreshClasses } = useLab()

  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [quotaStopped, setQuotaStopped] = useState<number | null>(null)
  const [notReady, setNotReady] = useState(false)

  const selectedClass = classes.find((klass) => klass.id === selectedClassId) ?? null
  const ready = projectId !== null && project !== null && selectedClass !== null && backbone !== null

  /**
   * Decodes one file to a centre-cropped 224×224 `ImageSource` plus a re-encoded
   * JPEG.
   *
   * The crop is a **centre crop, not a squash** — the same rule the camera path
   * follows, and for the same reason. Squashing a 4:3 photo into a square distorts
   * every subject consistently enough that the model learns the distortion, and a
   * learner's model then fails on an undistorted photograph of the same object
   * with nothing on screen to explain why.
   *
   * The upload is also re-encoded rather than stored as-is: a 4 MB phone
   * photograph holds nothing the model can use beyond 224 px, and storing forty of
   * them would exhaust a learner's quota within one lesson (R10).
   */
  async function decode(file: File): Promise<{ image: ImageSource; blob: Blob } | null> {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      return null
    }

    try {
      canvasRef.current ??= document.createElement('canvas')
      const canvas = canvasRef.current
      canvas.width = MODEL_INPUT_SIZE
      canvas.height = MODEL_INPUT_SIZE

      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return null

      const side = Math.min(bitmap.width, bitmap.height)
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        MODEL_INPUT_SIZE,
        MODEL_INPUT_SIZE,
      )

      const { data } = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      })
      if (!blob) return null

      return { image: { data, width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE }, blob }
    } finally {
      // `createImageBitmap` allocates outside the JS heap, so the garbage
      // collector will not reclaim it on its own schedule. Forty un-closed
      // bitmaps of a modern phone photo is a few hundred megabytes.
      bitmap.close()
    }
  }

  async function handleFiles(files: readonly File[]) {
    // A silent return here reads as "nothing happened", which is the least
    // debuggable failure an interface can have. The most likely cause by far is
    // that the backbone has not finished loading, and that is worth naming.
    if (!ready || !projectId || !project || !selectedClass || !backbone) {
      setNotReady(true)
      return
    }
    setNotReady(false)

    const estimate = await db.estimateStorage()
    if (estimate.shouldRefuse) {
      setQuotaStopped(0)
      return
    }

    const images = files.filter((file) => file.type.startsWith('image/'))
    const rejected = files.length - images.length

    setOutcome(null)
    setQuotaStopped(null)
    setProgress({ done: 0, total: images.length })

    let added = 0
    let failed = 0
    let hitQuota = false

    for (const [index, file] of images.entries()) {
      const decoded = await decode(file)
      if (!decoded) {
        failed++
        setProgress({ done: index + 1, total: images.length })
        continue
      }

      const embedding = await backbone.embed(decoded.image)
      const result = await db.addSampleBurst([
        {
          projectId,
          classId: selectedClass.id,
          image: decoded.blob,
          // D4: the pooled embedding is computed here, at the same boundary the
          // camera computes it, so training never runs the backbone (R2).
          embedding,
          embeddingAlpha: project.backboneAlpha,
          source: 'upload',
        },
      ])

      if (result.stoppedByQuota) {
        hitQuota = true
        break
      }

      added += result.saved
      setProgress({ done: index + 1, total: images.length })
    }

    setProgress(null)
    await refreshClasses()

    if (hitQuota) setQuotaStopped(added)
    else setOutcome({ added, rejected, failed, className: selectedClass.name })

    // Cleared so choosing the same files again re-fires `change`; without this a
    // learner who retries after making room appears to be ignored.
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{t('upload.heading')}</h3>
      <p className="text-sm text-ink-muted">{t('upload.hint')}</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        // Visually hidden and removed from the accessibility tree, because the
        // Button below is the control (T113).
        //
        // This input used to be `sr-only` and focusable with a comment claiming it
        // was labelled, which it was not — axe found it. Labelling it was the wrong
        // repair: it then presented as a SECOND "Choose photos" control, so a
        // screen-reader user tabbed past two things that did one job, and every e2e
        // locator for the button became ambiguous. A bare file input cannot be
        // styled to the token system, so the input stays and the button drives it —
        // and only one of the two is a control.
        className="sr-only"
        id="upload-samples-input"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          void handleFiles([...(event.target.files ?? [])])
        }}
      />

      <Button
        variant="secondary"
        disabled={!ready || progress !== null}
        block
        onClick={() => {
          inputRef.current?.click()
        }}
      >
        {t('upload.choose')}
      </Button>

      {!selectedClass ? (
        <p role="alert" className="text-sm text-magenta">
          {t('classes.selectFirst')}
        </p>
      ) : null}

      {notReady && selectedClass ? (
        <p role="alert" className="text-sm text-orange">
          {t('common:backend.checking')}
        </p>
      ) : null}

      <p aria-live="polite" className="text-sm text-ink-muted">
        {progress ? t('upload.reading', { done: progress.done, total: progress.total }) : null}
        {outcome ? t('upload.added', { count: outcome.added, name: outcome.className }) : null}
        {quotaStopped !== null
          ? quotaStopped === 0
            ? t('quota.refused')
            : t('quota.burstStopped', { count: quotaStopped })
          : null}
      </p>

      {/* Reported separately rather than folded into the success line: a learner
          who selected twelve files and got nine photos needs to know the other
          three were a screenshot, a PDF and a HEIC this browser cannot decode. */}
      {outcome && outcome.rejected > 0 ? (
        <p className="text-sm text-orange">{t('upload.rejected', { count: outcome.rejected })}</p>
      ) : null}
      {outcome && outcome.failed > 0 ? (
        <p className="text-sm text-orange">{t('upload.failed', { count: outcome.failed })}</p>
      ) : null}
    </div>
  )
}
