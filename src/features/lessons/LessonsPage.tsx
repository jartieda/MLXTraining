import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { loadLessonNamespace } from '@/lib/i18n'
import type { ModuleId } from '@/content/lessons/schema'
import { LearningPath } from './LearningPath'
import { ModuleView } from './ModuleView'

/**
 * The lessons route: the path, or one module.
 *
 * Its one job beyond routing is **loading the `lessons` namespace before rendering**
 * (R11). The seven modules are the largest block of translatable text in the product
 * and none of it is needed to reach a first prediction, so it is fetched on entry
 * here rather than shipped in the initial bundle that SC-008 gives three seconds on a
 * mid-range phone.
 *
 * Rendering before it resolves would show raw key paths — `modules.reading-a-heat-map.title`
 * — which is the same flash of untranslated text `main.tsx` awaits `initI18n` to
 * avoid, one route further in.
 */
export function LessonsPage() {
  const { moduleId } = useParams<{ moduleId?: string }>()
  const { t, i18n } = useTranslation('common')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    setReady(false)
    void loadLessonNamespace().then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
    // Re-runs on a language change: the namespace is loaded per locale, so switching
    // to Spanish mid-module needs the Spanish bundle fetched before the next paint.
  }, [i18n.language])

  if (!ready) {
    return (
      <p aria-live="polite" className="text-ink-muted">
        {t('action.loading')}
      </p>
    )
  }

  // An unknown slug still goes to `ModuleView`, which renders its own not-found
  // message. Redirecting to the path instead would silently swallow a broken link an
  // educator had pasted into a worksheet — she would never learn it was wrong.
  return moduleId === undefined ? <LearningPath /> : <ModuleView moduleId={moduleId as ModuleId} />
}
