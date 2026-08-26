import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Meter } from '@/components/Meter'
import { useOwnerId, useSession } from '@/features/auth/session'
import * as db from '@/lib/db'
import {
  fetchRemoteProjects,
  projectsMadeElsewhere,
  pushProjectMetadata,
  type RemoteProject,
} from './remoteProjects'

/**
 * T040 / FR-023, FR-049, D1, D9 — the project list.
 *
 * Two properties are doing real work here.
 *
 * **Every read is scoped to the session's owner** (D9). `listProjects(ownerId)`
 * with a `null` owner returns anonymous work only, and with an id returns that
 * account's only. Shared devices are the norm in schools, so a learner signing in
 * after her classmate on the same Chromebook must not see her classmate's
 * projects — this is a privacy boundary, not bookkeeping.
 *
 * **The storage budget is visible before it bites** (FR-049). A learner losing
 * forty captured photos to a silent quota error mid-lesson is the worst failure
 * this product can have, because the loss is unrecoverable: nothing was backed up,
 * by design. So the indicator is on the page she starts from, and the delete
 * dialogue states exactly what will go.
 */

export function ProjectsPage() {
  const { t, i18n } = useTranslation('projects')
  const navigate = useNavigate()
  const ownerId = useOwnerId()
  const status = useSession((state) => state.status)

  const [projects, setProjects] = useState<readonly db.Project[]>([])
  const [counts, setCounts] = useState<Readonly<Record<string, ProjectSummary>>>({})
  const [estimate, setEstimate] = useState<db.StorageEstimate | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<db.Project | null>(null)
  const [deleted, setDeleted] = useState<string | null>(null)
  const [elsewhere, setElsewhere] = useState<readonly RemoteProject[]>([])

  const reload = useCallback(async () => {
    const loaded = await db.listProjects(ownerId)
    setProjects(loaded)

    const summary: Record<string, ProjectSummary> = {}
    for (const project of loaded) {
      const classes = await db.listClasses(project.id)
      const sampleCounts = await db.countSamplesByClass(project.id)
      // FR-031 names four things to restore, and the model status is the one that
      // is not derivable from a count. `activeRunId` alone is not enough: a run
      // interrupted mid-training leaves a record that must never read as ready
      // (FR-050).
      const model = project.activeRunId ? await db.loadModelRecord(project.activeRunId) : undefined
      summary[project.id] = {
        classes: classes.length,
        samples: Object.values(sampleCounts).reduce((a, b) => a + b, 0),
        model: model?.status ?? 'none',
      }
    }
    setCounts(summary)
    setEstimate(await db.estimateStorage())

    // FR-031, FR-032. Signed out, there is nothing remote to reconcile against —
    // and by FR-023 there must not be.
    if (ownerId === null) {
      setElsewhere([])
      return
    }

    await pushProjectMetadata(
      ownerId,
      loaded.map((project) => ({
        id: project.id,
        name: project.name,
        classCount: summary[project.id]?.classes ?? 0,
        sampleCount: summary[project.id]?.samples ?? 0,
      })),
    )
    setElsewhere(projectsMadeElsewhere(loaded, await fetchRemoteProjects(ownerId)))
  }, [ownerId])

  useEffect(() => {
    // Re-runs when the account changes, which is what makes the D9 scope hold
    // across a sign-in on a shared device rather than only on first load.
    if (status === 'loading') return
    void reload()
    // Asked once, on first sight of the list: it makes the browser less likely to
    // clear a learner's work without warning (R10).
    void db.requestPersistence()
  }, [status, reload])

  async function create() {
    const name = draft.trim()
    try {
      const project = await db.createProject(name, ownerId)
      setCreating(false)
      setDraft('')
      setProblem(null)
      await reload()
      setDeleted(null)
      // Straight into the lab: naming a project is not the goal, and a learner who
      // has just named one is about to make a class. Routed rather than assigned to
      // `location`, which would reload the whole application and re-download the
      // backbone she is about to need.
      void navigate(`/lab/${project.id}`)
    } catch (error) {
      if (error instanceof db.StorageError && error.code === 'INVALID_NAME') {
        setProblem(name.length === 0 ? t('nameTooShort') : t('nameTooLong'))
      } else {
        setProblem(t('common:error.generic'))
      }
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const name = pendingDelete.name
    await db.deleteProject(pendingDelete.id, {
      // D1: the saved TensorFlow.js artifact goes with the metadata. Injected
      // rather than imported so `db.ts` keeps no dependency on the ML layer.
      removeArtifact: async (key) => {
        const { removeSavedModel } = await import('@/features/training/artifacts')
        await removeSavedModel(key)
      },
    })
    setPendingDelete(null)
    setDeleted(name)
    await reload()
  }

  /**
   * Scenario 4.6 — "start a fresh copy".
   *
   * A *copy*, with its own id, not a claim on the remote row. Reusing the id would
   * overwrite counts recorded by the device that still holds the photos, so the
   * original stays exactly as it is and keeps showing as made elsewhere, which it
   * was. Two rows named the same thing is the honest outcome here.
   */
  async function startFreshCopy(remote: RemoteProject) {
    const project = await db.createProject(remote.name, ownerId)
    setElsewhere((current) => current.filter((candidate) => candidate.id !== remote.id))
    await reload()
    void navigate(`/lab/${project.id}`)
  }

  const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('intro')}</p>
      </header>

      {/* FR-023: stated plainly rather than nagging. An anonymous session is a
          supported way to use the whole lab, not a degraded one — but a learner
          must know before she captures forty photos that they live only here. */}
      {status === 'anonymous' ? (
        <section className="rounded-lg border border-amber bg-surface p-4">
          <h2 className="text-base font-semibold">{t('anonymousTitle')}</h2>
          <p className="mt-1 max-w-prose text-sm">{t('anonymousBody')}</p>
        </section>
      ) : null}

      {/* FR-049: the 80% warning and the 95% refusal, where she can act on them. */}
      {estimate?.known && estimate.ratio !== null ? (
        <section className="flex flex-col gap-2">
          <Meter
            label={t('common:storage.label')}
            value={estimate.ratio}
            tone={estimate.shouldRefuse ? 'warn' : estimate.shouldWarn ? 'warn' : 'neutral'}
            valueText={t('common:storage.used', {
              used: formatBytes(estimate.usage ?? 0),
              total: formatBytes(estimate.quota ?? 0),
            })}
          />
          {estimate.shouldRefuse ? (
            <p role="alert" className="text-sm text-magenta">
              {t('common:storage.refuse')}
            </p>
          ) : estimate.shouldWarn ? (
            <p className="text-sm text-orange">
              {t('common:storage.warn', { percent: Math.round(estimate.ratio * 100) })}
            </p>
          ) : null}
        </section>
      ) : estimate && !estimate.known ? (
        // D6: where the API is unavailable it says so rather than pretending to
        // know. Guessing would either block a learner with plenty of room or teach
        // her to ignore the warning that matters.
        <p className="text-sm text-ink-muted">{t('common:storage.unknown')}</p>
      ) : null}

      <section className="flex flex-col gap-3">
        {projects.length === 0 ? <p className="text-ink-muted">{t('empty')}</p> : null}

        <ul role="list" className="grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
          {projects.map((project) => {
            const summary = counts[project.id]
            return (
              <li
                key={project.id}
                className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
              >
                <h2 className="truncate font-display text-lg">{project.name}</h2>
                <p className="text-sm text-ink-muted">
                  {summary && summary.classes > 0
                    ? t('summary', { classes: summary.classes, samples: summary.samples })
                    : t('noClasses')}
                </p>
                <p className="text-sm text-ink-muted">
                  {t(`model.${summary?.model ?? 'none'}`)}
                </p>
                <p className="text-sm text-ink-muted">
                  {t('createdOn', { date: formatter.format(new Date(project.createdAt)) })}
                </p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Link
                    to={`/lab/${project.id}`}
                    className="flex min-h-touch items-center rounded bg-blue px-4 text-sm font-medium text-ink-inverse no-underline"
                  >
                    {t('openLab')}
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPendingDelete(project)
                    }}
                  >
                    {t('common:action.delete')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>

        {creating ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle p-4">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t('nameLabel')}</span>
              <input
                autoFocus
                value={draft}
                placeholder={t('namePlaceholder')}
                maxLength={60}
                onChange={(event) => {
                  setDraft(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create()
                  if (event.key === 'Escape') setCreating(false)
                }}
                className="min-h-touch rounded border border-border-subtle bg-surface px-2"
              />
            </label>
            {problem ? (
              <p role="alert" className="text-sm text-magenta">
                {problem}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={() => void create()}>{t('common:action.save')}</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setCreating(false)
                }}
              >
                {t('common:action.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => {
              setCreating(true)
            }}
            disabled={estimate?.shouldRefuse === true}
          >
            {t('create')}
          </Button>
        )}

        <p aria-live="polite" className="text-sm text-ink-muted">
          {deleted ? t('deleted', { name: deleted }) : null}
        </p>
      </section>

      {/* FR-032 / Scenario 4.6. Kept below her own projects and visually distinct
          from them, because these are not projects on this device — presenting
          them in the same list would make "open in the lab" look available and
          then produce an empty one. */}
      {elsewhere.length > 0 ? (
        <section aria-labelledby="made-elsewhere" className="flex flex-col gap-3">
          <h2 id="made-elsewhere" className="font-display text-lg">
            {t('restoreTitle')}
          </h2>
          <ul role="list" className="grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
            {elsewhere.map((remote) => (
              <li
                key={remote.id}
                className="flex flex-col gap-2 rounded-lg border border-dashed border-border-subtle bg-surface-sunken p-4"
              >
                <h3 className="truncate font-display text-base">{remote.name}</h3>
                <p className="max-w-prose text-sm">{t('restoreBody', { name: remote.name })}</p>
                <p className="text-sm text-ink-muted">
                  {t('restoreRecorded', {
                    classes: remote.classCount,
                    samples: remote.sampleCount,
                  })}
                </p>
                <div className="mt-auto">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void startFreshCopy(remote)
                    }}
                  >
                    {t('restoreAction')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog
        open={pendingDelete !== null}
        title={t('deleteTitle', { name: pendingDelete?.name ?? '' })}
        closeLabel={t('common:action.close')}
        dismissOnBackdrop={false}
        onClose={() => {
          setPendingDelete(null)
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPendingDelete(null)
              }}
            >
              {t('common:action.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              {t('deleteConfirm')}
            </Button>
          </>
        }
      >
        {/* The photo count and the "nothing was uploaded" fact together: the second
            is what makes the first irreversible, and a learner deserves both
            before she confirms. */}
        <p>
          {t('deleteBody', {
            count: pendingDelete ? (counts[pendingDelete.id]?.samples ?? 0) : 0,
          })}
        </p>
      </Dialog>
    </div>
  )
}

/** What one project card shows, all of it derived from the local store. */
interface ProjectSummary {
  readonly classes: number
  readonly samples: number
  /** `'none'` rather than `null`, so it maps straight onto a locale key. */
  readonly model: db.ModelStatus | 'none'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'GB'}`
}
