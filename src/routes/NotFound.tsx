import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

export function NotFound() {
  const { t } = useTranslation('common')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl">{t('error.notFound')}</h1>
      <p className="text-ink-muted">{t('error.notFoundBody')}</p>
      <Link to="/projects" className="text-blue">
        {t('nav.projects')}
      </Link>
    </div>
  )
}
