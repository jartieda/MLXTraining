import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Meter } from '@/components/Meter'
import type * as dbTypes from '@/lib/db'
import { ProjectQuestions } from '@/features/quiz/ProjectQuestions'

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

const STEPS = ['quizBefore', 'theory', 'labs', 'project', 'quizAfter'] as const
const THEORY = ['whatIsAi', 'whatIsXai', 'whatIsBias', 'howToExplain', 'limits'] as const

/**
 * T034 — the landing page.
 *
 * It also explains how the site works (the two labs share three tabs: tools,
 * challenges, missions), holds the XAI theory, the «Tu proyecto y la XAI» questions
 * and the way into the learning questionnaire, taken before and after.
 *
 * Its most important job is to send a visitor straight into the lab. FR-023 gives
 * an unauthenticated visitor the complete local experience, so a landing page
 * that led with "sign in" would put a wall in front of the one path that needs
 * none — and there is no sign-up to offer her either (FR-024), so a prominent
 * account prompt would be an invitation to look for a door that does not exist.
 */
export function Landing() {
  const { t } = useTranslation(['common', 'projects', 'home'])
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
        <h1 className="font-display text-3xl leading-tight md:text-4xl">{t('home:hero.title')}</h1>
        <p className="max-w-prose text-lg text-ink-muted">{t('home:hero.body')}</p>
      </section>

      <section aria-labelledby="how-it-works" className="flex flex-col gap-3">
        <h2 id="how-it-works" className="font-display text-xl">
          {t('home:how.title')}
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('home:how.intro')}</p>
        <ol className="grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-5">
          {STEPS.map((step, index) => (
            <li key={step} className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface p-3">
              <span className="font-display text-2xl text-magenta">{index + 1}</span>
              <h3 className="font-semibold">{t(`home:how.steps.${step}.title`)}</h3>
              <p className="text-sm text-ink-muted">{t(`home:how.steps.${step}.body`)}</p>
            </li>
          ))}
        </ol>
        <div className="rounded-lg bg-surface-sunken p-4">
          <h3 className="font-semibold">{t('home:how.tabsTitle')}</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>{t('home:how.tabs.tools')}</li>
            <li>{t('home:how.tabs.challenges')}</li>
            <li>{t('home:how.tabs.missions')}</li>
          </ul>
        </div>
      </section>

      <section
        aria-labelledby="quiz-callout"
        className="flex flex-col gap-2 rounded-lg border-l-4 border-blue bg-surface-sunken p-4"
      >
        <h2 id="quiz-callout" className="font-display text-xl">
          {t('home:quizCallout.title')}
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('home:quizCallout.body')}</p>
        <div>
          <Link
            to="/quiz"
            className="flex min-h-touch w-fit items-center rounded bg-blue px-4 text-sm font-medium text-ink-inverse no-underline"
          >
            {t('home:quizCallout.cta')}
          </Link>
        </div>
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

      <section aria-labelledby="xai-theory" className="flex flex-col gap-3">
        <h2 id="xai-theory" className="font-display text-xl">
          {t('home:theory.title')}
        </h2>
        <p className="rounded-lg border-l-4 border-magenta bg-surface-sunken p-4 font-display text-lg text-ink">
          {t('projects:xaiQuote')}
        </p>
        {THEORY.map((topic) => (
          <details key={topic} className="rounded-lg border border-border-subtle bg-surface p-4">
            <summary className="cursor-pointer font-semibold">{t(`home:theory.${topic}.title`)}</summary>
            <div className="mt-2 flex max-w-prose flex-col gap-2 text-sm">
              {(t(`home:theory.${topic}.paragraphs`, { returnObjects: true }) as string[]).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </details>
        ))}
      </section>

      <ProjectQuestions />

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
