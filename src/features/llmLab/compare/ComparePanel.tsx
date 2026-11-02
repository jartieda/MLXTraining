import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Meter } from '@/components/Meter'
import { LlmAbortedError, type LlmEngine } from '../llmEngine'
import { buildWordCompletionPrompt, findWordCandidates } from '../wordCompletion'
import { compareScored, freeTextBand, type ChangeBand, type ComparisonVerdict, type Scored } from './compareResults'
import { diffWords, MAX_CONTROLLED_CHANGES, type DiffSegment, type WordDiff } from './diffWords'
import {
  deleteExperiment,
  listExperiments,
  saveExperiment,
  type BetChoice,
  type LlmExperiment,
} from './experimentStore'
import { COMPARE_PRESETS, DEFAULT_PRESET_ID, findPreset, type ComparePreset } from './presets'
import { OFF_FORMAT_THRESHOLD, scoreOptions, type AnswerOption } from './scoreOptions'

/**
 * The A/B comparator: two prompts that differ in one thing, sent to the same model with
 * the same settings and no randomness, so a change in the answer can only come from the
 * change in the prompt. Built entirely on the engine's existing `nextTokenAlternatives`
 * and `generate`; the engine itself is not modified.
 *
 * Its state lives outside the sections that reset when the model changes, so a result
 * survives switching model, and it records which model produced it.
 */

const FREE_TEXT_MAX_TOKENS = 200
const BETS: readonly BetChoice[] = ['yes', 'no', 'unsure']

interface ScoredSide {
  readonly scored: readonly Scored[]
  /** Raw lines for «Ver el cálculo». */
  readonly calculation: readonly string[]
  /** Share of replies that were not an option letter (options layer only). */
  readonly other: number | null
}

type CompareResult =
  | {
      readonly layer: 'options' | 'nextWord'
      readonly presetId: string
      readonly modelName: string
      readonly verdict: ComparisonVerdict
      readonly a: ScoredSide
      readonly b: ScoredSide
    }
  | {
      readonly layer: 'freeText'
      readonly presetId: string
      readonly modelName: string
      readonly answerA: string
      readonly answerB: string
      readonly diff: WordDiff
      readonly band: ChangeBand
    }

const percent = (value: number) => Math.round(value * 100)

export function ComparePanel({
  engine,
  loadingModel,
  modelName,
  onRunningChange,
  presetRequest,
}: {
  readonly engine: LlmEngine | null
  readonly loadingModel: boolean
  /** Exact name of the loaded model, e.g. «Gemma 2 · 2B». */
  readonly modelName: string
  /** Lets the page lock the model controls while a comparison is running. */
  readonly onRunningChange?: (running: boolean) => void
  /** A mission asking for a preset; `nonce` lets the same preset be asked for twice. */
  readonly presetRequest?: { readonly id: string; readonly nonce: number } | null
}) {
  const { t } = useTranslation('llm')
  const formId = useId()
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID)
  const preset = findPreset(presetId)
  const [promptA, setPromptA] = useState(() => t(`compare.presets.${DEFAULT_PRESET_ID}.a`))
  const [promptB, setPromptB] = useState(() => t(`compare.presets.${DEFAULT_PRESET_ID}.b`))
  const [bet, setBet] = useState<BetChoice | null>(null)
  const [phase, setPhase] = useState<'idle' | 'a' | 'b'>('idle')
  const [result, setResult] = useState<CompareResult | null>(null)
  const [status, setStatus] = useState<'stopped' | 'failed' | 'saved' | null>(null)
  const [showCalculation, setShowCalculation] = useState(false)
  const [experiments, setExperiments] = useState<LlmExperiment[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    void listExperiments().then(setExperiments)
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const diff = diffWords(promptA, promptB)
  const optionsA = optionsFor(preset, 'a', t)
  const optionsB = optionsFor(preset, 'b', t)
  const running = phase !== 'idle'

  useEffect(() => {
    onRunningChange?.(running)
  }, [running, onRunningChange])

  useEffect(() => {
    if (presetRequest && !running) choosePreset(presetRequest.id)
    // Only a new request should switch the preset, not a change of anything else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetRequest])

  function choosePreset(id: string) {
    setPresetId(id)
    setPromptA(t(`compare.presets.${id}.a`))
    setPromptB(t(`compare.presets.${id}.b`))
    setResult(null)
    setStatus(null)
    setBet(null)
  }

  /** The text the model receives for one side, before options or instructions are added. */
  function textFor(prompt: string): string {
    const question = preset.caseKind === 'sentiment' ? t(`compare.presets.${preset.id}.question`) : null
    return question ? `${question}\n"${prompt.trim()}"` : prompt.trim()
  }

  async function runSide(prompt: string, options: readonly AnswerOption[], signal: AbortSignal): Promise<ScoredSide | string> {
    if (!engine) throw new Error('No engine')
    if (preset.layer === 'options') {
      const scores = await scoreOptions(engine, textFor(prompt), options, t('compare.optionsInstruction'), signal)
      return {
        scored: scores.options.map((option) => ({ label: option.text, probability: option.probability })),
        calculation: scores.tokens.map((token) => `«${token.token}» → ${percent(token.probability)} %`),
        other: scores.other,
      }
    }
    if (preset.layer === 'nextWord') {
      const candidates = await findWordCandidates((partialWord) =>
        engine.nextTokenAlternatives(
          buildWordCompletionPrompt(prompt, t('chat.wordCompletionInstruction'), t('chat.wordCompletionOutputInstruction')),
          partialWord,
          signal,
        ),
      )
      return {
        scored: candidates.map((candidate) => ({ label: candidate.word, probability: candidate.probability })),
        calculation: candidates.map(
          (candidate) =>
            `${candidate.word}: ${candidate.paths
              .map((path) => path.tokens.map((token) => `«${token.token}» ${percent(token.probability)} %`).join(' × '))
              .join(' + ')} = ${percent(candidate.probability)} %`,
        ),
        other: null,
      }
    }
    return engine.generate(
      [{ role: 'user', content: `${prompt.trim()}\n\n${t('compare.freeTextInstruction')}` }],
      FREE_TEXT_MAX_TOKENS,
      signal,
    )
  }

  async function handleCompare() {
    if (!engine || running) return
    const controller = new AbortController()
    abortRef.current = controller
    setStatus(null)
    setResult(null)
    setShowCalculation(false)
    try {
      setPhase('a')
      const a = await runSide(promptA, optionsA, controller.signal)
      // findWordCandidates keeps partial results when a query is stopped; a comparison
      // of a finished A with a half-explored B would be meaningless, so stop here.
      if (controller.signal.aborted) throw new LlmAbortedError()
      setPhase('b')
      const b = await runSide(promptB, optionsB, controller.signal)
      if (controller.signal.aborted) throw new LlmAbortedError()

      if (typeof a === 'string' || typeof b === 'string') {
        const answerA = typeof a === 'string' ? a : ''
        const answerB = typeof b === 'string' ? b : ''
        const answers = diffWords(answerA, answerB)
        const total = Math.max(answers.a.length, answers.b.length)
        setResult({
          layer: 'freeText',
          presetId: preset.id,
          modelName,
          answerA,
          answerB,
          diff: answers,
          band: freeTextBand(answers.changedWords, total),
        })
      } else {
        setResult({
          layer: preset.layer === 'nextWord' ? 'nextWord' : 'options',
          presetId: preset.id,
          modelName,
          verdict: compareScored(a.scored, b.scored),
          a,
          b,
        })
      }
    } catch (error) {
      // A stopped request may surface as the engine's own abort error or, from a
      // half-finished word search, as whatever the last query threw: the signal decides.
      if (error instanceof LlmAbortedError || controller.signal.aborted) {
        setStatus('stopped')
      } else {
        console.warn('Comparison failed:', error)
        setStatus('failed')
      }
    } finally {
      abortRef.current = null
      setPhase('idle')
    }
  }

  async function handleSave() {
    if (!result) return
    await saveExperiment({
      presetId: result.presetId,
      modelName: result.modelName,
      promptA,
      promptB,
      bet,
      band: result.layer === 'freeText' ? result.band : result.verdict.band,
      summary: verdictLine(result, t),
    })
    setExperiments(await listExperiments())
    setStatus('saved')
  }

  return (
    <section id="llm-compare" tabIndex={-1} aria-labelledby={`${formId}-title`} className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4">
      <header className="flex flex-col gap-1">
        <h2 id={`${formId}-title`} className="font-display text-xl">{t('compare.title')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('compare.intro')}</p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('compare.presetLabel')}</span>
        <select
          value={presetId}
          disabled={running}
          onChange={(event) => {
            choosePreset(event.target.value)
          }}
          className="min-h-touch rounded border border-border-subtle bg-surface px-2"
        >
          {(['sentiment', 'bias', 'prompt', 'hallucination'] as const).map((caseKind) => (
            <optgroup key={caseKind} label={t(`compare.cases.${caseKind}`)}>
              {COMPARE_PRESETS.filter((item) => item.caseKind === caseKind).map((item) => (
                <option key={item.id} value={item.id}>
                  {t(`compare.presets.${item.id}.label`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="text-xs text-ink-muted">{t(`compare.layer.${preset.layer}`)}</span>
      </label>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PromptField label={t('compare.promptA')} value={promptA} onChange={setPromptA} disabled={running} />
        <PromptField label={t('compare.promptB')} value={promptB} onChange={setPromptB} disabled={running} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={running}
          onClick={() => {
            setPromptB(promptA)
          }}
        >
          {t('compare.copyAtoB')}
        </Button>
        <Button
          variant="secondary"
          disabled={running}
          onClick={() => {
            choosePreset(presetId)
          }}
        >
          {t('compare.resetPreset')}
        </Button>
      </div>

      <DiffView diff={diff} />

      {preset.layer === 'options' ? (
        <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3 text-sm">
          <p className="font-medium">{t('compare.optionsHeading')}</p>
          <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
            <OptionList title={t('compare.promptA')} options={optionsA} />
            <OptionList title={t('compare.promptB')} options={optionsB} />
          </div>
          {preset.swapOptionsInB ? <p className="mt-2 text-ink-muted">{t('compare.optionsSwapped')}</p> : null}
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('compare.betLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {BETS.map((choice) => (
            <Button
              key={choice}
              variant={bet === choice ? 'primary' : 'secondary'}
              aria-pressed={bet === choice}
              disabled={running}
              onClick={() => {
                setBet(choice)
              }}
            >
              {t(`compare.bet.${choice}`)}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            void handleCompare()
          }}
          disabled={running || loadingModel || !engine || promptA.trim().length === 0 || promptB.trim().length === 0}
        >
          {t('compare.run')}
        </Button>
        {running ? (
          <Button
            variant="secondary"
            onClick={() => {
              abortRef.current?.abort()
            }}
          >
            {t('chat.stop')}
          </Button>
        ) : null}
        {running ? (
          <span role="status" className="text-sm text-ink-muted">
            {t(`compare.running.${phase}`)}
          </span>
        ) : null}
        {!engine && !loadingModel ? <p className="w-full text-sm text-ink-muted">{t('compare.noEngine')}</p> : null}
        {status === 'stopped' ? <p role="status" className="w-full text-sm text-ink-muted">{t('compare.stopped')}</p> : null}
        {status === 'failed' ? <p role="alert" className="w-full text-sm text-red-700">{t('compare.failed')}</p> : null}
      </div>

      {result ? (
        <ResultView
          result={result}
          bet={bet}
          caseKind={findPreset(result.presetId).caseKind}
          showCalculation={showCalculation}
          onToggleCalculation={() => {
            setShowCalculation((value) => !value)
          }}
          onSave={() => {
            void handleSave()
          }}
          saved={status === 'saved'}
        />
      ) : null}

      <SavedExperiments
        experiments={experiments}
        onDelete={(id) => {
          void deleteExperiment(id).then(() => listExperiments().then(setExperiments))
        }}
      />
    </section>
  )
}

type Translate = ReturnType<typeof useTranslation<'llm'>>['t']

function optionsFor(preset: ComparePreset, side: 'a' | 'b', t: Translate): AnswerOption[] {
  const letters = preset.letters ?? []
  const texts = letters.map((letter) => t(`compare.presets.${preset.id}.options.${letter}`))
  const ordered = side === 'b' && preset.swapOptionsInB ? [...texts].reverse() : texts
  return letters.map((letter, index) => ({ letter, text: ordered[index] ?? '' }))
}

/** The one-line reading of the verdict, shown on screen and stored with a saved experiment. */
function verdictLine(result: CompareResult, t: Translate): string {
  if (result.layer === 'freeText') return t('compare.verdict.freeText', { count: result.diff.changedWords })
  const { verdict } = result
  if (verdict.topA && verdict.topB && verdict.topA.toLocaleLowerCase() !== verdict.topB.toLocaleLowerCase()) {
    return t('compare.verdict.topChanged', { a: verdict.topA, b: verdict.topB })
  }
  const row = verdict.rows.find((item) => item.label === verdict.topA)
  if (row && row.a !== null && row.b !== null) {
    return t('compare.verdict.deltaTop', { label: row.label, a: percent(row.a), b: percent(row.b) })
  }
  return t('compare.verdict.unknownBody')
}

function PromptField({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <textarea
        value={value}
        disabled={disabled}
        rows={4}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="rounded border border-border-subtle bg-surface px-3 py-2"
      />
    </label>
  )
}

function Segments({ segments }: { readonly segments: readonly DiffSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index}>
          {index > 0 ? ' ' : ''}
          {segment.changed ? <mark className="rounded bg-amber-100 px-0.5 text-ink">{segment.text}</mark> : segment.text}
        </span>
      ))}
    </>
  )
}

function DiffView({ diff }: { readonly diff: WordDiff }) {
  const { t } = useTranslation('llm')
  return (
    <div className="rounded-lg border border-border-subtle p-3 text-sm" data-testid="compare-diff">
      <p className="font-medium">{t('compare.diffHeading')}</p>
      {diff.changedWords === 0 ? (
        <p className="text-ink-muted">{t('compare.diffNone')}</p>
      ) : (
        <>
          <p className="mt-1 break-words"><span className="font-medium">A:</span> <Segments segments={diff.a} /></p>
          <p className="mt-1 break-words"><span className="font-medium">B:</span> <Segments segments={diff.b} /></p>
          <p className={diff.changedWords > MAX_CONTROLLED_CHANGES ? 'mt-2 font-medium text-amber-800' : 'mt-2 text-ink-muted'}>
            {diff.changedWords > MAX_CONTROLLED_CHANGES
              ? t('compare.diffWarning', { count: diff.changedWords })
              : t('compare.diffCount', { count: diff.changedWords })}
          </p>
        </>
      )}
    </div>
  )
}

function OptionList({ title, options }: { readonly title: string; readonly options: readonly AnswerOption[] }) {
  return (
    <div>
      <p className="text-ink-muted">{title}</p>
      <ul className="list-none p-0">
        {options.map((option) => (
          <li key={option.letter}>
            {option.letter}) {option.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResultView({
  result,
  bet,
  caseKind,
  showCalculation,
  onToggleCalculation,
  onSave,
  saved,
}: {
  readonly result: CompareResult
  readonly bet: BetChoice | null
  readonly caseKind: ComparePreset['caseKind']
  readonly showCalculation: boolean
  readonly onToggleCalculation: () => void
  readonly onSave: () => void
  readonly saved: boolean
}) {
  const { t } = useTranslation('llm')
  const band = result.layer === 'freeText' ? result.band : result.verdict.band

  return (
    <div className="flex flex-col gap-3" data-testid="compare-result">
      <p className="text-xs text-ink-muted">{t('compare.conditions', { model: result.modelName })}</p>

      {result.layer === 'freeText' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <AnswerCard title={t('compare.promptA')} segments={result.diff.a} />
          <AnswerCard title={t('compare.promptB')} segments={result.diff.b} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ScoreColumn title={t('compare.promptA')} side="a" verdict={result.verdict} other={result.a.other} />
            <ScoreColumn title={t('compare.promptB')} side="b" verdict={result.verdict} other={result.b.other} />
          </div>
          {[result.a.other, result.b.other].some((other) => other !== null && other > OFF_FORMAT_THRESHOLD) ? (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              {t('compare.offFormat', { percent: percent(Math.max(result.a.other ?? 0, result.b.other ?? 0)) })}
            </p>
          ) : null}
        </>
      )}

      <section
        aria-live="polite"
        data-testid="compare-verdict"
        className={[
          'flex flex-col gap-1 rounded border p-3 text-sm',
          band === 'large' ? 'border-magenta' : 'border-border-subtle',
        ].join(' ')}
      >
        <h3 className="font-semibold">
          {t('compare.verdict.heading')} <span data-testid="compare-band">{t(`compare.verdict.${band}`)}</span>
        </h3>
        <p>{verdictLine(result, t)}</p>
        {bet ? <p className="text-ink-muted">{t('compare.verdict.yourBet', { bet: t(`compare.bet.${bet}`) })}</p> : null}
        <p className="text-ink-muted">{t(`compare.verdict.note.${caseKind}`)}</p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {result.layer !== 'freeText' ? (
          <Button variant="secondary" aria-expanded={showCalculation} onClick={onToggleCalculation}>
            {showCalculation ? t('compare.hideCalculation') : t('compare.showCalculation')}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onSave} disabled={saved}>
          {t('compare.save')}
        </Button>
        {saved ? <p role="status" className="text-sm text-ink-muted">{t('compare.saved')}</p> : null}
      </div>

      {showCalculation && result.layer !== 'freeText' ? (
        <div className="rounded-lg bg-surface-sunken p-3 font-mono text-xs text-ink-muted">
          <p className="font-body text-sm">
            {result.layer === 'options' ? t('compare.calculationOptions') : t('compare.calculationNextWord')}
          </p>
          {(['a', 'b'] as const).map((side) => (
            <div key={side} className="mt-2">
              <p className="font-body font-medium text-ink">{side === 'a' ? t('compare.promptA') : t('compare.promptB')}</p>
              {result[side].calculation.map((line, index) => (
                <p key={index} className="break-words">{line}</p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ScoreColumn({
  title,
  side,
  verdict,
  other,
}: {
  readonly title: string
  readonly side: 'a' | 'b'
  readonly verdict: ComparisonVerdict
  readonly other: number | null
}) {
  const { t } = useTranslation('llm')
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-subtle bg-white p-3" data-testid={`compare-column-${side}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {verdict.rows.map((row) => {
        const value = row[side]
        const delta = side === 'b' && row.delta !== null ? Math.round(row.delta * 100) : null
        const deltaText =
          delta === null ? '' : delta === 0 ? ` · ${t('compare.deltaNone')}` : ` · ${t(delta > 0 ? 'compare.deltaUp' : 'compare.deltaDown', { points: Math.abs(delta) })}`
        return (
          <Meter
            key={row.label}
            label={row.label}
            value={value ?? 0}
            valueText={value === null ? t('compare.notMeasured') : `${percent(value)} %${deltaText}`}
          />
        )
      })}
      {other !== null ? <Meter label={t('compare.other')} value={other} valueText={`${percent(other)} %`} /> : null}
    </div>
  )
}

function AnswerCard({ title, segments }: { readonly title: string; readonly segments: readonly DiffSegment[] }) {
  const { t } = useTranslation('llm')
  return (
    <article className="min-w-0 rounded-lg border border-border-subtle bg-white p-3 text-sm">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap break-words leading-6">
        {segments.length > 0 ? <Segments segments={segments} /> : t('chat.noOutput')}
      </p>
    </article>
  )
}

function SavedExperiments({
  experiments,
  onDelete,
}: {
  readonly experiments: readonly LlmExperiment[]
  readonly onDelete: (id: string) => void
}) {
  const { t, i18n } = useTranslation('llm')
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' })
  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <h3 className="text-sm font-semibold">{t('compare.savedHeading')}</h3>
      {experiments.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('compare.savedEmpty')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {experiments.map((experiment) => (
            <li key={experiment.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-border-subtle p-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t('compare.savedItem', {
                    preset: t(`compare.presets.${experiment.presetId}.label`),
                    band: t(`compare.verdict.${experiment.band}`),
                    model: experiment.modelName,
                    date: format.format(new Date(experiment.createdAt)),
                  })}
                </p>
                <p className="text-ink-muted">{experiment.summary}</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  onDelete(experiment.id)
                }}
              >
                {t('compare.deleteSaved')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
