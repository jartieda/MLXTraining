import { useEffect, useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { listExperiments, type LlmMissionProgress } from '../compare/experimentStore'
import {
  buildProjectCardMarkdown,
  EMPTY_PROJECT_CARD,
  isCardComplete,
  loadMissionProgress,
  loadProjectCard,
  MISSIONS,
  PROJECT_CARD_FIELDS,
  PROJECT_CARD_MISSION,
  saveMissionProgress,
  saveProjectCard,
  type Mission,
  type MissionTarget,
  type ProjectCardFields,
} from './missions'

/**
 * The «Misiones» tab: seven missions that walk through the Lab LLM's tools, each with a
 * challenge and a question for thinking, and a last one that turns the learner's
 * experiments into an XAI card for their own project. Progress and answers stay in this
 * browser; the card is downloaded as a file, never sent anywhere.
 */
export function LlmMissions({ onGoTo }: { readonly onGoTo: (target: MissionTarget) => void }) {
  const { t } = useTranslation('llm')
  const headingId = useId()
  const [progress, setProgress] = useState<Record<string, LlmMissionProgress>>({})
  const [card, setCard] = useState<ProjectCardFields>(EMPTY_PROJECT_CARD)
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    void loadMissionProgress().then(setProgress)
    void loadProjectCard().then(setCard)
  }, [])

  const doneCount = MISSIONS.filter((mission) => progress[mission.id]?.done).length

  async function update(id: string, change: Partial<Pick<LlmMissionProgress, 'done' | 'reflection'>>) {
    // Shown at once, so a tick never lags behind the click; the stored copy follows.
    setProgress((current) => {
      const previous = current[id]
      return {
        ...current,
        [id]: {
          id,
          done: change.done ?? previous?.done ?? false,
          reflection: change.reflection ?? previous?.reflection ?? '',
          updatedAt: new Date().toISOString(),
        },
      }
    })
    await saveMissionProgress(id, change)
  }

  async function handleDownload() {
    await saveProjectCard(card)
    const experiments = await listExperiments()
    const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })
    const markdown = buildProjectCardMarkdown({
      title: t('missions.card.fileTitle'),
      date: format.format(new Date()),
      fields: PROJECT_CARD_FIELDS.map((field) => ({ label: t(`missions.card.fields.${field}.label`), value: card[field] })),
      reflectionsHeading: t('missions.card.reflectionsHeading'),
      reflections: MISSIONS.filter((mission) => mission.id !== PROJECT_CARD_MISSION).map((mission, index) => ({
        mission: t('missions.numbered', { number: index + 1, title: t(`missions.items.${mission.id}.title`) }),
        question: t(`missions.items.${mission.id}.question`),
        answer: progress[mission.id]?.reflection ?? '',
      })),
      experimentsHeading: t('missions.card.experimentsHeading'),
      experiments,
      experimentLine: (experiment) =>
        `${t(`compare.presets.${experiment.presetId}.label`)} · ${t(`compare.verdict.${experiment.band}`)} · ${experiment.modelName}: ${experiment.summary}`,
      empty: t('missions.card.empty'),
      footer: t('missions.card.footer'),
    })
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = t('missions.card.fileName')
    link.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)
    if (isCardComplete(card)) await update(PROJECT_CARD_MISSION, { done: true })
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4">
      <header className="flex flex-col gap-2">
        <h2 id={headingId} className="font-display text-xl">{t('missions.title')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('missions.intro')}</p>
        <ProgressBar
          label={t('missions.progressLabel')}
          value={doneCount / MISSIONS.length}
          detail={t('missions.progress', { done: doneCount, total: MISSIONS.length })}
        />
      </header>

      <ol className="flex list-none flex-col gap-3 p-0">
        {MISSIONS.map((mission, index) => (
          <li key={mission.id}>
            <MissionCard
              mission={mission}
              number={index + 1}
              progress={progress[mission.id]}
              onGoTo={onGoTo}
              onChange={(change) => {
                void update(mission.id, change)
              }}
            >
              {mission.id === PROJECT_CARD_MISSION ? (
                <ProjectCardForm
                  card={card}
                  onChange={(next) => {
                    setCard(next)
                    setDownloaded(false)
                  }}
                  onBlur={() => {
                    void saveProjectCard(card)
                  }}
                  onDownload={() => {
                    void handleDownload()
                  }}
                  downloaded={downloaded}
                />
              ) : null}
            </MissionCard>
          </li>
        ))}
      </ol>
    </section>
  )
}

function MissionCard({
  mission,
  number,
  progress,
  onGoTo,
  onChange,
  children,
}: {
  readonly mission: Mission
  readonly number: number
  readonly progress: LlmMissionProgress | undefined
  readonly onGoTo: (target: MissionTarget) => void
  readonly onChange: (change: Partial<Pick<LlmMissionProgress, 'done' | 'reflection'>>) => void
  readonly children?: ReactNode
}) {
  const { t } = useTranslation('llm')
  const done = progress?.done ?? false
  // Typed text is kept locally and saved when the field loses focus, not on every key.
  const [reflection, setReflection] = useState(progress?.reflection ?? '')
  const savedReflection = progress?.reflection ?? ''
  useEffect(() => {
    setReflection(savedReflection)
  }, [savedReflection])
  const isCard = mission.id === PROJECT_CARD_MISSION

  return (
    <article
      data-testid={`mission-${mission.id}`}
      className={['flex flex-col gap-3 rounded-lg border bg-white p-3', done ? 'border-green' : 'border-border-subtle'].join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{t('missions.numbered', { number, title: t(`missions.items.${mission.id}.title`) })}</h3>
        <span className="text-sm text-ink-muted" data-testid={`mission-${mission.id}-status`}>
          {done ? t('missions.statusDone') : t('missions.statusPending')}
        </span>
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="font-medium">{t('missions.what')}</dt>
          <dd>{t(`missions.items.${mission.id}.what`)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t('missions.challenge')}</dt>
          <dd>{t(`missions.items.${mission.id}.challenge`)}</dd>
        </div>
      </dl>

      {mission.target ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              if (mission.target) onGoTo(mission.target)
            }}
          >
            {t(`missions.goTo.${mission.target.tab}`)}
          </Button>
        </div>
      ) : null}

      {children}

      {isCard ? null : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t(`missions.items.${mission.id}.question`)}</span>
          <textarea
            value={reflection}
            rows={2}
            onChange={(event) => {
              setReflection(event.target.value)
            }}
            onBlur={() => {
              if (reflection !== savedReflection) onChange({ reflection })
            }}
            className="rounded border border-border-subtle bg-surface px-3 py-2"
          />
        </label>
      )}

      {isCard ? null : (
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={done}
            onChange={(event) => {
              onChange({ done: event.target.checked, reflection })
            }}
            className="size-5"
          />
          {t('missions.markDone')}
        </label>
      )}
    </article>
  )
}

function ProjectCardForm({
  card,
  onChange,
  onBlur,
  onDownload,
  downloaded,
}: {
  readonly card: ProjectCardFields
  readonly onChange: (card: ProjectCardFields) => void
  readonly onBlur: () => void
  readonly onDownload: () => void
  readonly downloaded: boolean
}) {
  const { t } = useTranslation('llm')
  const complete = isCardComplete(card)
  return (
    <div className="flex flex-col gap-3">
      {PROJECT_CARD_FIELDS.map((field) => (
        <label key={field} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t(`missions.card.fields.${field}.label`)}</span>
          <span className="text-xs text-ink-muted">{t(`missions.card.fields.${field}.hint`)}</span>
          <textarea
            value={card[field]}
            rows={2}
            onChange={(event) => {
              onChange({ ...card, [field]: event.target.value })
            }}
            onBlur={onBlur}
            className="rounded border border-border-subtle bg-surface px-3 py-2"
          />
        </label>
      ))}
      <p className="text-sm text-ink-muted">{t('missions.card.includes')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onDownload}>{t('missions.card.download')}</Button>
        {downloaded ? (
          <p role="status" className="text-sm text-ink-muted">
            {complete ? t('missions.card.downloadedComplete') : t('missions.card.downloadedIncomplete')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
