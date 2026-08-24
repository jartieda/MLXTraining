import { useTranslation } from 'react-i18next'

/**
 * Route placeholder. The working screen arrives with T075 (US4).
 *
 * It exists now so that the shell's route table (T034) is complete and its
 * Phase 2 checkpoint — every route renders in both locales — is a real assertion
 * rather than a claim about routes that do not resolve.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation('common')

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-2xl">{t('nav.login')}</h1>
      <p className="text-ink-muted">{t('common:action.loading')}</p>
    </div>
  )
}
