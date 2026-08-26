import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Meter } from '@/components/Meter'
import { useOwnerId, useSession } from '@/features/auth/session'
import { LESSON_MODULES } from '@/content/lessons/modules'
import { moduleKey } from '@/content/lessons/schema'
import { fetchProgress, type ModuleProgress } from './progress'

/**
 * T096 / FR-034, Scenario 5.1 — the path, with completion state per module.
 *
 * **Nothing is locked.** The modules are ordered and each assumes the one before it,
 * but a learner arriving in week three of a workshop, or one who wants to see where
 * this is going, can open any of them. FR-037 already handles the real constraint —
 * a challenge that needs something she does not have says so and names the step —
 * which is a better mechanism than a padlock: it explains rather than refuses, and it
 * is checked against what her lab actually contains rather than against a tick she
 * may have forgotten to make.
 *
 * The counts are per module rather than one overall bar. "3 of 7 modules" hides
 * whether she is three modules in or scattered across seven, and the second is the
 * one an educator needs to see.
 */

export function LearningPath() {
  const { t } = useTranslation(['lessons', 'common'])
  const ownerId = useOwnerId()
  const status = useSession((state) => state.status)

  const [progress, setProgress] = useState<readonly ModuleProgress[]>([])

  useEffect(() => {
    if (status === 'loading' || ownerId === null) {
      setProgress([])
      return
    }
    let live = true
    void fetchProgress(ownerId).then((loaded) => {
      if (live) setProgress(loaded)
    })
    return () => {
      live = false
    }
  }, [ownerId, status])

  const byModule = new Map(progress.map((entry) => [entry.moduleId, entry]))
  const finished = LESSON_MODULES.filter(
    (module) => byModule.get(module.id)?.state === 'completed',
  ).length

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('lessons:path.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('lessons:path.intro')}</p>
      </header>

      {status !== 'loading' && ownerId === null ? (
        <p className="rounded-lg border border-amber bg-surface p-4 text-sm" data-testid="path-anonymous">
          {t('lessons:path.anonymous')}
        </p>
      ) : (
        <Meter
          label={t('lessons:path.overall')}
          value={finished / LESSON_MODULES.length}
          tone={finished === LESSON_MODULES.length ? 'good' : 'neutral'}
          valueText={t('lessons:path.modulesDone', {
            done: finished,
            total: LESSON_MODULES.length,
          })}
        />
      )}

      <ol className="flex list-none flex-col gap-3 p-0">
        {LESSON_MODULES.map((module) => {
          const entry = byModule.get(module.id)
          const done = entry?.completedSteps.length ?? 0
          const state = entry?.state ?? 'not_started'

          return (
            <li
              key={module.id}
              data-testid={`module-card-${module.id}`}
              className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-lg">
                  <Link to={`/lessons/${module.id}`} className="text-ink no-underline">
                    {module.order}. {t(`lessons:${moduleKey(module.id)}.title`)}
                  </Link>
                </h2>
                {/* A word, not a tick glyph. A green check needs a legend and reads
                    as decoration to a screen reader. */}
                <span
                  data-testid={`module-state-${module.id}`}
                  className={
                    state === 'completed'
                      ? 'text-sm font-medium text-green-700'
                      : 'text-sm text-ink-muted'
                  }
                >
                  {t(`lessons:state.${state}`)}
                </span>
              </div>

              <p className="max-w-prose text-sm text-ink-muted">
                {t(`lessons:${moduleKey(module.id)}.goal`)}
              </p>

              <p className="text-sm text-ink-muted">
                {t('lessons:path.stepsDone', { done, total: module.steps.length })}
              </p>

              <div className="mt-auto">
                <Link
                  to={`/lessons/${module.id}`}
                  className="flex min-h-touch w-fit items-center rounded bg-blue px-4 text-sm font-medium text-ink-inverse no-underline"
                >
                  {done === 0 ? t('lessons:path.start') : t('lessons:path.continue')}
                </Link>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
