import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { downloadText } from './quiz'

/**
 * «Tu proyecto y la XAI»: six open questions that tie the theory to whatever the
 * learner is building. Kept on this device (localStorage) and downloadable as text.
 */

export const PROJECT_QUESTIONS = ['technology', 'decides', 'affects', 'whatIsXai', 'whatIsBias', 'xaiInProject'] as const
type QuestionId = (typeof PROJECT_QUESTIONS)[number]

const KEY = 'ml4g.projectQuestions'

function load(): Partial<Record<QuestionId, string>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<QuestionId, string>>
  } catch {
    return {}
  }
}

export function ProjectQuestions() {
  const { t } = useTranslation('home')
  const [answers, setAnswers] = useState(load)
  const [saved, setSaved] = useState(false)
  const answered = PROJECT_QUESTIONS.filter((id) => (answers[id] ?? '').trim().length > 0).length

  function update(id: QuestionId, value: string) {
    setSaved(false)
    setAnswers((current) => {
      const next = { ...current, [id]: value }
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }

  function download() {
    const lines = [`# ${t('project.fileTitle')}`, '', new Date().toLocaleDateString(), '']
    for (const id of PROJECT_QUESTIONS) {
      const answer = (answers[id] ?? '').trim()
      lines.push(`## ${t(`project.questions.${id}.label`)}`, '', answer || `_${t('project.empty')}_`, '')
    }
    downloadText(lines.join('\n'), t('project.fileName'), 'text/markdown;charset=utf-8')
    setSaved(true)
  }

  return (
    <section aria-labelledby="project-questions" className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4">
      <header className="flex flex-col gap-1">
        <h2 id="project-questions" className="font-display text-xl">{t('project.title')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('project.intro')}</p>
      </header>
      <ol className="flex list-none flex-col gap-4 p-0">
        {PROJECT_QUESTIONS.map((id, index) => (
          <li key={id}>
            <label className="flex flex-col gap-1">
              <span className="font-medium">
                {index + 1}. {t(`project.questions.${id}.label`)}
              </span>
              <span className="text-sm text-ink-muted">{t(`project.questions.${id}.hint`)}</span>
              <textarea
                rows={3}
                value={answers[id] ?? ''}
                onChange={(event) => {
                  update(id, event.target.value)
                }}
                className="rounded border border-border-subtle bg-surface px-2 py-1"
              />
            </label>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={download}>
          {t('project.download')}
        </Button>
        <p className="text-sm text-ink-muted" aria-live="polite">
          {saved ? t('project.downloaded') : t('project.progress', { done: answered, total: PROJECT_QUESTIONS.length })}
        </p>
      </div>
    </section>
  )
}
