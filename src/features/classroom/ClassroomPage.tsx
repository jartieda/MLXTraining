import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Field } from '@/features/auth/Field'
import { useSession } from '@/features/auth/session'
import { MODULE_IDS } from '@/content/lessons/schema'
import {
  createClassroom,
  listClassrooms,
  listInvitations,
  listProgress,
  listReflections,
  listRoster,
  listRuns,
  renameClassroom,
  setClassroomArchived,
  type Classroom,
  type LearnerProgress,
  type LearnerReflection,
  type LearnerRun,
  type PendingInvitation,
  type RosterEntry,
} from './api'
import { buildClassroomCsv, classroomCsvBlob, classroomCsvFileName } from './export'
import { InviteLearner } from './InviteLearner'
import { Roster } from './Roster'

/**
 * T105, T110 / FR-038, FR-043, SC-013, Scenario 6.1, 6.4, 6.5 — the educator's screen.
 *
 * **SC-013 gives her three minutes from nothing to a usable classroom with its first
 * invitation**, and that budget is what shapes the layout. There is no wizard, no
 * separate "add learners" route and no settings page: the name field is the first
 * thing on an empty screen, and the invitation panel appears directly beneath the
 * classroom the moment it exists. Two fields and two buttons, in one place.
 *
 * **Zero rows means "not yours", never "empty"** (SC-011, FR-042, Scenario 6.4). The
 * policies refuse a cross-classroom read by returning nothing rather than by erroring,
 * so an interface that rendered an empty roster would show another educator's
 * classroom as an existing-but-empty one — a much worse answer than a refusal, because
 * it confirms the classroom exists. Here, a classroom id that returns no row is
 * reported as not found.
 */
export function ClassroomPage() {
  const { t } = useTranslation(['classroom', 'common'])
  const account = useSession((state) => state.account)
  const status = useSession((state) => state.status)

  const [classrooms, setClassrooms] = useState<readonly Classroom[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [roster, setRoster] = useState<readonly RosterEntry[]>([])
  const [invitations, setInvitations] = useState<readonly PendingInvitation[]>([])
  const [progress, setProgress] = useState<readonly LearnerProgress[]>([])
  const [reflections, setReflections] = useState<readonly LearnerReflection[]>([])
  const [runs, setRuns] = useState<readonly LearnerRun[]>([])

  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState(false)

  const educatorId = account?.role === 'educator' ? account.id : null

  const loadClassrooms = useCallback(async () => {
    if (!educatorId) {
      setClassrooms([])
      setLoading(false)
      return
    }
    const loaded = await listClassrooms(educatorId)
    setClassrooms(loaded)
    setSelectedId((current) => current ?? loaded[0]?.id ?? null)
    setLoading(false)
  }, [educatorId])

  const loadClassroom = useCallback(async () => {
    if (!educatorId || !selectedId) {
      setRoster([])
      setInvitations([])
      setProgress([])
      setReflections([])
      setRuns([])
      return
    }

    const [members, pending] = await Promise.all([
      listRoster(selectedId),
      listInvitations(educatorId, selectedId),
    ])
    setRoster(members)
    setInvitations(pending)

    // Three reads scoped to the learners the roster returned, which is itself scoped
    // by `is_educator_of`. Nothing here widens what the policies already decided.
    const learnerIds = members.map((entry) => entry.learnerId)
    const [progressRows, reflectionRows, runRows] = await Promise.all([
      listProgress(learnerIds),
      listReflections(learnerIds),
      listRuns(learnerIds),
    ])
    setProgress(progressRows)
    setReflections(reflectionRows)
    setRuns(runRows)
  }, [educatorId, selectedId])

  useEffect(() => {
    if (status === 'loading') return
    void loadClassrooms()
  }, [status, loadClassrooms])

  useEffect(() => {
    void loadClassroom()
  }, [loadClassroom])

  const selected = classrooms.find((classroom) => classroom.id === selectedId) ?? null

  async function create() {
    if (!educatorId) return
    const name = draftName.trim()
    if (name.length === 0) return

    const made = await createClassroom(educatorId, name)
    if (!made) {
      setProblem(true)
      return
    }
    setDraftName('')
    setProblem(false)
    setSelectedId(made.id)
    await loadClassrooms()
  }

  function exportCsv() {
    if (!selected) return
    const csv = buildClassroomCsv({
      classroomName: selected.name,
      roster,
      progress,
      reflections,
      runs,
      moduleIds: [...MODULE_IDS],
    })

    const blob = classroomCsvBlob(csv)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = classroomCsvFileName(selected.name, new Date().toISOString())
    link.click()
    // Released immediately: a leaked object URL holds the whole file in memory, and
    // an educator exporting once a lesson for a term would accumulate them.
    URL.revokeObjectURL(url)
  }

  if (status !== 'loading' && !educatorId) {
    // Not a redirect. An account that is not an educator has no classroom, and saying
    // so is more useful than bouncing her somewhere she did not ask to go.
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">{t('classroom:title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('common:error.forbidden')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('classroom:title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('classroom:intro')}</p>
      </header>

      {loading ? <p className="text-ink-muted">{t('common:action.loading')}</p> : null}

      {/* SC-013: on an empty account this is the first thing on the screen, and it is
          two fields away from a usable classroom with an invitation. */}
      {!loading && classrooms.length === 0 ? (
        <section aria-labelledby="first-classroom" className="flex max-w-xl flex-col gap-3">
          <h2 id="first-classroom" className="font-display text-lg">
            {t('classroom:create.firstHeading')}
          </h2>
          <p className="max-w-prose text-sm text-ink-muted">{t('classroom:create.firstIntro')}</p>
          <Field
            label={t('classroom:create.nameLabel')}
            hint={t('classroom:create.nameHint')}
            name="classroomName"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value)
            }}
            maxLength={60}
            autoFocus
          />
          <Button onClick={() => void create()} disabled={draftName.trim().length === 0}>
            {t('classroom:create.submit')}
          </Button>
        </section>
      ) : null}

      {classrooms.length > 0 ? (
        <section aria-labelledby="classroom-picker" className="flex flex-col gap-3">
          <h2 id="classroom-picker" className="sr-only">
            {t('classroom:create.pickerHeading')}
          </h2>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('classroom:create.pickerLabel')}</span>
              <select
                value={selectedId ?? ''}
                onChange={(event) => {
                  setSelectedId(event.target.value)
                }}
                className="min-h-touch rounded border border-border-subtle bg-surface px-2"
              >
                {classrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.archivedAt
                      ? t('classroom:create.archivedOption', { name: classroom.name })
                      : classroom.name}
                  </option>
                ))}
              </select>
            </label>

            <Field
              label={t('classroom:create.nameLabel')}
              name="newClassroomName"
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value)
              }}
              maxLength={60}
            />
            <Button variant="secondary" onClick={() => void create()} disabled={draftName.trim().length === 0}>
              {t('classroom:create.another')}
            </Button>
          </div>
        </section>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm text-magenta">
          {t('common:error.generic')}
        </p>
      ) : null}

      {selected ? (
        <>
          <section aria-labelledby="selected-classroom" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="selected-classroom" className="font-display text-xl">
                {selected.name}
              </h2>
              {selected.archivedAt ? (
                <span className="text-sm text-ink-muted" data-testid="archived-badge">
                  {t('classroom:create.archived')}
                </span>
              ) : null}
            </div>

            {renaming ? (
              <div className="flex max-w-xl flex-wrap items-end gap-2">
                <Field
                  label={t('classroom:create.renameLabel')}
                  name="renameClassroom"
                  value={renameDraft}
                  onChange={(event) => {
                    setRenameDraft(event.target.value)
                  }}
                  maxLength={60}
                  autoFocus
                />
                <Button
                  onClick={() => {
                    void renameClassroom(selected.id, renameDraft).then(async (ok) => {
                      if (!ok) setProblem(true)
                      setRenaming(false)
                      await loadClassrooms()
                    })
                  }}
                  disabled={renameDraft.trim().length === 0}
                >
                  {t('common:action.save')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRenaming(false)
                  }}
                >
                  {t('common:action.cancel')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRenameDraft(selected.name)
                    setRenaming(true)
                  }}
                >
                  {t('common:action.rename')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void setClassroomArchived(selected.id, selected.archivedAt === null).then(
                      loadClassrooms,
                    )
                  }}
                >
                  {selected.archivedAt
                    ? t('classroom:create.unarchive')
                    : t('classroom:create.archive')}
                </Button>
                <Button variant="secondary" onClick={exportCsv} disabled={roster.length === 0}>
                  {t('classroom:export.action')}
                </Button>
              </div>
            )}

            {/* Archiving hides a finished classroom; it does not touch a learner's
                work. Said here because "archive" next to "delete a learner" invites
                the wrong assumption about what it costs. */}
            {selected.archivedAt ? (
              <p className="max-w-prose text-sm text-ink-muted">{t('classroom:create.archivedNote')}</p>
            ) : null}

            <p className="max-w-prose text-sm text-ink-muted">{t('classroom:export.note')}</p>
          </section>

          {/* An archived classroom issues no invitations — `issue_learner_invitation`
              requires `archived_at is null`, so the panel is hidden rather than
              offered and then refused. */}
          {selected.archivedAt === null ? (
            <InviteLearner classroomId={selected.id} onIssued={() => void loadClassroom()} />
          ) : null}

          <Roster
            classroomId={selected.id}
            roster={roster}
            invitations={invitations}
            progress={progress}
            reflections={reflections}
            runs={runs}
            moduleIds={[...MODULE_IDS]}
            onChanged={() => void loadClassroom()}
          />
        </>
      ) : null}
    </div>
  )
}
