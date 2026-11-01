import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import type { LlmEngine } from './llmEngine'

const MAX_TOKENS = 512

/** Section markers the hidden instruction asks the model to emit, used to split its output. */
const ANSWER_TAG = '[ANSWER]'
const REASONING_TAG = '[REASONING]'
const ANSWER_TAG_PATTERN = /\[\s*(?:ANSWER|RESPUESTA)\s*\]/i
const REASONING_TAG_PATTERN = /\[\s*(?:REASONING|RAZONAMIENTO)\s*\]/i

interface ReasoningTurn {
  readonly question: string
  readonly answer: string
  /** Reasoning generated together with the answer; `null` when the model did not provide any. */
  readonly explanation: string | null
  readonly revealed: boolean
}

/** Separate the visible answer from the hidden reasoning in a single model output. */
function parseModelOutput(output: string): { answer: string; explanation: string | null } {
  const reasoningMatch = REASONING_TAG_PATTERN.exec(output)
  const answerPart = reasoningMatch ? output.slice(0, reasoningMatch.index) : output
  const reasoningPart = reasoningMatch ? output.slice(reasoningMatch.index + reasoningMatch[0].length) : ''
  const answer = answerPart.replace(ANSWER_TAG_PATTERN, '').trim()
  const explanation = reasoningPart.trim()
  return { answer, explanation: explanation.length > 0 ? explanation : null }
}

const STEP_PREFIX = /^\s*(?:\d+[.)]|[-*•])\s+/

/** Split a model explanation into steps when it is written as a list; otherwise return no steps. */
function splitSteps(text: string): readonly string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const steps = lines.filter((line) => STEP_PREFIX.test(line))
  return steps.length >= 2 ? steps.map((line) => line.replace(STEP_PREFIX, '').replace(/\*\*/g, '')) : []
}

export function ReasoningChat({
  engine,
  loadingModel,
  variant = 'reasoning',
}: {
  readonly engine: LlmEngine | null
  readonly loadingModel: boolean
  /** Picks the locale block (`reasoning`, `sentiment`, `bias`, `tutor` or `deception`) for the section's own texts. */
  readonly variant?: 'reasoning' | 'sentiment' | 'bias' | 'tutor' | 'deception'
}) {
  const { t } = useTranslation('llm')
  // The tutor exercise asks for guidance instead of an answer, so there is no hidden reasoning.
  const isTutor = variant === 'tutor'
  const example = t(`${variant}.example`)
  const [question, setQuestion] = useState('')
  const [turn, setTurn] = useState<ReasoningTurn | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function handleAsk() {
    const trimmed = question.trim()
    if (trimmed.length === 0 || asking) return
    if (!engine) {
      setError(t('chat.modelUnavailable'))
      return
    }

    setError(null)
    setTurn(null)
    setAsking(true)
    try {
      if (isTutor) {
        // One-shot Socratic math tutoring: show the guidance, not the internal instruction.
        const output = await engine.generate(
          [{ role: 'user', content: `${trimmed}\n\n${t('tutor.hiddenInstruction')}` }],
          MAX_TOKENS,
        )
        if (mounted.current) setTurn({ question: trimmed, answer: output.trim(), explanation: null, revealed: false })
        return
      }
      // The reasoning is requested in the same call through a hidden instruction appended
      // to the question; the learner only sees it after pressing the "why" button.
      const hiddenInstruction = t('reasoning.hiddenInstruction', {
        answerTag: ANSWER_TAG,
        reasoningTag: REASONING_TAG,
      })
      const hiddenQuestion =
        variant === 'sentiment' || variant === 'bias' ? t(`${variant}.hiddenQuestion`) : null
      const userContent = hiddenQuestion ? `${hiddenQuestion}\n\n"${trimmed}"` : trimmed
      const output = await engine.generate(
        [{ role: 'user', content: `${userContent}\n\n${hiddenInstruction}` }],
        MAX_TOKENS,
      )
      const { answer, explanation } = parseModelOutput(output)
      if (mounted.current) setTurn({ question: trimmed, answer, explanation, revealed: false })
    } catch (caught) {
      console.warn('Reasoning lab answer failed:', caught)
      if (mounted.current) setError(t('reasoning.failed'))
    } finally {
      if (mounted.current) setAsking(false)
    }
  }

  const steps = turn?.explanation ? splitSteps(turn.explanation) : []

  return (
    <section
      aria-labelledby={`${variant}-title`}
      className="rounded-lg border border-border-subtle bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${variant}-title`} className="font-display text-xl">{t(`${variant}.title`)}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t(`${variant}.intro`)}</p>
      </div>

      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-sunken p-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t(`${variant}.questionLabel`)}</span>
          <textarea
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value)
            }}
            rows={3}
            placeholder={`${t('reasoning.examplePrefix')} ${example}`}
            className="rounded border border-border-subtle bg-surface px-3 py-2"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              void handleAsk()
            }}
            disabled={asking || loadingModel || !engine || question.trim().length === 0}
          >
            {asking ? t('reasoning.asking') : t('reasoning.ask')}
          </Button>
          <Button
            variant="secondary"
            disabled={asking}
            onClick={() => {
              setQuestion(example)
            }}
          >
            {t('reasoning.useExample')}
          </Button>
          {asking ? (
            <span
              role="status"
              className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
            >
              <span
                className="h-3 w-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent motion-reduce:animate-pulse"
                aria-hidden="true"
              />
              {t('reasoning.thinking')}
            </span>
          ) : null}
          {error ? (
            <p role="alert" className="w-full text-sm text-red-700">{error}</p>
          ) : null}
        </div>
      </div>

      {turn ? (
        <div className="mt-4 flex flex-col gap-4">
          <article className="ml-auto max-w-3xl rounded-2xl bg-blue px-4 py-3 text-ink-inverse shadow-sm">
            <p className="text-xs uppercase tracking-wide opacity-80">{t('chat.userLabel')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{turn.question}</p>
          </article>

          <article className="max-w-4xl rounded-2xl border border-border-subtle bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-ink-muted">{t(isTutor ? 'tutor.answerLabel' : 'reasoning.answerLabel')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                  {turn.answer || t('chat.noOutput')}
                </p>
              </div>
              {isTutor ? null : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTurn({ ...turn, revealed: !turn.revealed })
                  }}
                  aria-expanded={turn.revealed}
                >
                  {t('reasoning.why')}
                </Button>
              )}
            </div>

            {turn.revealed ? (
              <div className="mt-4 flex flex-col gap-2 rounded-xl bg-surface p-4" aria-live="polite">
                <h3 className="text-sm font-medium text-ink">{t('reasoning.explanationTitle')}</h3>
                {turn.explanation === null ? (
                  <p className="text-sm text-ink-muted">{t('reasoning.unavailable')}</p>
                ) : steps.length > 0 ? (
                  <ol className="list-decimal pl-5 text-sm leading-6 text-ink">
                    {steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{turn.explanation}</p>
                )}
                {turn.explanation !== null ? (
                  <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    {t('reasoning.caveat')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>
        </div>
      ) : null}
    </section>
  )
}
