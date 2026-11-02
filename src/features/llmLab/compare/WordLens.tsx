import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { LlmAbortedError, type LlmEngine } from '../llmEngine'
import type { AnswerOption } from './scoreOptions'
import {
  checkSelfReport,
  LensOffFormatError,
  NEGLIGIBLE_IMPACT,
  runWordLens,
  topSupporting,
  type LensResult,
  type SelfReportCheck,
  type WordImpact,
} from './wordImpact'

/**
 * The word lens and «¿Dice la verdad sobre sí mismo?», on the lab's sentiment example.
 * The lens measures which words move the answer by removing them one at a time; then the
 * model is asked which words influenced it, and the two lists are compared.
 */

const LENS_PRESET = 'sentimentWord'
const LETTERS = ['A', 'B', 'C'] as const
const LENS_TOP = 3
const SELF_REPORT_MAX_TOKENS = 120

const percent = (value: number) => Math.round(value * 100)

/**
 * Three steps of one colour, strongest last. Not the Lab CV's heat ramp: on a white page
 * its strongest colour is a pale yellow, which would make the word that matters most
 * the hardest one to see. Words that barely change anything stay uncoloured.
 */
const SUPPORT_LEVELS = ['bg-magenta/15 text-ink', 'bg-magenta/40 text-ink', 'bg-magenta text-white'] as const

function supportLevel(support: number): (typeof SUPPORT_LEVELS)[number] {
  if (support > 2 / 3) return SUPPORT_LEVELS[2]
  if (support > 1 / 3) return SUPPORT_LEVELS[1]
  return SUPPORT_LEVELS[0]
}

export function WordLens({
  engine,
  loadingModel,
  modelName,
  onRunningChange,
}: {
  readonly engine: LlmEngine | null
  readonly loadingModel: boolean
  readonly modelName: string
  readonly onRunningChange?: (running: boolean) => void
}) {
  const { t } = useTranslation('llm')
  const headingId = useId()
  const [text, setText] = useState(() => t('sentiment.example'))
  const [phase, setPhase] = useState<'idle' | 'lens' | 'ask'>('idle')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [lens, setLens] = useState<(LensResult & { modelName: string; text: string }) | null>(null)
  const [selfReport, setSelfReport] = useState<{ reply: string; check: SelfReportCheck } | null>(null)
  const [status, setStatus] = useState<'stopped' | 'failed' | 'offFormat' | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const running = phase !== 'idle'

  useEffect(() => {
    onRunningChange?.(running)
  }, [running, onRunningChange])

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const options: AnswerOption[] = LETTERS.map((letter) => ({ letter, text: t(`compare.presets.${LENS_PRESET}.options.${letter}`) }))
  const question = t(`compare.presets.${LENS_PRESET}.question`)
  const buildText = (variant: string) => `${question}\n"${variant.trim()}"`

  async function run(task: (signal: AbortSignal) => Promise<void>, nextPhase: 'lens' | 'ask') {
    if (!engine || running) return
    const controller = new AbortController()
    abortRef.current = controller
    setStatus(null)
    setPhase(nextPhase)
    try {
      await task(controller.signal)
    } catch (error) {
      if (error instanceof LlmAbortedError || controller.signal.aborted) setStatus('stopped')
      else if (error instanceof LensOffFormatError) setStatus('offFormat')
      else {
        console.warn('Word lens failed:', error)
        setStatus('failed')
      }
    } finally {
      abortRef.current = null
      setPhase('idle')
      setProgress(null)
    }
  }

  function handleLens() {
    setLens(null)
    setSelfReport(null)
    void run(async (signal) => {
      if (!engine) return
      const result = await runWordLens(
        engine,
        text,
        buildText,
        options,
        t('compare.optionsInstruction'),
        (done, total) => {
          setProgress({ done, total })
        },
        signal,
      )
      setLens({ ...result, modelName, text })
    }, 'lens')
  }

  function handleAsk() {
    if (!lens) return
    setSelfReport(null)
    void run(async (signal) => {
      if (!engine) return
      const reply = await engine.generate(
        [{ role: 'user', content: `${buildText(lens.text)}\n\n${t('lens.selfReport.instruction', { count: LENS_TOP })}` }],
        SELF_REPORT_MAX_TOKENS,
        signal,
      )
      if (signal.aborted) throw new LlmAbortedError()
      const top = topSupporting(lens.impacts, LENS_TOP).map((item) => item.word)
      setSelfReport({ reply, check: checkSelfReport(reply, lens.text, top) })
    }, 'ask')
  }

  return (
    <section id="llm-word-lens" tabIndex={-1} aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4">
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="font-display text-xl">{t('lens.title')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('lens.intro')}</p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('lens.textLabel')}</span>
        <textarea
          value={text}
          disabled={running}
          rows={3}
          onChange={(event) => {
            setText(event.target.value)
          }}
          className="rounded border border-border-subtle bg-surface px-3 py-2"
        />
        <span className="text-xs text-ink-muted">
          {t('lens.cost', { count: wordCount(text) + 1 })}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleLens} disabled={running || loadingModel || !engine || wordCount(text) === 0}>
          {t('lens.run')}
        </Button>
        <Button
          variant="secondary"
          disabled={running}
          onClick={() => {
            setText(t('sentiment.example'))
          }}
        >
          {t('compare.resetPreset')}
        </Button>
        {!engine && !loadingModel ? <p className="w-full text-sm text-ink-muted">{t('compare.noEngine')}</p> : null}
      </div>

      {phase === 'lens' ? (
        <ProgressBar
          label={t('lens.progressLabel')}
          value={progress && progress.total > 0 ? progress.done / progress.total : null}
          detail={progress ? t('lens.progress', { done: progress.done, total: progress.total }) : t('lens.progressStart')}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                abortRef.current?.abort()
              }}
            >
              {t('chat.stop')}
            </Button>
          }
        />
      ) : null}
      {status === 'stopped' ? <p role="status" className="text-sm text-ink-muted">{t('lens.stopped')}</p> : null}
      {status === 'failed' ? <p role="alert" className="text-sm text-red-700">{t('compare.failed')}</p> : null}
      {status === 'offFormat' ? (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{t('lens.offFormat')}</p>
      ) : null}

      {lens ? <LensView lens={lens} /> : null}

      {lens ? (
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
          <h3 className="font-semibold">{t('lens.selfReport.title')}</h3>
          <p className="max-w-prose text-sm text-ink-muted">{t('lens.selfReport.intro')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleAsk} disabled={running || !engine}>
              {t('lens.selfReport.ask')}
            </Button>
            {phase === 'ask' ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    abortRef.current?.abort()
                  }}
                >
                  {t('chat.stop')}
                </Button>
                <span role="status" className="text-sm text-ink-muted">{t('lens.selfReport.asking')}</span>
              </>
            ) : null}
          </div>
          {selfReport ? <SelfReportView reply={selfReport.reply} check={selfReport.check} /> : null}
        </div>
      ) : null}
    </section>
  )
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

function LensView({ lens }: { readonly lens: LensResult & { modelName: string } }) {
  const { t } = useTranslation('llm')
  const byIndex = new Map(lens.impacts.map((item) => [item.wordIndex, item]))
  // Normalised by the strongest supporting word, like every map in the Lab CV: the
  // colour says "more or less than the other words", never an absolute amount.
  const maxSupport = Math.max(0, ...lens.impacts.map((item) => item.impact))
  const top = topSupporting(lens.impacts, LENS_TOP)
  const strongest = top[0]
  const against = lens.impacts.filter((item) => item.impact < -NEGLIGIBLE_IMPACT).sort((a, b) => a.impact - b.impact)

  return (
    <div className="flex flex-col gap-3" data-testid="lens-result">
      <p className="text-xs text-ink-muted">{t('compare.conditions', { model: lens.modelName })}</p>
      <p className="text-sm">
        {t('lens.baseline', { answer: lens.answer.text, percent: percent(lens.baseline) })}
      </p>

      <p className="rounded-lg border border-border-subtle bg-white p-3 text-lg leading-10" data-testid="lens-text">
        {lens.pieces.map((piece, index) => {
          if (piece.wordIndex === null) return <span key={index}>{piece.text}</span>
          const impact = byIndex.get(piece.wordIndex)
          return <LensWord key={index} word={piece.text} impact={impact} maxSupport={maxSupport} />
        })}
      </p>

      <div className="flex flex-col gap-1 text-xs text-ink-muted">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t('lens.legendLow')}</span>
          {SUPPORT_LEVELS.map((level) => (
            <span key={level} aria-hidden="true" className={`h-3 w-8 rounded ${level}`} />
          ))}
          <span>{t('lens.legendHigh', { answer: lens.answer.text })}</span>
        </div>
        <p>{t('lens.legendCaption', { answer: lens.answer.text })}</p>
      </div>

      <div aria-live="polite" className="flex flex-col gap-1 text-sm" data-testid="lens-summary">
        {strongest && strongest.impact >= NEGLIGIBLE_IMPACT ? (
          <p className="font-medium">
            {t(strongest.atLeast ? 'lens.strongestAtLeast' : 'lens.strongest', {
              word: strongest.word,
              answer: lens.answer.text,
              points: percent(strongest.impact),
            })}
          </p>
        ) : (
          <p className="font-medium">{t('lens.noneMatters')}</p>
        )}
        {top.length > 1 ? (
          <p>{t('lens.topList', { words: top.map((item) => `«${item.word}»`).join(', ') })}</p>
        ) : null}
        {against.length > 0 ? (
          <p>{t('lens.against', { words: against.slice(0, LENS_TOP).map((item) => `«${item.word}»`).join(', '), answer: lens.answer.text })}</p>
        ) : null}
        <p className="text-ink-muted">{t('lens.caveat')}</p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-ink-muted">{t('compare.showCalculation')}</summary>
        <ul className="mt-2 list-none p-0 font-mono text-xs text-ink-muted">
          {lens.impacts.map((item) => (
            <li key={item.wordIndex}>
              {t('lens.calculationLine', {
                word: item.word,
                without: item.without === null ? t('compare.notMeasured') : `${percent(item.without)} %`,
                points: signedPoints(item),
              })}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function signedPoints(item: WordImpact): string {
  const points = percent(item.impact)
  return `${item.atLeast ? '≥ ' : ''}${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points)}`
}

function LensWord({
  word,
  impact,
  maxSupport,
}: {
  readonly word: string
  readonly impact: WordImpact | undefined
  readonly maxSupport: number
}) {
  const { t } = useTranslation('llm')
  if (!impact) return <span>{word}</span>
  const support = maxSupport > 0 ? Math.max(0, impact.impact) / maxSupport : 0
  const pushesAgainst = impact.impact < -NEGLIGIBLE_IMPACT
  const title = t(impact.impact < 0 ? 'lens.wordTitleAgainst' : 'lens.wordTitle', {
    word,
    points: signedPoints(impact).replace('+', '').replace('−', ''),
  })
  const coloured = impact.impact >= NEGLIGIBLE_IMPACT
  return (
    <span
      title={title}
      className={[
        'rounded',
        coloured ? `px-0.5 ${supportLevel(support)}` : '',
        pushesAgainst ? 'underline decoration-blue decoration-dashed decoration-2 underline-offset-4' : '',
      ].join(' ')}
    >
      {word}
    </span>
  )
}

function SelfReportView({ reply, check }: { readonly reply: string; readonly check: SelfReportCheck }) {
  const { t } = useTranslation('llm')
  return (
    <div className="flex flex-col gap-3" data-testid="self-report">
      <article className="rounded-lg border border-border-subtle bg-white p-3 text-sm">
        <h4 className="font-semibold">{t('lens.selfReport.replyHeading')}</h4>
        <p className="mt-1 whitespace-pre-wrap break-words">{reply.trim() || t('chat.noOutput')}</p>
      </article>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <div>
          <p className="font-medium">{t('lens.selfReport.saysHeading')}</p>
          {check.quotes.length === 0 ? (
            <p className="text-ink-muted">{t('lens.selfReport.noQuotesList')}</p>
          ) : (
            <ul className="list-disc pl-5">
              {check.quotes.map((quote, index) => (
                <li key={index}>
                  «{quote.text}» {quote.hitsLens ? `· ${t('lens.selfReport.alsoLens')}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="font-medium">{t('lens.selfReport.measuredHeading')}</p>
          <ul className="list-disc pl-5">
            {check.lensTop.map((item) => (
              <li key={item.word}>
                «{item.word}» · {item.named ? t('lens.selfReport.named') : t('lens.selfReport.notNamed')}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <section
        aria-live="polite"
        data-testid="self-report-verdict"
        className={[
          'flex flex-col gap-1 rounded border p-3 text-sm',
          check.band === 'strong' ? 'border-border-subtle' : 'border-magenta',
        ].join(' ')}
      >
        <h4 className="font-semibold">
          {t('lens.selfReport.heading')} <span data-testid="self-report-band">{t(`lens.selfReport.band.${check.band}`)}</span>
        </h4>
        <p>{t(`lens.selfReport.body.${check.band}`, { named: check.named, total: check.lensTop.length })}</p>
        <p className="text-ink-muted">{t('lens.selfReport.lesson')}</p>
      </section>
    </div>
  )
}
