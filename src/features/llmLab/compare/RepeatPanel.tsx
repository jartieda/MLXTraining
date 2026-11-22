import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { LlmAbortedError, type LlmEngine } from '../llmEngine'

const REPEAT_COUNT = 4
const MAX_TOKENS = 256
const TEMPERATURE = 0.7

export function RepeatPanel({
  engine,
  loadingModel,
  onRunningChange,
}: {
  readonly engine: LlmEngine | null
  readonly loadingModel: boolean
  readonly onRunningChange?: (running: boolean) => void
}) {
  const { t } = useTranslation('llm')
  const headingId = useId()
  const promptId = useId()
  const abortRef = useRef<AbortController | null>(null)
  const [prompt, setPrompt] = useState('')
  const [answers, setAnswers] = useState<readonly string[]>([])
  const [running, setRunning] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    onRunningChange?.(running)
  }, [running, onRunningChange])

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  async function handleRun() {
    const trimmed = prompt.trim()
    if (!engine || trimmed.length === 0 || running) return

    const controller = new AbortController()
    abortRef.current = controller
    setAnswers([])
    setError(false)
    setStopped(false)
    setRunning(true)

    try {
      for (let index = 0; index < REPEAT_COUNT; index++) {
        const answer = await engine.generate(
          [
            { role: 'system', content: t('repeat.hiddenPrompt') },
            { role: 'user', content: trimmed },
          ],
          MAX_TOKENS,
          controller.signal,
          { temperature: TEMPERATURE },
        )
        if (controller.signal.aborted) throw new LlmAbortedError()
        setAnswers((current) => [...current, answer.trim()])
      }
    } catch (caught) {
      if (caught instanceof LlmAbortedError || controller.signal.aborted) {
        setStopped(true)
      } else {
        console.warn('Repeated LLM generation failed:', caught)
        setError(true)
      }
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="repeat-panel"
      className="flex flex-col gap-4 rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="font-display text-xl">{t('repeat.title')}</h2>
          <p className="max-w-prose text-sm text-ink-muted">{t('repeat.intro')}</p>
        </div>
        <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-blue-ink">
          {t('repeat.badge')}
        </span>
      </header>

      <p className="rounded-xl border border-border-subtle bg-surface-sunken p-3 text-sm leading-6 text-ink">
        {t('repeat.note')}
      </p>

      <label htmlFor={promptId} className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('repeat.promptLabel')}</span>
        <textarea
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={running}
          rows={3}
          placeholder={t('repeat.promptPlaceholder')}
          className="rounded border border-border-subtle bg-surface px-3 py-2"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          busy={running}
          disabled={running || loadingModel || !engine || prompt.trim().length === 0}
          onClick={() => void handleRun()}
        >
          {running ? t('repeat.running', { done: answers.length, total: REPEAT_COUNT }) : t('repeat.run')}
        </Button>
        {running ? (
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            {t('chat.stop')}
          </Button>
        ) : null}
        {running ? (
          <p role="status" className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <span
              aria-hidden="true"
              className="size-4 motion-safe:animate-spin rounded-full border-2 border-blue border-t-transparent"
            />
            {t('repeat.progress', { done: answers.length, total: REPEAT_COUNT })}
          </p>
        ) : null}
      </div>

      {stopped ? <p role="status" className="text-sm text-ink-muted">{t('repeat.stopped')}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{t('repeat.failed')}</p> : null}

      {answers.length > 0 ? (
        <ol
          aria-label={t('repeat.listLabel')}
          aria-live="polite"
          data-testid="repeat-answers"
          className="grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2"
        >
          {answers.map((answer, index) => (
            <li key={index} className="rounded-xl border border-border-subtle bg-surface-sunken p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t('repeat.answer', { number: index + 1 })}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
                {answer || t('chat.noOutput')}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
