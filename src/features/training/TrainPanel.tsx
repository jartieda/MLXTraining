import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { useLab, trainReadiness, DEFAULT_SETTINGS } from '@/features/lab/labStore'
import { useOwnerId } from '@/features/auth/session'
import { recordTrainingRun } from './remoteRuns'
import * as db from '@/lib/db'
import { trainClassifier } from '@/ml/train'
import { evaluate } from '@/ml/metrics'
import { isMlError } from '@/ml/types'

/**
 * T045, T048 / FR-007, FR-008, FR-050, D5, Scenario 1.3.
 *
 * The refusal messages are the point of this component as much as the Train
 * button is. Acceptance Scenario 1.3 requires an empty class to be **named**,
 * because a learner facing four classes and the words "not enough data" has to
 * open each one to find out which — the difference between a refusal she can act
 * on and one she reads as the lab being broken.
 *
 * FR-008 caps the settings at **three**, each with a default and a plain-language
 * explanation. That cap erodes by accident: every extra knob is individually
 * defensible, and a learner who can change fifteen hyperparameters has been taught
 * that machine learning is a control panel rather than a thing that learns from
 * examples. T038 asserts the count so the erosion is a red build.
 */

export function TrainPanel() {
  const { t } = useTranslation('training')
  const {
    projectId,
    project,
    classes,
    sampleCounts,
    settings,
    progress,
    backend,
    model,
    updateSettings,
    setModel,
    setEvaluation,
    setProgress,
    resetProgress,
  } = useLab()

  const ownerId = useOwnerId()
  const abortRef = useRef<AbortController | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [interrupted, setInterrupted] = useState<readonly db.ModelRecord[]>([])

  const readiness = trainReadiness(classes, sampleCounts)
  const isTraining = progress.phase === 'preparing' || progress.phase === 'training'

  /**
   * T048 / D5 / FR-050 — runs left mid-training by an interrupted session.
   *
   * Reported rather than silently cleaned up. A learner whose tab closed during
   * training should be told what happened, because otherwise the model she
   * expects to exist simply is not there, and the lab looks like it lost her work.
   */
  useEffect(() => {
    if (!projectId) return
    let live = true
    void db.listStaleTrainingModels().then((stale) => {
      if (live) setInterrupted(stale.filter((record) => record.projectId === projectId))
    })
    return () => {
      live = false
    }
  }, [projectId, progress.phase])

  function describeFailure(error: unknown): string {
    if (isMlError(error)) {
      switch (error.code) {
        case 'TOO_FEW_CLASSES':
          return t('refuse.needTwoClasses')
        case 'EMPTY_CLASS': {
          const index = Number(error.details.classIndex ?? -1)
          const name = classes[index]?.name ?? ''
          return t('refuse.emptyClass', { name })
        }
        default:
          break
      }
    }
    return t('common:error.generic')
  }

  async function train() {
    if (!projectId || !project || !readiness.ready) return

    const controller = new AbortController()
    abortRef.current = controller
    setFailure(null)
    setProgress({ phase: 'preparing', epoch: 0, totalEpochs: settings.epochs, elapsedMs: null })

    const startedAt = performance.now()
    // Generated up front so the local `models` record and the remote
    // `training_runs` row share one id (data-model.md).
    const runId = crypto.randomUUID()

    try {
      const samples = await db.listSamples(projectId)
      const classOrder = classes.map((klass) => klass.id)
      const indexByClass = new Map(classOrder.map((id, index) => [id, index]))

      // Only samples whose embedding matches the project's current backbone. A
      // stale one is not silently mixed in — that would train a model on features
      // from two different extractors, which produces a plausible-looking model
      // that predicts nonsense (D4).
      const usable = samples.filter(
        (sample) => sample.embedding !== null && sample.embeddingAlpha === project.backboneAlpha,
      )

      const embeddingSize = usable[0]?.embedding?.length ?? 0
      if (embeddingSize === 0) {
        setProgress({ phase: 'failed' })
        setFailure(t('common:error.generic'))
        return
      }

      const embeddings = new Float32Array(usable.length * embeddingSize)
      const labels = new Uint8Array(usable.length)
      usable.forEach((sample, row) => {
        if (sample.embedding) embeddings.set(sample.embedding, row * embeddingSize)
        labels[row] = indexByClass.get(sample.classId) ?? 0
      })

      // Recorded as `training` BEFORE the run starts. That is what makes D5's
      // recovery possible at all: a record written only on success leaves an
      // interrupted run invisible, and the learner with no explanation.
      await db.saveModel({ runId, projectId, artifactKey: runId, classOrder })

      setProgress({ phase: 'training' })

      const trained = await trainClassifier({
        embeddings,
        labels,
        classCount: classes.length,
        embeddingSize,
        epochs: settings.epochs,
        batchSize: settings.batchSize,
        signal: controller.signal,
        onEpochEnd: (epoch, loss, accuracy) => {
          setProgress({ phase: 'training', epoch: epoch + 1, loss, accuracy })
        },
      })

      await trained.save(runId)

      const result = evaluate(trained, embeddings, labels, classes.length, embeddingSize)

      // T089 / FR-010. The figures are recorded LOCALLY and unconditionally, then
      // remotely only if she has an account — in that order, because FR-023 gives
      // an anonymous visitor the whole lab and run comparison is part of it.
      const metrics: db.RunMetrics = {
        perClass: result.perClass.map((entry) => ({
          classId: classes[entry.classIndex]?.id ?? String(entry.classIndex),
          // The name at the time of the run, so a later comparison can say what a
          // since-renamed class used to be called (D2).
          className: classes[entry.classIndex]?.name ?? '',
          sampleCount: entry.sampleCount,
          accuracy: entry.accuracy,
        })),
        confusion: result.confusion.map((row) => [...row]),
        overallAccuracy: result.overallAccuracy,
        // `Infinity` is what an empty class produces, and it is not a number any
        // JSON or Postgres `numeric` column can hold. Stored as `null`, which the
        // interface renders as "one class has no samples" rather than as "∞".
        imbalanceRatio: Number.isFinite(result.imbalanceRatio) ? result.imbalanceRatio : null,
        backboneAlpha: project.backboneAlpha,
        epochs: settings.epochs,
        finishedAt: new Date().toISOString(),
      }

      await db.markModelReady(runId, metrics)
      await db.setActiveRun(projectId, runId)

      setModel(trained, runId)
      setEvaluation(result)

      if (ownerId) {
        // Not awaited into the training path, and a failure is not surfaced as one:
        // the work is safe on her device either way, and a school connection that
        // drops must not make a successful run look like a failed one.
        void recordTrainingRun(projectId, runId, metrics)
      }

      setProgress({
        phase: 'done',
        epoch: settings.epochs,
        elapsedMs: performance.now() - startedAt,
      })
    } catch (error) {
      // A cancelled run is marked failed, never left `ready`. `loadModelRecord`
      // then refuses it for inference (D5), which is the guarantee that a
      // half-trained head never gives a learner confident-looking probabilities.
      await db.markModelFailed(runId)
      setModel(null, null)

      if (isMlError(error) && error.code === 'ABORTED') {
        setProgress({ phase: 'cancelled' })
      } else {
        setProgress({ phase: 'failed' })
        setFailure(describeFailure(error))
      }
    } finally {
      abortRef.current = null
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  async function dismissInterrupted() {
    for (const record of interrupted) await db.markModelFailed(record.runId)
    setInterrupted([])
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The panel heading and intro live in LabPage, which owns the
          `aria-labelledby` target for this section. Repeating them here rendered
          the title twice. */}

      {/* FR-047: an unaccelerated device gets a warning, not a refusal. */}
      {backend && !backend.accelerated ? (
        <p className="rounded border border-amber bg-surface p-2 text-sm">{t('backendWarning')}</p>
      ) : null}

      {interrupted.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 rounded border border-orange p-3">
          <h4 className="font-semibold">{t('interrupted.heading')}</h4>
          <p className="text-sm">{t('interrupted.body', { name: project?.name ?? '' })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void dismissInterrupted().then(() => train())
              }}
            >
              {t('interrupted.restart')}
            </Button>
            <Button variant="ghost" onClick={() => void dismissInterrupted()}>
              {t('interrupted.dismiss')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* The refusal, naming the class. Rendered whether or not she has pressed
          anything, so the reason Train is disabled is never a mystery. */}
      {!readiness.ready ? (
        <p className="text-sm text-ink-muted">
          {readiness.reason === 'needTwoClasses' ? t('refuse.needTwoClasses') : null}
          {readiness.reason === 'emptyClass'
            ? t('refuse.emptyClass', { name: readiness.emptyNames[0] ?? '' })
            : null}
          {readiness.reason === 'emptyClasses'
            ? t('refuse.emptyClasses', { names: readiness.emptyNames.join(', ') })
            : null}
        </p>
      ) : null}

      {isTraining ? (
        <ProgressBar
          label={t('training')}
          value={progress.totalEpochs > 0 ? progress.epoch / progress.totalEpochs : null}
          detail={
            progress.phase === 'preparing'
              ? t('preparing')
              : t('epoch', { epoch: progress.epoch, total: progress.totalEpochs })
          }
          action={
            <Button variant="secondary" onClick={cancel}>
              {t('cancel')}
            </Button>
          }
        />
      ) : (
        <Button onClick={() => void train()} disabled={!readiness.ready} block>
          {model ? t('retrain') : t('train')}
        </Button>
      )}

      <p aria-live="polite" className="text-sm text-ink-muted">
        {progress.phase === 'done' ? t('done') : null}
        {progress.phase === 'cancelled' ? t('cancelled') : null}
      </p>

      {failure ? (
        <p role="alert" className="text-sm text-magenta">
          {failure}
        </p>
      ) : null}

      <div>
        <Button
          variant="ghost"
          onClick={() => {
            setShowSettings((value) => !value)
          }}
        >
          {showSettings ? t('settings.hide') : t('settings.show')}
        </Button>

        {showSettings ? (
          // A fieldset, so the three controls are one named group to a screen
          // reader — and so T038 can count them and hold FR-008's cap.
          <fieldset className="mt-2 flex flex-col gap-4 rounded border border-border-subtle p-3">
            <legend className="px-1 text-sm font-semibold">{t('settings.heading')}</legend>
            <p className="text-sm text-ink-muted">{t('settings.intro')}</p>

            <SettingRow
              label={t('settings.epochs.label')}
              help={t('settings.epochs.help')}
              control={
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={settings.epochs}
                  disabled={isTraining}
                  onChange={(event) => {
                    updateSettings({ epochs: Number(event.target.value) })
                  }}
                  className="min-h-touch w-24 rounded border border-border-subtle bg-surface px-2"
                />
              }
            />

            <SettingRow
              label={t('settings.batchSize.label')}
              help={t('settings.batchSize.help')}
              control={
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={settings.batchSize}
                  disabled={isTraining}
                  onChange={(event) => {
                    updateSettings({ batchSize: Number(event.target.value) })
                  }}
                  className="min-h-touch w-24 rounded border border-border-subtle bg-surface px-2"
                />
              }
            />

            <SettingRow
              label={t('settings.backbone.label')}
              help={t('settings.backbone.help')}
              control={
                <select
                  value={String(settings.backboneAlpha)}
                  disabled={isTraining}
                  onChange={(event) => {
                    const alpha = event.target.value === '0.25' ? 0.25 : 0.5
                    updateSettings({ backboneAlpha: alpha })
                    // D4: existing embeddings are marked stale, not deleted — the
                    // image blobs are the irreplaceable part and they stay.
                    if (projectId) void db.markEmbeddingsStale(projectId, alpha)
                  }}
                  className="min-h-touch rounded border border-border-subtle bg-surface px-2"
                >
                  <option value="0.5">{t('settings.backbone.large')}</option>
                  <option value="0.25">{t('settings.backbone.small')}</option>
                </select>
              }
            />

            <p className="text-sm text-orange">{t('settings.backbone.changeWarning')}</p>

            <Button
              variant="ghost"
              onClick={() => {
                updateSettings(DEFAULT_SETTINGS)
                resetProgress()
              }}
            >
              {t('settings.reset')}
            </Button>
          </fieldset>
        ) : null}
      </div>
    </div>
  )
}

function SettingRow({
  label,
  help,
  control,
}: {
  readonly label: string
  readonly help: string
  readonly control: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        {control}
      </label>
      {/* The explanation is always visible, never behind a tooltip. An unexplained
          knob is worse than no knob: a learner who changes it and gets a worse
          result has learned nothing about why (FR-008). */}
      <p className="text-sm text-ink-muted">{help}</p>
    </div>
  )
}
