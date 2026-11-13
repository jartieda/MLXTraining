import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { CV_MISSIONS, loadCvMissions, saveCvMission, type CvMission, type CvMissionProgress } from './missions'

const EMPTY: CvMissionProgress = { done: false, reflection: '' }

export function CvMissions({ onGoTo }: { readonly onGoTo: (tab: CvMission['target']) => void }) {
  const { t } = useTranslation('cvlab')
  const [progress, setProgress] = useState(loadCvMissions)
  const done = CV_MISSIONS.filter((mission) => progress[mission.id]?.done).length

  return (
    <section aria-labelledby="cv-missions-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="cv-missions-title" className="font-display text-xl">{t('missions.title')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('missions.intro')}</p>
      </header>
      <ProgressBar
        label={t('missions.progressLabel')}
        value={done / CV_MISSIONS.length}
        detail={t('missions.progress', { done, total: CV_MISSIONS.length })}
      />
      <ol className="flex list-none flex-col gap-3 p-0">
        {CV_MISSIONS.map((mission, index) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            number={index + 1}
            progress={progress[mission.id] ?? EMPTY}
            onGoTo={onGoTo}
            onChange={(next) => {
              setProgress(saveCvMission(mission.id, next))
            }}
          />
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
}: {
  readonly mission: CvMission
  readonly number: number
  readonly progress: CvMissionProgress
  readonly onGoTo: (tab: CvMission['target']) => void
  readonly onChange: (progress: CvMissionProgress) => void
}) {
  const { t } = useTranslation('cvlab')
  const [reflection, setReflection] = useState(progress.reflection)
  const base = `missions.items.${mission.id}`

  return (
    <li data-testid={`cv-mission-${mission.id}`} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
      <h3 className="font-semibold">
        {number}. {t(`${base}.title`)}{' '}
        <span className="text-sm font-normal text-ink-muted">
          · {progress.done ? t('missions.done') : t('missions.pending')}
        </span>
      </h3>
      <p className="max-w-prose text-sm">{t(`${base}.what`)}</p>
      <p className="max-w-prose text-sm">
        <span className="font-medium">{t('missions.challengeLabel')}</span> {t(`${base}.challenge`)}
      </p>
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            onGoTo(mission.target)
          }}
        >
          {t(`missions.goTo.${mission.target}`)}
        </Button>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t(`${base}.question`)}</span>
        <textarea
          rows={2}
          value={reflection}
          onChange={(event) => {
            setReflection(event.target.value)
          }}
          onBlur={() => {
            if (reflection !== progress.reflection) onChange({ ...progress, reflection })
          }}
          className="rounded border border-border-subtle bg-surface px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={progress.done}
          onChange={(event) => {
            onChange({ done: event.target.checked, reflection })
          }}
        />
        {t('missions.markDone')}
      </label>
    </li>
  )
}
