import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { IMBALANCE_THRESHOLD } from '@/ml/metrics'
import type { RunClassMetric } from '@/lib/db'
import { mostConfusedPair } from './analysis'

/**
 * T086 / FR-009, FR-021, Scenario 7.2 — the imbalance report.
 *
 * **This component reports and never gates.** It renders a notice; it exposes no
 * way to prevent, delay or discourage a training run, and `TrainPanel` does not
 * consult it. That is not defensive coding, it is the requirement: FR-009 permits
 * training on imbalanced classes and FR-021 requires warning about it, and the
 * fairness module (FR-036) is built on a learner doing exactly that — training a
 * deliberately skewed model, watching the minority class collapse, rebalancing, and
 * comparing the two runs. A guard here, however well meant, deletes a lesson from
 * the curriculum. `src/ml/metrics.ts` says the same thing at the other end.
 *
 * The notice does three things in order, and the order is the pedagogy: it states
 * the ratio as a fact, explains the likely *effect* in plain language, and only
 * then points at the lesson. Leading with the lesson link reads as a telling-off
 * for something she has not yet been shown is a problem.
 */

export function ImbalanceNotice({
  perClass,
  confusion,
  imbalanceRatio,
}: {
  readonly perClass: readonly RunClassMetric[]
  readonly confusion: readonly (readonly number[])[]
  readonly imbalanceRatio: number | null
}) {
  const { t } = useTranslation('results')

  const ratio = imbalanceRatio
  const notable = ratio !== null && Number.isFinite(ratio) && ratio >= IMBALANCE_THRESHOLD
  if (!notable) return null

  const sorted = [...perClass].sort((a, b) => a.sampleCount - b.sampleCount)
  const smallest = sorted[0]
  const largest = sorted[sorted.length - 1]
  if (!smallest || !largest) return null

  // The same pair the matrix highlights, derived from the same function, so the
  // two never tell a learner different stories about one run.
  const confused = mostConfusedPair(perClass, confusion)

  return (
    // `status`, not `alert`. An imbalanced run is a legitimate, often deliberate
    // state, and an assertive live region interrupting a screen-reader user to
    // announce it would frame a teaching point as an error.
    <section
      role="status"
      aria-labelledby="imbalance-heading"
      data-testid="imbalance-notice"
      className="flex flex-col gap-2 rounded-lg border border-amber bg-surface p-4"
    >
      <h3 id="imbalance-heading" className="text-base font-semibold">
        {t('imbalance.heading')}
      </h3>

      <p className="max-w-prose text-sm">
        {t('imbalance.ratio', {
          ratio: ratio.toFixed(1),
          largeClass: largest.className,
          largeCount: largest.sampleCount,
          smallClass: smallest.className,
          smallCount: smallest.sampleCount,
        })}
      </p>

      {/* The effect, which is the part FR-021 actually asks for. A ratio on its own
          is a number a learner has no way to interpret. */}
      <p className="max-w-prose text-sm">
        {t('imbalance.effect', { smallClass: smallest.className, largeClass: largest.className })}
      </p>

      {confused ? (
        <p className="max-w-prose text-sm">
          {t('imbalance.confusedPair', {
            trueClass: confused.trueClass,
            predictedClass: confused.predictedClass,
            share: `${String(Math.round(confused.share * 100))}%`,
          })}
        </p>
      ) : null}

      {/* Stated explicitly, because a warning next to a result is read as "this
          result is void" unless it says otherwise (Scenario 7.2). */}
      <p className="max-w-prose text-sm font-medium">{t('imbalance.stillUsable')}</p>

      <p className="text-sm">
        <Link to="/lessons/fairness" className="text-blue">
          {t('imbalance.lessonLink')}
        </Link>
      </p>
    </section>
  )
}
