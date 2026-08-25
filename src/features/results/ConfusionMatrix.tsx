import { useTranslation } from 'react-i18next'
import { Legend } from '@/components/Legend'
import { legendStops, rampCss, rampInk } from '@/ml/explain/colormap'
import type { RunClassMetric } from '@/lib/db'

/**
 * T084 / FR-020, Principle V — the confusion breakdown.
 *
 * **Rows are the true class, columns the predicted class.** A transposed matrix
 * still looks exactly like a confusion matrix and reverses every conclusion drawn
 * from it, so the orientation is stated in the caption, in the row and column
 * headers, and asserted by a test. `src/ml/metrics.ts` produces it in this
 * orientation and calls it a contract; this is the other end of that contract.
 *
 * **The heat encoding uses the R6 perceptually uniform ramp, not brand colours.**
 * Principle V exempts data visualisation from the Technovation palette precisely
 * so a quantitative reading survives, and a confusion matrix is as quantitative as
 * the heat maps the exemption was written for. Using brand accents would also make
 * a hot cell indistinguishable from a focus ring.
 *
 * **Cells are shaded by row share, not by raw count.** This is the decision that
 * makes the matrix useful for the lesson it exists to serve. With 40 samples of
 * one class and 5 of another, absolute shading paints the big class's row dark and
 * the small class's row pale, and the learner reads "the model is good at the big
 * one" — when the finding is the opposite: the small class's five samples all went
 * somewhere else. Row share puts both rows on the same footing, which is where
 * FR-021's imbalance story is actually visible. The count is still printed in every
 * cell, so nothing is hidden by the normalisation.
 */

export function ConfusionMatrix({
  perClass,
  confusion,
}: {
  readonly perClass: readonly RunClassMetric[]
  readonly confusion: readonly (readonly number[])[]
}) {
  const { t } = useTranslation('results')

  if (perClass.length === 0) return null

  const percent = (value: number) => `${String(Math.round(value * 100))}%`

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-base">{t('confusion.heading')}</h3>
      <p className="max-w-prose text-sm text-ink-muted">{t('confusion.intro')}</p>

      {/* Scrolls rather than shrinking: at 360 px with five classes, squeezing the
          columns makes every number unreadable, and a matrix you cannot read is
          worse than one you have to swipe (SC-004). */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <caption className="mb-2 text-left text-sm text-ink-muted">
            {t('confusion.caption')}
          </caption>
          <thead>
            <tr>
              {/* Empty corner cell, marked as a header so the row-header column is
                  announced with a name rather than as a stray data cell. */}
              <th scope="col" className="p-2 text-left font-semibold">
                {t('confusion.cornerLabel')}
              </th>
              {perClass.map((entry) => (
                <th
                  key={entry.classId}
                  scope="col"
                  className="p-2 text-left font-semibold whitespace-nowrap"
                >
                  {entry.className}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perClass.map((trueClass, rowIndex) => {
              const row = confusion[rowIndex] ?? []
              const rowTotal = row.reduce((sum, value) => sum + value, 0)

              return (
                <tr key={trueClass.classId}>
                  <th scope="row" className="p-2 text-left font-semibold whitespace-nowrap">
                    {trueClass.className}
                  </th>
                  {perClass.map((predictedClass, columnIndex) => {
                    const count = row[columnIndex] ?? 0
                    const share = rowTotal === 0 ? 0 : count / rowTotal

                    return (
                      <td
                        key={predictedClass.classId}
                        // Both colours come from the ramp module, which is the one
                        // Principle V exempts. The ink is deliberately not a
                        // `--tv-ink` token: those flip with the theme and the ramp
                        // does not, so a token would render white on pale yellow.
                        style={{ backgroundColor: rampCss(share), color: rampInk(share) }}
                        className="p-2 text-center tabular-nums"
                      >
                        {/* The visible text is the count; the accessible name is the
                            whole sentence. A screen-reader user reading "40" out of
                            a grid she cannot see has no idea which pairing it is. */}
                        <span aria-hidden="true">{count}</span>
                        <span className="sr-only">
                          {t('confusion.cell', {
                            count,
                            share: percent(share),
                            trueClass: trueClass.className,
                            predictedClass: predictedClass.className,
                          })}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Legend
        stops={legendStops(7)}
        lowLabel={t('confusion.legendLow')}
        highLabel={t('confusion.legendHigh')}
        caption={t('confusion.legendCaption')}
      />
    </div>
  )
}
