import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, currentLocale, setLocale, isLocale } from '@/lib/i18n'

/**
 * T014 / FR-044 — the language control.
 *
 * A native `<select>`, not a custom dropdown. Two options do not justify re-implementing
 * listbox keyboard semantics, and the native control is the only one guaranteed usable
 * with a phone's own picker.
 *
 * Each language is named in its own language ("Español", never "Spanish"), because a
 * learner who cannot read the current interface language must still recognise her own.
 */
export function LanguageSwitcher({ className = '' }: { readonly className?: string }) {
  const { t } = useTranslation('common')
  const active = currentLocale()

  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span className="text-ink-muted">{t('language.label')}</span>
      <select
        value={active}
        onChange={(event) => {
          const next = event.target.value
          if (isLocale(next)) void setLocale(next)
        }}
        className="min-h-touch rounded border border-border-subtle bg-surface px-2 text-ink"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`language.${locale}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
