import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { useLab } from '@/features/lab/labStore'
import { useOwnerId } from '@/features/auth/session'
import {
  CV_CHALLENGES,
  fetchManifest,
  loadChallenge,
  type ChallengeManifest,
  type CvChallenge,
  type LoadProgress,
} from './challenges'

/**
 * «Retos» of the Lab CV: each card tells the story of a prepared photo set and loads it
 * into a new project, ready to train and explain in «Herramientas».
 */
export function CvChallenges({ onLoaded }: { readonly onLoaded: (projectId: string) => void }) {
  const { t } = useTranslation('cvlab')
  const [manifests, setManifests] = useState<Record<string, ChallengeManifest | null> | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all(CV_CHALLENGES.map(async (challenge) => [challenge.id, await fetchManifest(challenge.id)] as const)).then(
      (entries) => {
        if (live) setManifests(Object.fromEntries(entries))
      },
    )
    return () => {
      live = false
    }
  }, [])

  return (
    <section aria-labelledby="cv-challenges-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="cv-challenges-title" className="font-display text-xl">{t('challenges.title')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('challenges.intro')}</p>
      </header>
      <ul className="grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
        {CV_CHALLENGES.map((challenge) => (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            manifest={manifests ? (manifests[challenge.id] ?? null) : undefined}
            onLoaded={onLoaded}
          />
        ))}
      </ul>
    </section>
  )
}

function ChallengeCard({
  challenge,
  manifest,
  onLoaded,
}: {
  readonly challenge: CvChallenge
  /** `undefined` while checking, `null` when the photos are not in place. */
  readonly manifest: ChallengeManifest | null | undefined
  readonly onLoaded: (projectId: string) => void
}) {
  const { t } = useTranslation('cvlab')
  const ownerId = useOwnerId()
  const backbone = useLab((state) => state.backbone)
  const [progress, setProgress] = useState<LoadProgress | null>(null)
  const [failed, setFailed] = useState(false)
  const base = `challenges.items.${challenge.id}`

  async function handleLoad() {
    if (!manifest || !backbone) return
    setFailed(false)
    setProgress({ done: 0, total: 1 })
    try {
      const classes = Object.fromEntries(challenge.classes.map((id) => [id, t(`${base}.classes.${id}`)]))
      const result = await loadChallenge(challenge, manifest, { project: t(`${base}.projectName`), classes }, backbone, ownerId, setProgress)
      onLoaded(result.projectId)
    } catch (error) {
      console.warn('Challenge failed to load:', error)
      setFailed(true)
    } finally {
      setProgress(null)
    }
  }

  const photoCount = manifest ? Object.values(manifest.classes).reduce((sum, files) => sum + files.length, 0) : 0

  return (
    <li data-testid={`cv-challenge-${challenge.id}`} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
      <h3 className="font-display text-lg">{t(`${base}.title`)}</h3>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t(`${base}.topic`)}</p>
      <p className="max-w-prose text-sm">{t(`${base}.story`)}</p>
      <p className="max-w-prose text-sm">
        <span className="font-medium">{t('challenges.taskLabel')}</span> {t(`${base}.task`)}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">{t('challenges.trapLabel')}</summary>
        <p className="mt-1 max-w-prose text-ink-muted">{t(`${base}.trap`)}</p>
      </details>

      {manifest === undefined ? <p className="text-sm text-ink-muted">{t('challenges.checking')}</p> : null}
      {manifest === null ? (
        <p data-testid="cv-challenge-missing" className="rounded border border-dashed border-border-subtle p-2 text-sm text-ink-muted">
          {t('challenges.missing', { folder: `public/datasets/${challenge.id}/` })}
        </p>
      ) : null}
      {manifest ? (
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <p className="text-sm text-ink-muted">{t('challenges.photos', { count: photoCount })}</p>
          {progress ? (
            <ProgressBar
              label={t('challenges.loadingLabel')}
              value={progress.done / Math.max(progress.total, 1)}
              detail={t('challenges.loading', { done: progress.done, total: progress.total })}
            />
          ) : (
            <div>
              <Button onClick={() => void handleLoad()} disabled={!backbone}>
                {t('challenges.load')}
              </Button>
            </div>
          )}
          {!backbone ? <p className="text-sm text-ink-muted">{t('challenges.waitBackbone')}</p> : null}
          {failed ? <p role="alert" className="text-sm text-magenta">{t('challenges.failed')}</p> : null}
        </div>
      ) : null}
    </li>
  )
}
