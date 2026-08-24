import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('common')

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h1 className="font-display text-3xl leading-tight md:text-4xl">{t('app.name')}</h1>
        <p className="max-w-prose text-lg text-ink-muted">{t('app.tagline')}</p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            to="/projects"
            className="flex min-h-touch items-center justify-center rounded bg-blue px-6 text-lg font-medium text-ink-inverse no-underline"
          >
            {t('nav.projects')}
          </Link>
          <Link
            to="/login"
            className="flex min-h-touch items-center justify-center rounded border border-border-subtle px-6 text-lg font-medium text-ink no-underline"
          >
            {t('nav.login')}
          </Link>
        </div>
      </section>

      <section className="rounded-lg bg-sky-100 p-4">
        <h2 className="text-base font-semibold text-navy">{t('privacy.shortOnDevice')}</h2>
        <p className="mt-1 max-w-prose text-sm text-navy">{t('privacy.onDevice')}</p>
      </section>
    </div>
  )
}
