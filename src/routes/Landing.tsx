import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Meter } from '@/components/Meter'
import type * as dbTypes from '@/lib/db'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'GB'}`
}

/**
 * T034 — the landing page.
 *
 * Its most important job is to send a visitor straight into the lab. FR-023 gives
 * an unauthenticated visitor the complete local experience, so a landing page
 * that led with "sign in" would put a wall in front of the one path that needs
 * none — and there is no sign-up to offer her either (FR-024), so a prominent
 * account prompt would be an invitation to look for a door that does not exist.
 */
export function Landing() {
  const { t } = useTranslation(['common', 'projects'])
  const [deviceStorage, setDeviceStorage] = useState<dbTypes.StorageEstimate | null>(null)

  useEffect(() => {
    let active = true
    void import('@/lib/db').then(({ estimateStorage }) =>
      estimateStorage().then((estimate) => {
        if (active) setDeviceStorage(estimate)
      }),
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h1 className="font-display text-3xl leading-tight md:text-4xl">{t('nav.home')}</h1>
        <p className="max-w-prose text-lg text-ink-muted">{t('app.tagline')}</p>
      </section>

      <section
        aria-labelledby="xai-intro"
        className="rounded-lg border-l-4 border-magenta bg-surface-sunken p-4"
      >
        <h2 id="xai-intro" className="font-display text-xl">
          {t('projects:xaiTitle')}
        </h2>
        <p className="mt-2 font-display text-lg text-ink">{t('projects:xaiQuote')}</p>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">{t('projects:xaiWhy')}</p>
      </section>

      <section aria-labelledby="xai-tracks" className="flex flex-col gap-3">
        <h2 id="xai-tracks" className="font-display text-xl">
          {t('projects:tracksTitle')}
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <article className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="font-display text-lg">{t('projects:tracks.cv.title')}</h3>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('projects:tracks.cv.subtitle')}
            </p>
            <p className="max-w-prose text-sm text-ink-muted">{t('projects:tracks.cv.body')}</p>
            <div className="mt-auto pt-2">
              <Link
                to="/lab"
                className="flex min-h-touch w-fit items-center rounded bg-blue px-4 text-sm font-medium text-ink-inverse no-underline"
              >
                {t('projects:tracks.cv.cta')}
              </Link>
            </div>
          </article>

          <article className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="font-display text-lg">{t('projects:tracks.llm.title')}</h3>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('projects:tracks.llm.subtitle')}
            </p>
            <p className="max-w-prose text-sm text-ink-muted">{t('projects:tracks.llm.body')}</p>
            <div className="mt-auto pt-2">
              <Link
                to="/lab-llm"
                className="flex min-h-touch w-fit items-center rounded bg-magenta px-4 text-sm font-medium text-ink-inverse no-underline"
              >
                {t('projects:tracks.llm.cta')}
              </Link>
            </div>
          </article>
        </div>
      </section>

      <section className="rounded-lg border-l-4 border-magenta bg-surface-sunken p-4">
        <h2 className="font-display text-xl">{t('storage.label')}</h2>
        {deviceStorage?.known && deviceStorage.ratio !== null ? (
          <div className="mt-3 flex flex-col gap-2">
            <Meter
              label={t('storage.label')}
              value={deviceStorage.ratio}
              tone={deviceStorage.shouldRefuse || deviceStorage.shouldWarn ? 'warn' : 'neutral'}
              valueText={t('storage.used', {
                used: formatBytes(deviceStorage.usage ?? 0),
                total: formatBytes(deviceStorage.quota ?? 0),
              })}
            />
            {deviceStorage.shouldRefuse ? (
              <p role="alert" className="text-sm text-magenta">
                {t('storage.refuse')}
              </p>
            ) : deviceStorage.shouldWarn ? (
              <p className="text-sm text-orange">
                {t('storage.warn', { percent: Math.round(deviceStorage.ratio * 100) })}
              </p>
            ) : null}
          </div>
        ) : deviceStorage ? (
          <p className="mt-2 text-sm text-ink-muted">{t('storage.unknown')}</p>
        ) : null}
      </section>

      <section className="rounded-lg bg-sky-100 p-4">
        <h2 className="text-base font-semibold text-navy">{t('privacy.shortOnDevice')}</h2>
        <p className="mt-1 max-w-prose text-sm text-navy">{t('privacy.onDevice')}</p>
      </section>
    </div>
  )
}
