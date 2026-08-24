import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Meter } from '@/components/Meter'
import { useLab } from '@/features/lab/labStore'
import { topClass, toWholePercentages } from '@/ml/predict'
import { MODEL_INPUT_SIZE, type ClassProbability, type ImageSource } from '@/ml/types'

/**
 * T046 / FR-011, R8 — live prediction.
 *
 * **Ten frames a second, on a timer, not `requestAnimationFrame`.** This is the
 * single most important decision in the file. A webcam loop is the classic
 * TensorFlow.js leak: at 60 fps a handful of undisposed tensors per frame
 * exhausts GPU memory within a minute and the tab dies — and it dies as "the lab
 * froze", which nobody traces back to a missing `tf.tidy`. Throttling to 10 fps
 * is also the better product: it is well above the rate at which a prediction
 * display reads as live, and it cuts backbone work by six times on the low-end
 * Chromebook that most needs the relief (R8).
 *
 * The loop is also **self-chaining rather than interval-driven**. `setInterval`
 * would queue a new frame while the previous backbone pass is still running, and
 * on a slow device that backlog grows without bound until the preview stalls
 * behind a counter that has raced ahead of it.
 *
 * `toWholePercentages` handles the display arithmetic: the bars a learner reads
 * always sum to 100. Rounding each value independently gives 33/33/33, and a
 * learner who notices that the numbers do not add up has been given a reason to
 * distrust everything else the lab tells her.
 */

const TARGET_FPS = 10
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS

/** Two classes within this of each other are not really being distinguished. */
const CLOSE_CALL_MARGIN = 0.1

export interface LivePredictionProps {
  /** The live preview to sample. `null` while the camera is off. */
  readonly video: HTMLVideoElement | null
}

export function LivePrediction({ video }: LivePredictionProps) {
  const { t } = useTranslation('testing')
  const { classes, model, backbone } = useLab()

  const [running, setRunning] = useState(false)
  const [probabilities, setProbabilities] = useState<readonly ClassProbability[]>([])

  const runningRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /**
   * One long-lived RGBA buffer for the ML boundary.
   *
   * `getImageData` allocates a fresh array per call and there is no 2D-canvas API
   * that reads into an existing one, so its result is copied into this buffer and
   * released. At 224×224 that is 200 KB per frame; at 10 fps, holding one buffer
   * instead of shedding 2 MB a second of garbage is the difference between a
   * steady loop and periodic collection pauses on a phone.
   */
  const bufferRef = useRef<Uint8ClampedArray | null>(null)

  const canRun = model !== null && backbone !== null && video !== null

  const stop = useCallback(() => {
    runningRef.current = false
    setRunning(false)
  }, [])

  // Stopped on unmount without exception, and also whenever the model or the
  // camera goes away. A loop left running against a disposed model reads freed
  // tensors, which is a crash rather than a wrong answer.
  useEffect(() => stop, [stop])
  useEffect(() => {
    if (!canRun) stop()
  }, [canRun, stop])

  function grabFrame(): ImageSource | null {
    if (!video || video.videoWidth === 0) return null

    canvasRef.current ??= document.createElement('canvas')
    const canvas = canvasRef.current
    canvas.width = MODEL_INPUT_SIZE
    canvas.height = MODEL_INPUT_SIZE

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null

    // The same centre crop the capture path uses. If the live view squashed while
    // capture cropped, the model would be tested on a different transform than it
    // was trained on — and would appear simply worse, with nothing to explain it.
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

    const fresh = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data
    bufferRef.current ??= new Uint8ClampedArray(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 4)
    bufferRef.current.set(fresh)

    return { data: bufferRef.current, width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE }
  }

  async function loop() {
    while (runningRef.current) {
      const startedAt = performance.now()

      const frame = grabFrame()
      const currentModel = useLab.getState().model
      const currentBackbone = useLab.getState().backbone

      if (!frame || !currentModel || !currentBackbone) break

      try {
        const embedding = await currentBackbone.embed(frame)
        if (!runningRef.current) break
        setProbabilities(currentModel.predictFromEmbedding(embedding))
      } catch {
        // A single failed frame is not worth stopping for — a mid-loop camera
        // hiccup would otherwise end the session. A model that has genuinely gone
        // away is caught by the guard above.
        break
      }

      // Self-chaining: the next frame is scheduled only once this one is done, so
      // a slow device runs at whatever rate it can manage rather than building a
      // backlog it will never clear.
      const remaining = FRAME_INTERVAL_MS - (performance.now() - startedAt)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
    }

    runningRef.current = false
    setRunning(false)
  }

  function start() {
    if (!canRun || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    void loop()
  }

  const percentages = toWholePercentages(probabilities)
  const leader = topClass(probabilities)
  const sorted = [...probabilities].sort((a, b) => b.probability - a.probability)
  const isClose =
    sorted.length > 1 &&
    (sorted[0]?.probability ?? 0) - (sorted[1]?.probability ?? 0) < CLOSE_CALL_MARGIN

  return (
    <div className="flex flex-col gap-3">
      {/* Heading and intro come from LabPage; see the note in TrainPanel. */}
      {!model ? (
        <p className="text-sm text-ink-muted">{t('notTrained')}</p>
      ) : !video ? (
        <p className="text-sm text-ink-muted">{t('noCamera')}</p>
      ) : (
        <>
          <Button
            onClick={() => {
              if (running) stop()
              else start()
            }}
            block
          >
            {running ? t('stop') : t('start')}
          </Button>

          {/* The headline reading, announced. A screen-reader user gets nothing
              from the bars moving, so the leading class and its confidence are the
              only route to the result — and `polite` rather than `assertive`
              because ten updates a second must never interrupt her. */}
          <p aria-live="polite" className="text-lg font-semibold">
            {leader && classes[leader.classIndex]
              ? t('leadingConfidence', {
                  name: classes[leader.classIndex]?.name ?? '',
                  percent: percentages[leader.classIndex] ?? 0,
                })
              : running
                ? t('live')
                : t('paused')}
          </p>

          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">{t('confidence.heading')}</h4>
            {/* Every class, always — including the ones near zero. FR-011 asks for
                each class's confidence, and a filtered list would also break the
                index alignment between a bar and its class name. */}
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

          {/* Principle III in one sentence. The model never abstains, and a
              learner who does not know that will read a confident answer about an
              object she never trained on as the model recognising it. */}
          <p className="text-sm text-ink-muted">{t('confidence.sumNote')}</p>

          {isClose && sorted[0] && sorted[1] ? (
            <p className="text-sm text-orange">
              {t('close', {
                first: classes[sorted[0].classIndex]?.name ?? '',
                second: classes[sorted[1].classIndex]?.name ?? '',
              })}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
