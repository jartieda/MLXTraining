import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelRecord } from '@/lib/db'
import { compareRuns, hasChanged } from './analysis'

/**
 * T087 / FR-010, Scenario 7.3 — two runs side by side.
 *
 * The requirement is "which classes changed", and that phrase is doing real work:
 * a pair of accuracy columns is not a comparison, because reading two decimals per
 * class and subtracting them in your head is exactly the labour the view exists to
 * remove. So each row carries an explicit delta, a direction, and a sentence.
 *
 * **Classes are matched by id, never by position or name.** A learner who adds a
 * class between runs shifts every later index, and one who renames a class breaks
 * every name match — and in both cases positional matching produces a comparison
 * that is confidently wrong rather than visibly broken. Matching by id also means a
 * class present in only one run is reported as added or removed, which is usually
 * the very thing she changed.
 *
 * The interesting comparison for the fairness lesson is the skewed run against the
 * rebalanced one, so the two most recent runs are preselected and the sample counts
 * are shown next to the accuracies. Without the counts, "the small class got better"
 * has no visible cause.
 */

export function RunComparison({ runs }: { readonly runs: readonly ModelRecord[] }) {
  const { t, i18n } = useTranslation('results')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [baselineId, setBaselineId] = useState<string | null>(null)

  if (runs.length < 2) {
    return (
      <section aria-labelledby="run-comparison" className="flex flex-col gap-2">
        <h3 id="run-comparison" className="font-display text-base">
          {t('comparison.heading')}
        </h3>
        {/* Said plainly rather than hiding the section. A learner who has been told
            the lab keeps her runs should be able to see where they will appear. */}
        <p className="max-w-prose text-sm text-ink-muted">{t('comparison.needTwo')}</p>
      </section>
    )
  }

  // Newest against the one before it: for the fairness lesson that is the
  // rebalanced run against the skewed one, which is the comparison she just made.
  const current = runs.find((run) => run.runId === currentId) ?? runs[0]
  const baseline = runs.find((run) => run.runId === baselineId) ?? runs[1]
  if (!current?.metrics || !baseline?.metrics) return null

  const deltas = compareRuns(baseline.metrics.perClass, current.metrics.perClass)
  const changed = deltas.filter(hasChanged)
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
  const percent = (value: number | null) =>
    value === null ? '—' : `${String(Math.round(value * 100))}%`

  const label = (run: ModelRecord) =>
    t('comparison.runLabel', {
      date: run.metrics ? formatter.format(new Date(run.metrics.finishedAt)) : '',
      accuracy: percent(run.metrics?.overallAccuracy ?? null),
    })

  return (
    <section aria-labelledby="run-comparison" className="flex flex-col gap-3">
      <h3 id="run-comparison" className="font-display text-base">
        {t('comparison.heading')}
      </h3>
      <p className="max-w-prose text-sm text-ink-muted">{t('comparison.intro')}</p>

      <div className="flex flex-col gap-2 md:flex-row md:gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('comparison.baselineLabel')}</span>
          <select
            value={baseline.runId}
            onChange={(event) => {
              setBaselineId(event.target.value)
            }}
            className="min-h-touch rounded border border-border-subtle bg-surface px-2"
          >
            {runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {label(run)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('comparison.currentLabel')}</span>
          <select
            value={current.runId}
            onChange={(event) => {
              setCurrentId(event.target.value)
            }}
            className="min-h-touch rounded border border-border-subtle bg-surface px-2"
          >
            {runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {label(run)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {baseline.runId === current.runId ? (
        <p className="text-sm text-ink-muted">{t('comparison.sameRun')}</p>
      ) : (
        <>
          <p className="text-sm" data-testid="comparison-overall">
            {t('comparison.overall', {
              baseline: percent(baseline.metrics.overallAccuracy),
              current: percent(current.metrics.overallAccuracy),
            })}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="mb-2 text-left text-sm text-ink-muted">
                {t('comparison.caption')}
              </caption>
              <thead>
                <tr className="border-b border-border-subtle">
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('comparison.classColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('comparison.baselineColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('comparison.currentColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('comparison.changeColumn')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {deltas.map((delta) => (
                  <tr
                    key={delta.classId}
                    data-testid={`delta-${delta.direction}`}
                    className="border-b border-border-subtle"
                  >
                    <th scope="row" className="p-2 text-left font-medium">
                      {delta.className}
                    </th>
                    <td className="p-2 tabular-nums">
                      {t('comparison.cell', {
                        accuracy: percent(delta.baselineAccuracy),
                        count: delta.baselineCount ?? 0,
                      })}
                    </td>
                    <td className="p-2 tabular-nums">
                      {t('comparison.cell', {
                        accuracy: percent(delta.currentAccuracy),
                        count: delta.currentCount ?? 0,
                      })}
                    </td>
                    <td className="p-2">
                      {/* A word, not an arrow. An arrow needs a legend and reads as
                          decoration to a screen reader. */}
                      {t(`comparison.direction.${delta.direction}`)}
                      {/* Named separately, because on a separable problem the
                          accuracy often does not move while the photo count does —
                          and the count is what she actually changed. */}
                      {delta.countChanged && delta.direction !== 'added' && delta.direction !== 'removed' ? (
                        <span data-testid="delta-count-changed" className="block text-ink-muted">
                          {t('comparison.direction.countChanged', {
                            from: delta.baselineCount ?? 0,
                            to: delta.currentCount ?? 0,
                          })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="max-w-prose text-sm font-medium" data-testid="comparison-summary">
            {changed.length === 0
              ? t('comparison.nothingChanged')
              : t('comparison.changedClasses', {
                  names: changed.map((delta) => delta.className).join(', '),
                  count: changed.length,
                })}
          </p>
        </>
      )}
    </section>
  )
}
