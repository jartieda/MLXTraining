import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TextLink } from '@/components/TextLink'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { useOwnerId, useSession } from '@/features/auth/session'
import { RunComparison } from '@/features/results/RunComparison'
import * as db from '@/lib/db'
import { MODULE_BY_ID, previousModule } from '@/content/lessons/modules'
import { moduleKey, stepKey, type LessonStep, type ModuleId } from '@/content/lessons/schema'
import { missing, readCapabilities, NO_CAPABILITIES, type Capabilities } from './capabilities'
import { Reflection } from './Reflection'
import {
  fetchProgress,
  fetchReflections,
  saveProgress,
  saveReflection,
  type Reflection as StoredReflection,
} from './progress'

/**
 * T097, T099, T100 / FR-034, FR-035, FR-036, FR-037.
 *
 * One module: its goal, its steps, its challenge, its reflection questions — the four
 * things FR-034 requires, in that order, because the order is the teaching.
 *
 * **Steps are ticked by the learner, not inferred.** The lab cannot tell whether she
 * *understood* a step, only whether an artefact exists, so inferring completion would
 * mark "notice what the heat map is warm on" done the moment a map rendered. She ticks
 * it; the tick autosaves (FR-035). What the lab *does* check is whether the challenge
 * is even possible — that is FR-037, and it is a different question from whether she
 * has read the step.
 *
 * **A missing prerequisite names the step that produces it** (FR-037, Scenario 5.4).
 * Not "you need a trained model" — "go and finish *Train it* in *What the model sees*",
 * as a link. A 12-year-old told she needs a trained model has been told nothing about
 * where models come from.
 */

const WHERE_ROUTE: Record<'lab' | 'projects' | 'results', string> = {
  lab: '/lab',
  projects: '/projects',
  // The results live in the lab's training column (US7), so this is the same route
  // with a fragment rather than a page of its own.
  results: '/lab#panel-results',
}

export function ModuleView({ moduleId }: { readonly moduleId: ModuleId }) {
  const { t } = useTranslation(['lessons', 'common'])
  const ownerId = useOwnerId()
  const status = useSession((state) => state.status)

  const module = MODULE_BY_ID.get(moduleId)

  const [completed, setCompleted] = useState<readonly string[]>([])
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({})
  const [capabilities, setCapabilities] = useState<Capabilities>(NO_CAPABILITIES)
  const [runs, setRuns] = useState<readonly db.ModelRecord[]>([])
  const [loading, setLoading] = useState(true)

  const canSave = ownerId !== null

  useEffect(() => {
    if (status === 'loading') return
    let live = true

    void (async () => {
      // Statically imported: `progress.ts` is already in this chunk by way of
      // `LearningPath` and `Reflection`, so a dynamic import here split nothing and
      // only made Vite warn about it.
      const [caps, progress, reflections] = await Promise.all([
        readCapabilities(ownerId),
        canSave ? fetchProgress(ownerId) : Promise.resolve([]),
        canSave ? fetchReflections(ownerId) : Promise.resolve([]),
      ])
      if (!live) return

      setCapabilities(caps)
      setCompleted(progress.find((entry) => entry.moduleId === moduleId)?.completedSteps ?? [])
      setAnswers(
        Object.fromEntries(
          reflections
            .filter((entry: StoredReflection) => entry.moduleId === moduleId)
            .map((entry: StoredReflection) => [entry.questionId, entry.answer]),
        ),
      )
      setLoading(false)
    })()

    return () => {
      live = false
    }
  }, [moduleId, ownerId, canSave, status])

  /**
   * FR-036 / T100 — the fairness module embeds US7's run comparison.
   *
   * The same component the lab renders, not a copy: the before-and-after IS the
   * comparison view, and a second implementation would be a second thing to keep
   * correct. Loaded only for the module that asks for it.
   */
  const showsComparison = module?.showsRunComparison ?? false
  useEffect(() => {
    if (!showsComparison) return
    let live = true
    void (async () => {
      const projects = await db.listProjects(ownerId)
      const all: db.ModelRecord[] = []
      for (const project of projects) all.push(...(await db.listFinishedRuns(project.id)))
      if (live) setRuns(all)
    })()
    return () => {
      live = false
    }
  }, [showsComparison, ownerId, capabilities])

  const toggleStep = useCallback(
    (slug: string) => {
      setCompleted((current) => {
        const next = current.includes(slug)
          ? current.filter((entry) => entry !== slug)
          : [...current, slug]
        // Autosaved, with no button anywhere (FR-035). Fire and forget: a failed
        // write must not undo the tick under her cursor, and the next tick retries
        // the whole list anyway.
        if (canSave && module) void saveProgress(ownerId, moduleId, next, module.steps.length)
        return next
      })
    },
    [canSave, module, moduleId, ownerId],
  )

  const storeAnswer = useCallback(
    async (questionId: string, answer: string) => {
      setAnswers((current) => ({ ...current, [questionId]: answer }))
      if (!canSave) return false
      return saveReflection(ownerId, moduleId, questionId, answer)
    },
    [canSave, moduleId, ownerId],
  )

  if (!module) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">{t('common:error.notFound')}</h1>
        <TextLink to="/lessons">{t('lessons:path.backToPath')}</TextLink>
      </div>
    )
  }

  const key = moduleKey(moduleId)
  const unmet = missing(module.challengeRequires, capabilities)
  const previous = previousModule(moduleId)

  return (
    <article className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">
          {t('lessons:path.moduleNumber', { number: module.order, total: 7 })}
        </p>
        <h1 className="font-display text-2xl">{t(`lessons:${key}.title`)}</h1>

        {/* FR-034's first obligation, and it leads because a learner who does not
            know what she is about to learn is following instructions rather than
            learning. */}
        <section aria-labelledby="module-goal" className="rounded-lg border border-border-subtle bg-surface p-4">
          <h2 id="module-goal" className="text-base font-semibold">
            {t('lessons:path.goalHeading')}
          </h2>
          <p className="mt-1">{t(`lessons:${key}.goal`)}</p>
        </section>

        <p className="max-w-prose text-ink-muted">{t(`lessons:${key}.intro`)}</p>
      </header>

      {/* An anonymous visitor may read every word; nothing is recorded. Said once,
          plainly, rather than on every control. */}
      {status !== 'loading' && !canSave ? (
        <p className="rounded-lg border border-amber bg-surface p-4 text-sm" data-testid="lessons-anonymous">
          {t('lessons:path.anonymous')}
        </p>
      ) : null}

      <section aria-labelledby="module-steps" className="flex flex-col gap-3">
        <h2 id="module-steps" className="font-display text-lg">
          {t('lessons:path.stepsHeading')}
        </h2>

        <ProgressBar
          label={t('lessons:path.stepProgress')}
          value={module.steps.length === 0 ? null : completed.length / module.steps.length}
          detail={t('lessons:path.stepsDone', {
            done: completed.length,
            total: module.steps.length,
          })}
        />

        <ol role="list" className="flex list-none flex-col gap-3 p-0">
          {module.steps.map((step, index) => (
            <StepRow
              key={step.slug}
              moduleId={moduleId}
              step={step}
              number={index + 1}
              done={completed.includes(step.slug)}
              onToggle={toggleStep}
            />
          ))}
        </ol>
      </section>

      <section aria-labelledby="module-challenge" className="flex flex-col gap-3">
        <h2 id="module-challenge" className="font-display text-lg">
          {t('lessons:path.challengeHeading')}
        </h2>
        <p className="max-w-prose">{t(`lessons:${key}.challenge`)}</p>

        {/* FR-037 / Scenario 5.4. Rendered only once the capability read has
            finished, so a slow IndexedDB does not flash "you need a trained model"
            at a learner who has three. */}
        {loading ? (
          <p className="text-sm text-ink-muted">{t('common:action.loading')}</p>
        ) : unmet.length > 0 ? (
          <div
            role="status"
            data-testid="challenge-blocked"
            className="flex flex-col gap-2 rounded-lg border border-amber bg-surface p-4"
          >
            <p className="font-medium">{t('lessons:path.notYetHeading')}</p>
            <ul role="list" className="flex list-none flex-col gap-2 p-0">
              {unmet.map((prerequisite) => {
                const target = prerequisite.satisfiedBy
                return (
                  <li
                    key={`${prerequisite.kind}-${target.stepSlug}`}
                    className="flex flex-col gap-1 text-sm"
                  >
                    <span>
                      {t(`lessons:prerequisite.${prerequisite.kind}`, {
                        count: prerequisite.count ?? 0,
                      })}
                    </span>
                    {/* The step, named, as a link. This is the whole of FR-037.
                        On its own line rather than mid-sentence, so it can carry
                        the 44 px floor without stretching the line it sits in
                        (FR-046) — and a link on its own line is easier to find
                        when you are stuck, which is when this renders. */}
                    <TextLink to={`/lessons/${target.moduleId}`} data-testid="prerequisite-link">
                      {t('lessons:path.goToStep', {
                        step: t(`lessons:${stepKey(target.moduleId, target.stepSlug)}.title`),
                        module: t(`lessons:${moduleKey(target.moduleId)}.title`),
                      })}
                    </TextLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <p className="text-sm font-medium" data-testid="challenge-ready">
            {t('lessons:path.challengeReady')}
          </p>
        )}
      </section>

      {/* FR-036: the before-and-after, in the module that argues from it. */}
      {showsComparison ? (
        <section aria-labelledby="module-comparison" className="flex flex-col gap-3">
          <h2 id="module-comparison" className="font-display text-lg">
            {t('lessons:path.comparisonHeading')}
          </h2>
          <p className="max-w-prose text-sm text-ink-muted">
            {t('lessons:path.comparisonIntro')}
          </p>
          <RunComparison runs={runs} />
        </section>
      ) : null}

      <section aria-labelledby="module-reflection" className="flex flex-col gap-5">
        <h2 id="module-reflection" className="font-display text-lg">
          {t('lessons:path.reflectionHeading')}
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('lessons:path.reflectionIntro')}</p>

        {module.questionIds.map((questionId) => (
          <Reflection
            key={questionId}
            moduleId={moduleId}
            questionId={questionId}
            initialAnswer={answers[questionId] ?? ''}
            onSave={storeAnswer}
            canSave={canSave}
          />
        ))}
      </section>

      <nav aria-label={t('lessons:path.moduleNav')} className="flex flex-wrap gap-3">
        <TextLink to="/lessons">{t('lessons:path.backToPath')}</TextLink>
        {previous ? (
          <TextLink to={`/lessons/${previous.id}`}>
            {t('lessons:path.previous', { module: t(`lessons:${moduleKey(previous.id)}.title`) })}
          </TextLink>
        ) : null}
      </nav>
    </article>
  )
}

function StepRow({
  moduleId,
  step,
  number,
  done,
  onToggle,
}: {
  readonly moduleId: ModuleId
  readonly step: LessonStep
  readonly number: number
  readonly done: boolean
  readonly onToggle: (slug: string) => void
}) {
  const { t } = useTranslation('lessons')
  const key = stepKey(moduleId, step.slug)

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface p-3">
      {/* FR-046: the LABEL is the touch target, not the box. A 44 px checkbox is
          not a checkbox any learner recognises, and the whole row is tappable —
          so the floor belongs on the row. `py-2` is what actually clears it once
          a one-line step title is the only content. */}
      <label className="flex min-h-touch items-start gap-3 py-2">
        {/* A real checkbox, so it is keyboard-operable and announced as checked
            without any of it being hand-rolled (SC-009). */}
        <input
          type="checkbox"
          checked={done}
          onChange={() => {
            onToggle(step.slug)
          }}
          className="mt-1 size-5 shrink-0"
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">
            {number}. {t(`${key}.title`)}
          </span>
          <span className="text-sm text-ink-muted">{t(`${key}.body`)}</span>
        </span>
      </label>

      {/* A route to where the step happens. A step that says "capture ten photos"
          and leaves her to find the capture panel is a step she abandons. */}
      {step.where ? (
        <div className="pl-8">
          <TextLink to={WHERE_ROUTE[step.where]} className="text-sm">
            {t(`path.goTo.${step.where}`)}
          </TextLink>
        </div>
      ) : null}
    </li>
  )
}

/** Exported for the path view's "start where you left off" affordance. */
export function ModuleActions({ moduleId }: { readonly moduleId: ModuleId }) {
  const { t } = useTranslation('lessons')
  return (
    <Link to={`/lessons/${moduleId}`}>
      <Button variant="secondary">{t('path.open')}</Button>
    </Link>
  )
}
