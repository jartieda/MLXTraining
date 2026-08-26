import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Meter } from '@/components/Meter'
import { CopyToClipboard } from '@/components/CopyToClipboard'
import { invitationTtlHours } from '@/lib/supabase'
import {
  deleteLearner,
  issuePasswordReset,
  removeFromClassroom,
  type LearnerProgress,
  type LearnerReflection,
  type LearnerRun,
  type RosterEntry,
} from './api'

/**
 * T108, T109 / FR-040, FR-041, FR-030, FR-039, FR-052, Scenario 6.3, 6.6, 6.7.
 *
 * Everything FR-040 requires about one learner — module completion, the accuracy
 * figures she recorded, her reflection answers — and **nothing that could be an
 * image**.
 *
 * FR-041's "no view makes a learner's captured images reachable" is enforced three
 * ways here, in decreasing order of strength. It is true by architecture: the images
 * are in her IndexedDB on her device and the educator's browser has no channel to it.
 * It is true by schema: no table has a `bytea` column or an image-shaped text column
 * (G2), asserted structurally in `tests/db/schema.test.ts`. And it is true by lint:
 * `src/features/classroom/` may not import `@/lib/db`, which closes the one case the
 * architecture does not — a shared classroom Chromebook where the educator's browser
 * *does* hold a learner's local store from the previous lesson.
 *
 * The two destructive actions are deliberately different weights. Removing from the
 * classroom deletes one row and is described as ending her own visibility; deleting the
 * account is behind a confirmation that states what it destroys and, just as
 * importantly, what it cannot reach.
 */

export function LearnerDetail({
  classroomId,
  learner,
  progress,
  reflections,
  runs,
  moduleIds,
  onChanged,
}: {
  readonly classroomId: string
  readonly learner: RosterEntry
  readonly progress: readonly LearnerProgress[]
  readonly reflections: readonly LearnerReflection[]
  readonly runs: readonly LearnerRun[]
  readonly moduleIds: readonly string[]
  readonly onChanged: () => void
}) {
  const { t, i18n } = useTranslation(['classroom', 'lessons', 'common'])

  const [resetCode, setResetCode] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(false)

  const mine = {
    progress: progress.filter((entry) => entry.learnerId === learner.learnerId),
    reflections: reflections.filter((entry) => entry.learnerId === learner.learnerId),
    runs: runs.filter((entry) => entry.learnerId === learner.learnerId),
  }

  const completed = mine.progress.filter((entry) => entry.state === 'completed').length
  const bestAccuracy =
    mine.runs.length === 0 ? null : Math.max(...mine.runs.map((run) => run.overallAccuracy))
  const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  async function reset() {
    setBusy(true)
    setProblem(false)
    const result = await issuePasswordReset(learner.learnerId)
    setBusy(false)
    if (result.ok) setResetCode(result.code)
    else setProblem(true)
  }

  async function remove() {
    setBusy(true)
    const ok = await removeFromClassroom(classroomId, learner.learnerId)
    setBusy(false)
    setConfirmRemove(false)
    if (ok) onChanged()
    else setProblem(true)
  }

  async function destroy() {
    setBusy(true)
    const ok = await deleteLearner(learner.learnerId)
    setBusy(false)
    setConfirmDelete(false)
    if (ok) onChanged()
    else setProblem(true)
  }

  return (
    <section
      aria-labelledby={`learner-${learner.learnerId}`}
      data-testid={`learner-detail-${learner.learnerId}`}
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        {/* Her alias. There is no username in scope here — `listRoster` does not ask
            for the column (FR-025). */}
        <h3 id={`learner-${learner.learnerId}`} className="font-display text-lg">
          {learner.alias}
        </h3>
        {!learner.isActive ? (
          <span className="text-sm text-ink-muted">{t('classroom:roster.inactive')}</span>
        ) : null}
      </header>

      {/* FR-041, said out loud. An educator wondering whether she can see a learner's
          photographs deserves an answer rather than an absence she has to interpret. */}
      <p className="max-w-prose text-sm text-ink-muted" data-testid="no-images-note">
        {t('classroom:detail.noImages')}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t('classroom:detail.progressHeading')}</h4>
          <Meter
            label={t('classroom:detail.modulesDone')}
            value={moduleIds.length === 0 ? 0 : completed / moduleIds.length}
            valueText={`${String(completed)} / ${String(moduleIds.length)}`}
          />
          <ul className="flex list-none flex-col gap-1 p-0 text-sm">
            {mine.progress.length === 0 ? (
              <li className="text-ink-muted">{t('classroom:detail.noProgress')}</li>
            ) : null}
            {mine.progress.map((entry) => (
              <li key={entry.moduleId} className="flex flex-wrap justify-between gap-2">
                <span>{t(`lessons:modules.${entry.moduleId}.title`, entry.moduleId)}</span>
                <span className="text-ink-muted">{t(`lessons:state.${entry.state}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t('classroom:detail.figuresHeading')}</h4>
          {mine.runs.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('classroom:detail.noRuns')}</p>
          ) : (
            <>
              <p className="text-sm">
                {t('classroom:detail.bestAccuracy', {
                  accuracy: bestAccuracy === null ? '—' : Math.round(bestAccuracy * 100),
                  runs: mine.runs.length,
                })}
              </p>
              <ul className="flex list-none flex-col gap-1 p-0 text-sm">
                {mine.runs.slice(0, 5).map((run) => (
                  <li key={`${run.projectName}-${run.finishedAt}`} className="text-ink-muted">
                    {t('classroom:detail.runLine', {
                      project: run.projectName,
                      accuracy: Math.round(run.overallAccuracy * 100),
                      date: formatter.format(new Date(run.finishedAt)),
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">{t('classroom:detail.reflectionsHeading')}</h4>
        {mine.reflections.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('classroom:detail.noReflections')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {mine.reflections.map((entry) => (
              <li key={`${entry.moduleId}-${entry.questionId}`} className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  {t(`lessons:modules.${entry.moduleId}.questions.${entry.questionId}`, entry.questionId)}
                </p>
                {/* Her words, rendered as text. React escapes, so a reflection
                    beginning with `<` or `=` is displayed, never interpreted — the
                    same hostility the CSV export neutralises, harmless here. */}
                <p className="max-w-prose text-sm whitespace-pre-wrap">{entry.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void reset()} disabled={busy}>
          {t('classroom:detail.issueReset')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setConfirmRemove(true)
          }}
          disabled={busy}
        >
          {t('classroom:detail.remove')}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setConfirmDelete(true)
          }}
          disabled={busy}
        >
          {t('classroom:detail.delete')}
        </Button>
      </div>

      {problem ? (
        <p role="alert" className="text-sm text-magenta">
          {t('common:error.generic')}
        </p>
      ) : null}

      {/* FR-030: a reset code, handed over in person. Same once-only rule as an
          invitation, because it is the same mechanism. */}
      <Dialog
        open={resetCode !== null}
        title={t('classroom:detail.resetTitle', { alias: learner.alias })}
        closeLabel={t('common:action.close')}
        onClose={() => {
          setResetCode(null)
        }}
      >
        <div className="flex flex-col gap-3">
          <p className="font-medium">{t('classroom:invite.shownOnce')}</p>
          <p className="font-mono text-2xl tracking-[0.3em] uppercase" data-testid="reset-code">
            {resetCode ?? ''}
          </p>
          <CopyToClipboard value={resetCode ?? ''} label={t('common:action.copy')} />
          <p className="text-sm text-ink-muted">
            {t('classroom:invite.expiry', { hours: invitationTtlHours() })}
          </p>
          <p className="text-sm text-ink-muted">{t('classroom:detail.resetNote')}</p>
        </div>
      </Dialog>

      <Dialog
        open={confirmRemove}
        title={t('classroom:detail.removeTitle', { alias: learner.alias })}
        closeLabel={t('common:action.close')}
        dismissOnBackdrop={false}
        onClose={() => {
          setConfirmRemove(false)
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmRemove(false)
              }}
            >
              {t('common:action.cancel')}
            </Button>
            <Button onClick={() => void remove()} disabled={busy}>
              {t('classroom:detail.removeConfirm')}
            </Button>
          </>
        }
      >
        {/* Scenario 6.6: what ends is her visibility, and nothing else. Saying that
            plainly is what keeps this action distinguishable from the one below. */}
        <p>{t('classroom:detail.removeBody', { alias: learner.alias })}</p>
      </Dialog>

      <Dialog
        open={confirmDelete}
        title={t('classroom:detail.deleteTitle', { alias: learner.alias })}
        closeLabel={t('common:action.close')}
        dismissOnBackdrop={false}
        onClose={() => {
          setConfirmDelete(false)
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmDelete(false)
              }}
            >
              {t('common:action.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void destroy()} disabled={busy}>
              {t('classroom:detail.deleteConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p>{t('classroom:detail.deleteBody', { alias: learner.alias })}</p>
          {/* Scenario 6.7. The deletion cannot reach her device, and an educator who
              believed otherwise would tell a learner her photographs were gone when
              they are not — or fail to tell her they are still there. */}
          <p className="font-medium">{t('classroom:detail.deleteLocalNote')}</p>
        </div>
      </Dialog>
    </section>
  )
}
