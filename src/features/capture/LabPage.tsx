import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LabLayout } from '@/routes/AppShell'
import { ClassList } from './ClassList'
import { CameraCapture } from './CameraCapture'
import { UploadSamples } from './UploadSamples'
import { SampleGrid } from './SampleGrid'
import { TrainPanel } from '@/features/training/TrainPanel'
import { LivePrediction } from '@/features/testing/LivePrediction'
import { useLab } from '@/features/lab/labStore'
import { useBackbone } from '@/features/lab/useBackbone'
import { useOwnerId } from '@/features/auth/session'
import * as db from '@/lib/db'

/**
 * The lab — US1's three panels in one screen.
 *
 * The panel order is the order of the work: show it examples, train it, try it
 * out. Below `md` they stack in that order, so scrolling down a phone follows
 * what a learner is actually doing rather than a desktop column order that
 * happens to read left to right (FR-045, SC-004).
 *
 * The `<video>` element is owned here rather than inside `CameraCapture`, because
 * the live-prediction panel samples the same element. Two `<video>`s bound to one
 * `MediaStream` would double the decode cost for nothing, and on a phone that is
 * a stuttering preview.
 */
export function LabPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  const { t } = useTranslation(['capture', 'training', 'testing'])
  const ownerId = useOwnerId()

  const {
    project,
    settings,
    staleEmbeddings,
    openProject,
    closeProject,
    backboneLoading,
    backboneError,
  } = useLab()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [denied, setDenied] = useState(false)

  useBackbone(settings.backboneAlpha)

  useEffect(() => {
    if (!projectId) return
    let live = true

    void (async () => {
      // D9: a project id arriving from a URL or a stale bookmark must not open
      // another account's work on a shared device.
      const owned = await db.getProject(projectId, ownerId)
      if (!live) return
      if (!owned) {
        setDenied(true)
        return
      }
      setDenied(false)
      await openProject(projectId)
    })()

    return () => {
      live = false
    }
  }, [projectId, ownerId, openProject])

  // Disposes the backbone and the model on leaving the lab. The store owns both,
  // and this is the only place their lifetime ends (R8).
  useEffect(() => closeProject, [closeProject])

  if (!projectId) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">{t('capture:panelTitle')}</h1>
        <p className="text-ink-muted">{t('projects:empty', { ns: 'projects' })}</p>
        <Link to="/projects" className="text-blue">
          {t('common:nav.projects', { ns: 'common' })}
        </Link>
      </div>
    )
  }

  if (denied) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">{t('common:error.notFound', { ns: 'common' })}</h1>
        <p className="text-ink-muted">{t('common:error.notFoundBody', { ns: 'common' })}</p>
        <Link to="/projects" className="text-blue">
          {t('common:nav.projects', { ns: 'common' })}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl">{project?.name ?? ''}</h1>
        <p className="text-sm text-ink-muted">{t('common:privacy.onDevice', { ns: 'common' })}</p>
      </header>

      {/* D4: after a detail-level change the cached embeddings are stale and are
          recomputed lazily. Stated rather than hidden, and with the reassurance
          that matters — the photos themselves are safe. */}
      {staleEmbeddings > 0 ? (
        <p className="rounded border border-orange p-2 text-sm">
          {t('training:recompute.body', { ns: 'training' })}
        </p>
      ) : null}

      {backboneLoading ? (
        <p aria-live="polite" className="text-sm text-ink-muted">
          {t('common:backend.checking', { ns: 'common' })}
        </p>
      ) : null}

      {/* Nothing in the lab works without the backbone, so this is stated plainly
          rather than left as two disabled buttons. */}
      {backboneError ? (
        <div role="alert" className="rounded border border-magenta p-3">
          <p className="text-sm font-semibold">{t('common:error.title', { ns: 'common' })}</p>
          <p className="text-sm">{t('common:error.generic', { ns: 'common' })}</p>
          <p className="mt-1 text-xs text-ink-muted">{backboneError}</p>
        </div>
      ) : null}

      <LabLayout
        capture={
          <div className="flex flex-col gap-4">
            <h2 id="panel-capture" className="font-display text-lg">
              {t('capture:panelTitle')}
            </h2>
            <p className="text-sm text-ink-muted">{t('capture:panelIntro')}</p>
            <ClassList />
            <CameraCapture videoRef={videoRef} onActiveChange={setCameraActive} />
            <UploadSamples />
            <SampleGrid />
          </div>
        }
        testing={
          <div className="flex flex-col gap-4">
            <h2 id="panel-testing" className="font-display text-lg">
              {t('training:panelTitle', { ns: 'training' })}
            </h2>
            <p className="text-sm text-ink-muted">{t('training:panelIntro', { ns: 'training' })}</p>
            <TrainPanel />
          </div>
        }
        explaining={
          <div className="flex flex-col gap-4">
            <h2 id="panel-explaining" className="font-display text-lg">
              {t('testing:panelTitle', { ns: 'testing' })}
            </h2>
            <p className="text-sm text-ink-muted">{t('testing:panelIntro', { ns: 'testing' })}</p>
            {/* The heat map joins this panel with US2 (T056). Live prediction is
                US1's end state and is a complete, demonstrable product on its own. */}
            <LivePrediction video={cameraActive ? videoRef.current : null} />
          </div>
        }
      />
    </div>
  )
}
