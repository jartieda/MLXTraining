import i18next from 'i18next'
import type { i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enCommon from '@/locales/en/common.json'
import enProjects from '@/locales/en/projects.json'
import enCapture from '@/locales/en/capture.json'
import enTraining from '@/locales/en/training.json'
import enTesting from '@/locales/en/testing.json'
import enExplaining from '@/locales/en/explaining.json'
import enResults from '@/locales/en/results.json'
import enAuth from '@/locales/en/auth.json'
import enClassroom from '@/locales/en/classroom.json'
import enAdmin from '@/locales/en/admin.json'

import esCommon from '@/locales/es/common.json'
import esProjects from '@/locales/es/projects.json'
import esCapture from '@/locales/es/capture.json'
import esTraining from '@/locales/es/training.json'
import esTesting from '@/locales/es/testing.json'
import esExplaining from '@/locales/es/explaining.json'
import esResults from '@/locales/es/results.json'
import esAuth from '@/locales/es/auth.json'
import esClassroom from '@/locales/es/classroom.json'
import esAdmin from '@/locales/es/admin.json'

/**
 * T012 / R11 / FR-044 — internationalisation.
 *
 * `en` is the fallback and `es` is the only other locale. SC-005 demands zero
 * untranslated strings, which discipline alone never achieves: tests/unit/i18n.test.ts
 * walks the `en` key tree and fails the build on any key missing from `es`, so an English
 * string shipped without its Spanish counterpart is a red build rather than a bug report
 * from a classroom.
 *
 * Namespaces are split per feature, which keeps each feature's strings reviewable
 * alongside its code. The `lessons` namespace is the exception: it is the bulk of the
 * translatable text and is loaded per module on demand (see `loadLessonNamespace`) rather
 * than shipped in the initial bundle, because SC-008 gives the first route a 3 s budget
 * on a mid-range phone.
 */

export const SUPPORTED_LOCALES = ['en', 'es'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const FALLBACK_LOCALE: Locale = 'en'

/** Namespaces bundled with the initial load. `lessons` is deliberately absent. */
export const EAGER_NAMESPACES = [
  'common',
  'projects',
  'capture',
  'training',
  'testing',
  'explaining',
  'results',
  'auth',
  'classroom',
  'admin',
] as const
export type Namespace = (typeof EAGER_NAMESPACES)[number] | 'lessons'

export const LANGUAGE_STORAGE_KEY = 'ml4g.locale'

/**
 * Exported so the i18n completeness test can walk the same trees the application loads,
 * rather than re-reading the files from disk and testing something subtly different.
 */
export const resources = {
  en: {
    common: enCommon,
    projects: enProjects,
    capture: enCapture,
    training: enTraining,
    testing: enTesting,
    explaining: enExplaining,
    results: enResults,
    auth: enAuth,
    classroom: enClassroom,
    admin: enAdmin,
  },
  es: {
    common: esCommon,
    projects: esProjects,
    capture: esCapture,
    training: esTraining,
    testing: esTesting,
    explaining: esExplaining,
    results: esResults,
    auth: esAuth,
    classroom: esClassroom,
    admin: esAdmin,
  },
} as const

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

let initialised: Promise<I18nInstance> | null = null

export function initI18n(): Promise<I18nInstance> {
  initialised ??= i18next
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: FALLBACK_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      // Without this, a browser reporting `es-419` resolves to nothing and every string
      // falls back to English for a Spanish-speaking learner.
      nonExplicitSupportedLngs: true,
      load: 'languageOnly',
      ns: [...EAGER_NAMESPACES],
      defaultNS: 'common',
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        caches: ['localStorage'],
      },
      interpolation: {
        // React escapes for us; double-escaping mangles a learner's own reflection text.
        escapeValue: false,
      },
      returnNull: false,
    })
    .then(() => i18next)

  return initialised
}

/** Test-only: drops the memoised instance so a fresh init can be asserted. */
export function resetI18nForTesting(): void {
  initialised = null
}

/**
 * Switches locale and persists the choice (FR-044). The detector's `localStorage` cache
 * writes the key, so a reload keeps the learner's choice rather than re-detecting.
 */
export async function setLocale(locale: Locale): Promise<void> {
  await i18next.changeLanguage(locale)
}

export function currentLocale(): Locale {
  const resolved = i18next.resolvedLanguage ?? i18next.language ?? FALLBACK_LOCALE
  const base = resolved.split('-')[0] ?? FALLBACK_LOCALE
  return isLocale(base) ? base : FALLBACK_LOCALE
}

/**
 * Lazily loads the `lessons` namespace for the active locale (R11). Called on entry to
 * the learning path, not at start-up: the seven modules are the largest block of text in
 * the product and none of it is needed to reach a first prediction.
 */
export async function loadLessonNamespace(): Promise<void> {
  if (i18next.hasResourceBundle(currentLocale(), 'lessons')) return

  const locale = currentLocale()
  const bundle: unknown =
    locale === 'es'
      ? (await import('@/locales/es/lessons.json')).default
      : (await import('@/locales/en/lessons.json')).default

  i18next.addResourceBundle(locale, 'lessons', bundle, true, false)
}

export default i18next
