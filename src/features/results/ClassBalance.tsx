import { useTranslation } from 'react-i18next'
import { Meter } from '@/components/Meter'

/**
 * T085 / FR-020 — how many samples each class has.
 *
 * Shown in the training view **before** training as well as after, and that is the
 * whole point of the placement. FR-021 requires reporting imbalance; reporting it
 * only afterwards means a learner discovers the problem once the run is spent. Here
 * she can see forty against five while the fix is still "take more photographs of
 * the second one".
 *
 * Bars are scaled to the largest class rather than to the total. With three classes
 * the share-of-total reading makes a perfectly balanced set look like three
 * one-third bars, which says nothing; scaled to the largest, balance looks like
 * three full bars and imbalance is immediately a short bar next to a long one.
 */

export interface ClassCount {
  readonly classId: string
  readonly className: string
  readonly sampleCount: number
}

export function ClassBalance({ counts }: { readonly counts: readonly ClassCount[] }) {
  const { t } = useTranslation('results')

  if (counts.length === 0) return null

  const largest = Math.max(...counts.map((entry) => entry.sampleCount), 0)
  const total = counts.reduce((sum, entry) => sum + entry.sampleCount, 0)

  return (
    <section aria-labelledby="class-balance" className="flex flex-col gap-2">
      <h3 id="class-balance" className="font-display text-base">
        {t('balance.heading')}
      </h3>
      <p className="text-sm text-ink-muted">{t('balance.total', { count: total })}</p>

      <ul role="list" className="flex list-none flex-col gap-2 p-0">
        {counts.map((entry) => (
          <li key={entry.classId}>
            <Meter
              label={entry.className}
              value={largest === 0 ? 0 : entry.sampleCount / largest}
              // An empty class is a refusal to train (Scenario 1.3), so it is
              // flagged here too rather than rendering as a bar of length zero
              // that looks like a rounding artefact.
              tone={entry.sampleCount === 0 ? 'warn' : 'neutral'}
              valueText={t('balance.count', { count: entry.sampleCount })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
