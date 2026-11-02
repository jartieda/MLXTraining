import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'

/**
 * «Repetir 5 veces»: a mock-up, on purpose. Asking the same question several times and
 * seeing whether the answer changes is a good sign of doubt, but the engine generates
 * without randomness (greedy) and is not modified, so every repetition would be
 * identical. The interface is shown, marked «Próximamente», and says why, so it never
 * reads as a fault.
 */

const REPEATS = 5

export function RepeatMockup() {
  const { t } = useTranslation('llm')
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      data-testid="repeat-mockup"
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border-subtle bg-surface p-4"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 id={headingId} className="font-display text-xl">{t('repeat.title')}</h2>
        <span className="rounded-full border border-border-subtle px-2 py-0.5 text-xs font-medium text-ink-muted" data-testid="repeat-badge">
          {t('repeat.badge')}
        </span>
      </header>
      <p className="max-w-prose text-sm text-ink-muted">{t('repeat.intro')}</p>
      <p className="rounded border border-border-subtle bg-surface-sunken p-2 text-sm">{t('repeat.why')}</p>
      <ol aria-label={t('repeat.listLabel')} className="flex list-none flex-col gap-1 p-0 text-sm text-ink-muted">
        {Array.from({ length: REPEATS }, (_, index) => (
          <li key={index} className="rounded border border-dashed border-border-subtle px-2 py-1">
            {t('repeat.slot', { number: index + 1 })}
          </li>
        ))}
      </ol>
      <div>
        <Button variant="secondary" disabled>
          {t('repeat.run')}
        </Button>
      </div>
    </section>
  )
}
