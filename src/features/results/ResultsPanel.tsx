import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Meter } from '@/components/Meter'
import { useLab } from '@/features/lab/labStore'
import * as db from '@/lib/db'
import { ClassBalance, type ClassCount } from './ClassBalance'
import { ConfusionMatrix } from './ConfusionMatrix'
import { ExportModel } from './ExportModel'
import { ImbalanceNotice } from './ImbalanceNotice'
import { RunComparison } from './RunComparison'

/**
 * T084–T088 assembled / FR-020, FR-021, FR-022, Scenario 7.1.
 *
 * The reading order is the argument the fairness lesson makes, in sequence: how
 * many of each you gave it, how well it did overall, how well per class, what it
 * mixed up, and — if the counts were lopsided — what that probably did. Putting
 * the confusion matrix first would be showing the evidence before the claim.
 *
 * **The balance section renders before there is a model**, and everything else
 * after. That split is the whole placement decision: sample counts are actionable
 * while she can still go and take more photographs, and a run's figures do not
 * exist until there is a run. So an untrained project shows one section rather
 * than five empty ones.
 */

export function ResultsPanel() {
  const { t } = useTranslation('results')
  const { projectId, project, classes, sampleCounts, evaluation, model, runId } = useLab()
  const [runs, setRuns] = useState<readonly db.ModelRecord[]>([])

  const reloadRuns = useCallback(async () => {
    if (!projectId) {
      setRuns([])
      return
    }
    setRuns(await db.listFinishedRuns(projectId))
  }, [projectId])

  // Keyed on `runId` so a finished run appears in the comparison immediately. The
  // store sets it after `markModelReady`, which is also when the metrics row it
  // needs exists — reloading on `evaluation` instead would race that write.
  useEffect(() => {
    void reloadRuns()
  }, [reloadRuns, runId])

  const counts: readonly ClassCount[] = classes.map((klass) => ({
    classId: klass.id,
    className: klass.name,
    sampleCount: sampleCounts[klass.id] ?? 0,
  }))

  /**
   * The run being reported: the one just trained, or failing that the newest one
   * stored.
   *
   * The fallback is what makes Scenario 7.1 — "given a trained model, when she opens
   * the results view" — true after a reload. The live `evaluation` only exists for
   * the session that produced it, so without this the figures would vanish on
   * refresh while the project card still said "trained model ready", and she would
   * reasonably conclude the lab had lost them.
   */
  const stored = runs[0]?.metrics ?? null

  // Class names come from the live class list rather than from the stored run, so a
  // class renamed after training shows its current name while its figures stay
  // attributed by id (D2, Edge Cases). Where a class has since been deleted, the
  // run's own recorded name is used — that is what it was called at the time.
  const nameById = new Map(classes.map((klass) => [klass.id, klass.name]))

  const perClass: readonly db.RunClassMetric[] = evaluation
    ? evaluation.perClass.map((entry) => {
        const classId = classes[entry.classIndex]?.id ?? String(entry.classIndex)
        return {
          classId,
          className: nameById.get(classId) ?? '',
          sampleCount: entry.sampleCount,
          accuracy: entry.accuracy,
        }
      })
    : (stored?.perClass.map((entry) => ({
        ...entry,
        className: nameById.get(entry.classId) ?? entry.className,
      })) ?? [])

  const confusion = evaluation?.confusion ?? stored?.confusion ?? []
  const overallAccuracy = evaluation?.overallAccuracy ?? stored?.overallAccuracy ?? 0
  const imbalanceRatio = evaluation
    ? Number.isFinite(evaluation.imbalanceRatio)
      ? evaluation.imbalanceRatio
      : null
    : (stored?.imbalanceRatio ?? null)

  const percent = (value: number) => `${String(Math.round(value * 100))}%`

  return (
    <div className="flex flex-col gap-5">
      <h2 id="panel-results" className="font-display text-lg">
        {t('panelTitle')}
      </h2>

      <ClassBalance counts={counts} />

      {perClass.length > 0 ? (
        <>
          <section aria-labelledby="per-class" className="flex flex-col gap-2">
            <h3 id="per-class" className="font-display text-base">
              {t('perClass.heading')}
            </h3>

            <p className="text-sm" data-testid="overall-accuracy">
              {t('perClass.overall', { accuracy: percent(overallAccuracy) })}
            </p>
            {/* Said once, here, rather than repeated by every figure: these numbers
                come from the same photographs the model learned from, so they are
                the ceiling rather than an estimate of new performance. A learner
                drawing conclusions from 100% deserves to know why it says 100%. */}
            <p className="max-w-prose text-sm text-ink-muted">{t('perClass.caveat')}</p>

            <ul className="flex list-none flex-col gap-2 p-0">
              {perClass.map((entry) => (
                <li key={entry.classId}>
                  <Meter
                    label={entry.className}
                    value={entry.accuracy}
                    tone={entry.accuracy >= 0.8 ? 'good' : entry.accuracy >= 0.5 ? 'neutral' : 'warn'}
                    valueText={t('perClass.value', {
                      accuracy: percent(entry.accuracy),
                      count: entry.sampleCount,
                    })}
                  />
                </li>
              ))}
            </ul>
          </section>

          <ConfusionMatrix perClass={perClass} confusion={confusion} />

          <ImbalanceNotice
            perClass={perClass}
            confusion={confusion}
            imbalanceRatio={imbalanceRatio}
          />
        </>
      ) : (
        <p className="max-w-prose text-sm text-ink-muted">{t('untrained')}</p>
      )}

      <RunComparison runs={runs} />

      <ExportModel model={model} perClass={perClass} projectName={project?.name ?? ''} />
    </div>
  )
}
