import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { LlmAbortedError, type ChatTurn, type LlmEngine } from './llmEngine'

const MAX_TOKENS = 512

/** Section markers the hidden instruction asks the model to emit, used to split its output. */
const ANSWER_TAG = '[ANSWER]'
const REASONING_TAG = '[REASONING]'
const ANSWER_TAG_PATTERN = /\[\s*(?:ANSWER|RESPUESTA)\s*\]/i
const REASONING_TAG_PATTERN = /\[\s*(?:REASONING|RAZONAMIENTO)\s*\]/i

/**
 * How many earlier exchanges the deception exercise sends back to the model. Enough to
 * insist two or three times; small models lose the thread (and slow down) beyond that.
 */
const MAX_HISTORY_TURNS = 4

interface ReasoningTurn {
  readonly id: string
  readonly question: string
  /** What the model was actually sent for this turn, without the hidden instruction. */
  readonly userContent: string
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
  // Only the deception exercise invites the learner to insist, so only it keeps a conversation.
  const keepsHistory = variant === 'deception'
  const example = t(`${variant}.example`)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<readonly ReasoningTurn[]>([])
  const [asking, setAsking] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abortRef.current?.abort()
    }
  }, [])

  /**
   * The instruction appended to the learner's text. Sentiment and bias ask for the exact
   * words of the text that weighed most, which is what their intros promise; the generic
   * exercise asks for a short numbered explanation.
   */
  function hiddenInstructionFor(): string {
    const tags = { answerTag: ANSWER_TAG, reasoningTag: REASONING_TAG }
    if (isTutor) return t('tutor.hiddenInstruction')
    if (variant === 'sentiment' || variant === 'bias') return t(`${variant}.hiddenInstruction`, tags)
    return t('reasoning.hiddenInstruction', tags)
  }

  async function handleAsk() {
    const trimmed = question.trim()
    if (trimmed.length === 0 || asking) return
    if (!engine) {
      setError(t('chat.modelUnavailable'))
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setStopped(false)
    if (!keepsHistory) setTurns([])
    setAsking(true)
    try {
      const hiddenQuestion =
        variant === 'sentiment' || variant === 'bias' ? t(`${variant}.hiddenQuestion`) : null
      const userContent = hiddenQuestion ? `${hiddenQuestion}\n\n"${trimmed}"` : trimmed
      // Earlier exchanges go back as plain question and answer; only the newest message
      // carries the hidden instruction, so the model is asked for one explanation, not many.
      const history: ChatTurn[] = keepsHistory
        ? turns.slice(-MAX_HISTORY_TURNS).flatMap((previous) => [
            { role: 'user' as const, content: previous.userContent },
            { role: 'assistant' as const, content: previous.answer },
          ])
        : []
      const output = await engine.generate(
        [...history, { role: 'user', content: `${userContent}\n\n${hiddenInstructionFor()}` }],
        MAX_TOKENS,
        controller.signal,
      )
      const { answer, explanation } = isTutor
        ? { answer: output.trim(), explanation: null }
        : parseModelOutput(output)
      if (!mounted.current) return
      const next: ReasoningTurn = {
        id: crypto.randomUUID(),
        question: trimmed,
        userContent,
        answer,
        explanation,
        revealed: false,
      }
      setTurns((current) => (keepsHistory ? [...current, next] : [next]))
      if (keepsHistory) setQuestion('')
    } catch (caught) {
      if (!mounted.current) return
      if (caught instanceof LlmAbortedError) {
        setStopped(true)
      } else {
        console.warn('Reasoning lab answer failed:', caught)
        setError(t('reasoning.failed'))
      }
    } finally {
      abortRef.current = null
      if (mounted.current) setAsking(false)
    }
  }

  function toggleReveal(id: string) {
    setTurns((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, revealed: !entry.revealed } : entry)),
    )
  }

  return (
    <section
      aria-labelledby={`${variant}-title`}
      className="rounded-lg border border-border-subtle bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${variant}-title`} className="font-display text-xl">{t(`${variant}.title`)}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t(`${variant}.intro`)}</p>
      </div>

      {turns.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          {turns.map((entry) => (
            <TurnView
              key={entry.id}
              entry={entry}
              isTutor={isTutor}
              onToggle={() => {
                toggleReveal(entry.id)
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-sunken p-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {keepsHistory && turns.length > 0 ? t('deception.followUpLabel') : t(`${variant}.questionLabel`)}
          </span>
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
          {asking ? (
            <Button
              variant="secondary"
              onClick={() => {
                abortRef.current?.abort()
              }}
            >
              {t('chat.stop')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setQuestion(example)
              }}
            >
              {t('reasoning.useExample')}
            </Button>
          )}
          {keepsHistory && turns.length > 0 && !asking ? (
            <Button
              variant="secondary"
              onClick={() => {
                setTurns([])
                setStopped(false)
              }}
            >
              {t('deception.restart')}
            </Button>
          ) : null}
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
          {stopped && !asking ? (
            <p role="status" className="w-full text-sm text-ink-muted">{t('chat.stopped')}</p>
          ) : null}
          {error ? (
            <p role="alert" className="w-full text-sm text-red-700">{error}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function TurnView({
  entry,
  isTutor,
  onToggle,
}: {
  readonly entry: ReasoningTurn
  readonly isTutor: boolean
  readonly onToggle: () => void
}) {
  const { t } = useTranslation('llm')
  const steps = entry.explanation ? splitSteps(entry.explanation) : []

  return (
    <>
      <article className="ml-auto max-w-3xl rounded-2xl bg-blue px-4 py-3 text-ink-inverse shadow-sm">
        <p className="text-xs uppercase tracking-wide opacity-80">{t('chat.userLabel')}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{entry.question}</p>
      </article>

      <article className="max-w-4xl rounded-2xl border border-border-subtle bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-ink-muted">{t(isTutor ? 'tutor.answerLabel' : 'reasoning.answerLabel')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
              {entry.answer || t('chat.noOutput')}
            </p>
          </div>
          {isTutor ? null : (
            <Button variant="secondary" onClick={onToggle} aria-expanded={entry.revealed}>
              {t('reasoning.why')}
            </Button>
          )}
        </div>

        {entry.revealed ? (
          <div className="mt-4 flex flex-col gap-2 rounded-xl bg-surface p-4" aria-live="polite">
            <h3 className="text-sm font-medium text-ink">{t('reasoning.explanationTitle')}</h3>
            {entry.explanation === null ? (
              <p className="text-sm text-ink-muted">{t('reasoning.unavailable')}</p>
            ) : steps.length > 0 ? (
              <ol className="list-decimal pl-5 text-sm leading-6 text-ink">
                {steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{entry.explanation}</p>
            )}
            {entry.explanation !== null ? (
              <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                {t('reasoning.caveat')}
              </p>
            ) : null}
          </div>
        ) : null}
      </article>
    </>
  )
}
