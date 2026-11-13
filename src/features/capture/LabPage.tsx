import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button } from '@/components/Button'
import { TextLink } from '@/components/TextLink'
import { useTranslation } from 'react-i18next'
import { LabLayout } from '@/routes/AppShell'
import { ClassList } from './ClassList'
import { CameraCapture } from './CameraCapture'
import { UploadSamples } from './UploadSamples'
import { SampleGrid } from './SampleGrid'
import { TrainPanel } from '@/features/training/TrainPanel'
import { ResultsPanel } from '@/features/results/ResultsPanel'
import { LivePrediction } from '@/features/testing/LivePrediction'
import { FreezeFrame, type FrozenFrame } from '@/features/testing/FreezeFrame'
import { HeatmapView } from '@/features/explaining/HeatmapView'
import { CompareView } from '@/features/explaining/CompareView'
import { useLab } from '@/features/lab/labStore'
import { useBackbone } from '@/features/lab/useBackbone'
import { useOwnerId } from '@/features/auth/session'
import * as db from '@/lib/db'
import { CvChallenges } from '@/features/cvLab/CvChallenges'
import { CvMissions } from '@/features/cvLab/CvMissions'
import { challengeOfProject, datasetUrl, fetchManifest } from '@/features/cvLab/challenges'

/** The same three tabs as the Lab LLM: tools, challenges and missions. */
const LAB_TABS = ['tools', 'challenges', 'missions'] as const
type LabTab = (typeof LAB_TABS)[number]

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
  const navigate = useNavigate()
  const { t } = useTranslation(['capture', 'training', 'testing', 'explaining', 'cvlab'])
  const [tab, setTab] = useState<LabTab>('tools')
  const [testPhotos, setTestPhotos] = useState<readonly { url: string; label: string }[]>([])
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
  const startCameraRef = useRef<(() => void) | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [denied, setDenied] = useState(false)
  const [frozen, setFrozen] = useState<FrozenFrame | null>(null)
  const [resolvingDefaultProject, setResolvingDefaultProject] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [createProblem, setCreateProblem] = useState<string | null>(null)
  const registerStartCamera = useCallback((start: (() => void) | null) => {
    startCameraRef.current = start
  }, [])

  async function createFirstProject() {
    try {
      const created = await db.createProject(draftName.trim(), ownerId)
      void navigate(`/lab/${created.id}`)
    } catch (error) {
      if (error instanceof db.StorageError && error.code === 'INVALID_NAME') {
        setCreateProblem(
          draftName.trim().length === 0 ? t('projects:nameTooShort') : t('projects:nameTooLong'),
        )
      } else {
        setCreateProblem(t('common:error.generic', { ns: 'common' }))
      }
    }
  }

  useBackbone(settings.backboneAlpha)

  // A project loaded from a challenge offers that challenge's test photos to explain.
  useEffect(() => {
    setTestPhotos([])
    const challengeId = projectId ? challengeOfProject(projectId) : null
    if (!challengeId) return
    let live = true
    void fetchManifest(challengeId).then((manifest) => {
      if (!live || !manifest?.test) return
      setTestPhotos(
        manifest.test.map((photo, index) => ({
          url: datasetUrl(challengeId, photo.file),
          label: photo.label ?? t('cvlab:challenges.testPhoto', { number: index + 1 }),
        })),
      )
    })
    return () => {
      live = false
    }
  }, [projectId, t])

  useEffect(() => {
    if (projectId) {
      setResolvingDefaultProject(false)
      return
    }

    let live = true
    setResolvingDefaultProject(true)

    void (async () => {
      const projects = await db.listProjects(ownerId)
      if (!live) return
      const latest = projects[0]
      if (latest) {
        void navigate(`/lab/${latest.id}`, { replace: true })
        return
      }
      setResolvingDefaultProject(false)
    })()

    return () => {
      live = false
    }
  }, [projectId, ownerId, navigate])

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

  let tools: ReactNode
  if (!projectId) {
    if (resolvingDefaultProject) {
      tools = (
        <p aria-live="polite" className="text-sm text-ink-muted">
          {t('common:action.loading', { ns: 'common' })}
        </p>
      )
    } else {
      tools = (
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-2xl">{t('capture:panelTitle')}</h2>
          <p className="text-ink-muted">{t('projects:empty', { ns: 'projects' })}</p>
          <form
            className="flex max-w-md flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void createFirstProject()
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t('projects:nameLabel', { ns: 'projects' })}</span>
              <input
                value={draftName}
                maxLength={60}
                placeholder={t('projects:namePlaceholder', { ns: 'projects' })}
                onChange={(event) => {
                  setDraftName(event.target.value)
                }}
                className="min-h-touch rounded border border-border-subtle bg-surface px-2"
              />
            </label>
            {createProblem ? (
              <p role="alert" className="text-sm text-magenta">
                {createProblem}
              </p>
            ) : null}
            <div>
              <Button type="submit">{t('projects:create', { ns: 'projects' })}</Button>
            </div>
          </form>
          <TextLink to="/projects">{t('common:nav.projects', { ns: 'common' })}</TextLink>
        </div>
      )
    }
  } else if (denied) {
    tools = (
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-2xl">{t('common:error.notFound', { ns: 'common' })}</h2>
        <p className="text-ink-muted">{t('common:error.notFoundBody', { ns: 'common' })}</p>
        <TextLink to="/projects">{t('common:nav.projects', { ns: 'common' })}</TextLink>
      </div>
    )
  } else {
    tools = (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <TextLink to="/projects">{t('common:nav.projects', { ns: 'common' })}</TextLink>
          <h2 className="font-display text-2xl">{project?.name ?? ''}</h2>
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
              <CameraCapture
                videoRef={videoRef}
                onActiveChange={setCameraActive}
                onStartReady={registerStartCamera}
              />
              <UploadSamples />
              <SampleGrid />
            </div>
          }
          training={
            <div className="flex flex-col gap-4">
              <h2 id="panel-training" className="font-display text-lg">
                {t('training:panelTitle', { ns: 'training' })}
              </h2>
              <p className="text-sm text-ink-muted">
                {t('training:panelIntro', { ns: 'training' })}
              </p>
              <TrainPanel />
            </div>
          }
          results={
            <div className="flex flex-col gap-4">
              <ResultsPanel />
            </div>
          }
          testing={
            <div className="flex flex-col gap-4">
              <h2 id="panel-testing" className="font-display text-lg">
                {t('testing:panelTitle', { ns: 'testing' })}
              </h2>
              <p className="text-sm text-ink-muted">{t('testing:panelIntro', { ns: 'testing' })}</p>
              <LivePrediction
                video={cameraActive ? videoRef.current : null}
                onStartCamera={() => startCameraRef.current?.()}
              />
            </div>
          }
          explaining={
            <div className="flex flex-col gap-4">
              <h2 id="panel-explaining" className="font-display text-lg">
                {t('explaining:panelTitle', { ns: 'explaining' })}
              </h2>
              <p className="text-sm text-ink-muted">
                {t('explaining:panelIntro', { ns: 'explaining' })}
              </p>

              {/* US2. Freezing comes before explaining because an explanation of a
                live frame would describe a picture that no longer exists by the
                time it renders. */}
              <hr className="border-border-subtle" />
              <FreezeFrame
                video={cameraActive ? videoRef.current : null}
                frozen={frozen}
                onFreeze={setFrozen}
                testPhotos={testPhotos}
              />
              <HeatmapView frozen={frozen} />

              {/* US3. Below the single map on purpose: a learner meets one
                explanation before being asked to compare two. */}
              <hr className="border-border-subtle" />
              <CompareView frozen={frozen} />
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl">{t('cvlab:title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('cvlab:intro')}</p>
      </header>

      {/* Every panel stays mounted (hidden, not unmounted): the camera and the lab
          keep running while she reads a mission. */}
      <div role="tablist" aria-label={t('cvlab:tabs.label')} className="flex flex-wrap gap-2">
        {LAB_TABS.map((id) => (
          <Button
            key={id}
            role="tab"
            id={`cv-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`cv-panel-${id}`}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => {
              setTab(id)
            }}
          >
            {t(`cvlab:tabs.${id}`)}
          </Button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="cv-panel-tools"
        aria-labelledby="cv-tab-tools"
        hidden={tab !== 'tools'}
      >
        {tools}
      </div>
      <div
        role="tabpanel"
        id="cv-panel-challenges"
        aria-labelledby="cv-tab-challenges"
        hidden={tab !== 'challenges'}
      >
        <CvChallenges
          onLoaded={(id) => {
            setTab('tools')
            void navigate(`/lab/${id}`)
          }}
        />
      </div>
      <div
        role="tabpanel"
        id="cv-panel-missions"
        aria-labelledby="cv-tab-missions"
        hidden={tab !== 'missions'}
      >
        <CvMissions onGoTo={setTab} />
      </div>
    </div>
  )
}
