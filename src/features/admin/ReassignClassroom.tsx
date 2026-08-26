import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import {
  reassignClassroom,
  type AdminClassroom,
  type AdminFailure,
  type EducatorSummary,
} from './api'

/**
 * T134 / FR-057, K6, SC-018 — moving a classroom to another educator.
 *
 * This exists for one reason: **deactivating an educator must never leave a group of
 * learners unreadable by any adult.** Without it, an educator who leaves mid-term
 * takes her classroom's visibility with her, and the only remedy would be an
 * administrator with a route into classroom contents — which is exactly the role
 * FR-055 forbids. Reassignment is what lets that prohibition hold.
 *
 * **A name and an owner, and nothing else.** That is not a design choice about
 * density; it is the entire read surface `admin_classrooms` exposes (K5), and it
 * exposes no column from which a learner, a project or a reflection could be reached.
 * There is deliberately no learner count here either — a count is a fact about
 * learners, and the least she needs for this job is which classroom and whose.
 *
 * **No rename, no archive, no delete.** The view is not updatable and has no
 * `INSTEAD OF` trigger (K6), so `educator_id` is the only column an administrator may
 * write anywhere in the schema. A rename button here would fail; worse, it would
 * imply she has authority over a classroom's contents, and she has none.
 */

export function ReassignClassroom({
  classrooms,
  educators,
  onChanged,
}: {
  readonly classrooms: readonly AdminClassroom[]
  readonly educators: readonly EducatorSummary[]
  readonly onChanged: () => void
}) {
  const { t } = useTranslation(['admin', 'common'])
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>({})
  const [failure, setFailure] = useState<AdminFailure | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [moved, setMoved] = useState<string | null>(null)

  // Only an active educator can receive one — `reassign_classroom` refuses anyone
  // else, so offering an inactive account would be offering a failure.
  const receivers = educators.filter((educator) => educator.isActive)
  const nameOf = (id: string) =>
    educators.find((educator) => educator.id === id)?.displayName ??
    t('admin:educators.unnamed')

  async function move(classroom: AdminClassroom) {
    const target = selection[classroom.id]
    if (!target) return

    setBusy(classroom.id)
    setFailure(null)
    const problem = await reassignClassroom(classroom.id, target)
    setBusy(null)

    if (problem) {
      setFailure(problem)
      return
    }
    setMoved(classroom.name)
    onChanged()
  }

  return (
    <section aria-labelledby="reassign-heading" className="flex flex-col gap-3">
      <h2 id="reassign-heading" className="font-display text-lg">
        {t('admin:reassign.heading')}
      </h2>
      <p className="max-w-prose text-sm text-ink-muted">{t('admin:reassign.intro')}</p>

      {/* Said out loud, because an administrator looking at a list of classrooms will
          reasonably wonder why she cannot open one (FR-055). */}
      <p className="max-w-prose text-sm text-ink-muted" data-testid="admin-cannot-open">
        {t('admin:reassign.cannotOpen')}
      </p>

      {classrooms.length === 0 ? (
        <p className="max-w-prose text-sm text-ink-muted">{t('admin:reassign.empty')}</p>
      ) : (
        <ul role="list" className="flex list-none flex-col gap-3 p-0">
          {classrooms.map((classroom) => (
            <li
              key={classroom.id}
              data-testid={`admin-classroom-${classroom.id}`}
              className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3"
            >
              <div className="flex flex-col">
                <span className="font-medium">{classroom.name}</span>
                <span className="text-sm text-ink-muted">
                  {t('admin:reassign.currentOwner', { name: nameOf(classroom.educatorId) })}
                </span>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t('admin:reassign.newOwnerLabel')}</span>
                  <select
                    value={selection[classroom.id] ?? ''}
                    onChange={(event) => {
                      setSelection((current) => ({
                        ...current,
                        [classroom.id]: event.target.value,
                      }))
                    }}
                    className="min-h-touch rounded border border-border-subtle bg-surface px-2"
                  >
                    <option value="">{t('admin:reassign.choose')}</option>
                    {receivers
                      .filter((educator) => educator.id !== classroom.educatorId)
                      .map((educator) => (
                        <option key={educator.id} value={educator.id}>
                          {educator.displayName ?? t('admin:educators.unnamed')}
                        </option>
                      ))}
                  </select>
                </label>

                <Button
                  variant="secondary"
                  disabled={busy !== null || !selection[classroom.id]}
                  onClick={() => void move(classroom)}
                >
                  {busy === classroom.id
                    ? t('admin:reassign.moving')
                    : t('admin:reassign.submit')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className="text-sm text-ink-muted">
        {moved ? t('admin:reassign.moved', { name: moved }) : null}
      </p>
      {failure ? (
        <p role="alert" className="text-sm text-magenta" data-testid="reassign-failure">
          {t(`admin:failure.${failure}`)}
        </p>
      ) : null}
    </section>
  )
}
