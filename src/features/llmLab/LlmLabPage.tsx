import { useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import {
  createLlmEngine,
  LlmAbortedError,
  type LlmBackend,
  type LlmEngine,
} from './llmEngine'
import { ReasoningChat } from './ReasoningChat'
import { ComparePanel } from './compare/ComparePanel'
import { WordLens } from './compare/WordLens'
import { RepeatPanel } from './compare/RepeatPanel'
import { LlmMissions } from './missions/LlmMissions'
import type { MissionTarget } from './missions/missions'
import { modelDisplayName, type LabModelId } from './webllm'
import {
  buildWordCompletionPrompt,
  findWordCandidates,
  type WordCandidate,
  type WordPartialPath,
  type WordSearchProgress,
  type WordTokenScore,
} from './wordCompletion'

type ModelId = LabModelId

type ChatRole = 'user' | 'assistant'

interface ChatMessage {
  readonly id: string
  readonly role: ChatRole
  readonly prompt: string
  readonly reply: string
  readonly model: ModelId
  readonly candidates: readonly WordCandidate[]
  readonly partials: readonly WordPartialPath[]
  readonly open: boolean
}

const MODEL_ORDER: readonly ModelId[] = ['gemma', 'gemma4', 'llama', 'qwen']
const LOADING_INSIGHT_ORDER = ['tokens', 'explanation', 'probability', 'prompt', 'bias'] as const
const INSIGHT_ROTATION_MS = 5_000
/** The same three tabs as the Lab CV: tools, challenges and missions. */
const LAB_TABS = ['tools', 'challenges', 'missions'] as const

function LoadingInsight({ loading }: { readonly loading: boolean }) {
  const { t } = useTranslation('llm')
  const [insight, setInsight] = useState(() => {
    const index = Math.floor(Math.random() * LOADING_INSIGHT_ORDER.length)
    return LOADING_INSIGHT_ORDER[index] ?? LOADING_INSIGHT_ORDER[0]
  })

  useEffect(() => {
    if (!loading) return

    const interval = window.setInterval(() => {
      setInsight((current) => {
        const index = LOADING_INSIGHT_ORDER.indexOf(current)
        return LOADING_INSIGHT_ORDER[(index + 1) % LOADING_INSIGHT_ORDER.length] ?? LOADING_INSIGHT_ORDER[0]
      })
    }, INSIGHT_ROTATION_MS)
    return () => window.clearInterval(interval)
  }, [loading])

  return (
    <aside data-testid="loading-insight" className="rounded-xl border border-blue/30 bg-sky-100 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy font-display text-lg font-bold text-ink-inverse"
        >
          ?
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-ink">
            {t('chat.loadingActivity.title')}
          </p>
          <h2 className="mt-1 font-display text-base">
            {t(`chat.loadingActivity.items.${insight}.title`)}
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink">
            {t(`chat.loadingActivity.items.${insight}.text`)}
          </p>
        </div>
      </div>
    </aside>
  )
}

// Engine creation and unloading share one WebGPU device. Running them concurrently
// (StrictMode double effects, switching models quickly) makes requestAdapter fail with
// "Unable to find a compatible GPU", so every load/unload is chained on this queue.
let engineQueue: Promise<unknown> = Promise.resolve()
let retainedEngine: {
  readonly model: ModelId
  readonly backend: LlmBackend
  readonly engine: LlmEngine
} | null = null

/**
 * End-to-end tests (and a reviewer without access to the model CDN) can provide a fake
 * engine through `window.__ML4G_FAKE_LLM_ENGINE__`, set by Playwright's `addInitScript`
 * before the page loads. It only replaces which engine the page uses; the real engine
 * module is untouched. A page that does not set it behaves exactly as before.
 */
function injectedTestEngine(): LlmEngine | null {
  const candidate = (window as unknown as { __ML4G_FAKE_LLM_ENGINE__?: LlmEngine }).__ML4G_FAKE_LLM_ENGINE__
  return candidate ?? null
}

export function LlmLabPage() {
  const { t } = useTranslation(['llm', 'common'])
  const abortRef = useRef<AbortController | null>(null)
  const [stopped, setStopped] = useState(false)
  const [tab, setTab] = useState<(typeof LAB_TABS)[number]>('tools')
  const [compareRunning, setCompareRunning] = useState(false)
  const [lensRunning, setLensRunning] = useState(false)
  const [repeatRunning, setRepeatRunning] = useState(false)
  const [presetRequest, setPresetRequest] = useState<{ id: string; nonce: number } | null>(null)

  /** A mission's «Ir a…»: open the tab, pick the preset it needs and scroll to the tool. */
  function goToMissionTarget(target: MissionTarget) {
    setTab(target.tab)
    if (target.presetId) setPresetRequest({ id: target.presetId, nonce: Date.now() })
    if (target.anchor) {
      const anchor = target.anchor
      // After the tab panel is shown, or there is nothing to scroll to yet.
      requestAnimationFrame(() => {
        const element = document.getElementById(anchor)
        element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        element?.focus({ preventScroll: true })
      })
    }
  }

  const [{ model: selectedModel, backend: selectedBackend }, setModelSelection] = useState<{
    model: ModelId
    backend: LlmBackend
  }>(() => ({
    model: retainedEngine?.model ?? 'gemma',
    backend: retainedEngine?.backend ?? 'gpu',
  }))
  const [loadingModel, setLoadingModel] = useState(false)
  const [engine, setEngine] = useState<LlmEngine | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<readonly ChatMessage[]>([])
  const [isProcessingPrompt, setIsProcessingPrompt] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<WordSearchProgress | null>(null)
  const [loadProgress, setLoadProgress] = useState<number | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let active = true

    setEngine(null)
    setLoadingModel(true)
    setLoadProgress(0)
    setEngineError(null)
    setGenerationError(null)

    async function initializeEngine() {
      if (!active) return
      try {
        if (
          retainedEngine &&
          (retainedEngine.model !== selectedModel || retainedEngine.backend !== selectedBackend)
        ) {
          const previousEngine = retainedEngine.engine
          retainedEngine = null
          await previousEngine.unload().catch(() => undefined)
        }

        if (!active) return

        const nextEngine =
          retainedEngine?.engine ??
          injectedTestEngine() ??
          (await createLlmEngine(selectedModel, selectedBackend, (progress) => {
            if (active) setLoadProgress(progress)
          }))

        retainedEngine ??= { model: selectedModel, backend: selectedBackend, engine: nextEngine }
        if (active) setEngine(nextEngine)
      } catch (error) {
        if (active) {
          setEngine(null)
          if (selectedBackend === 'gpu' || selectedModel !== 'qwen') {
            // Qwen is the lightweight fallback when the selected model fails to load.
            setModelSelection({ model: 'qwen', backend: 'cpu' })
            return
          }
          console.warn('Local model could not start:', error)
          setEngineError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (active) {
          setLoadingModel(false)
        }
      }
    }

    const loadTask = engineQueue.then(initializeEngine)
    engineQueue = loadTask

    return () => {
      active = false
    }
  }, [selectedModel, selectedBackend, retryKey])

  async function handleSubmitPrompt() {
    const trimmed = prompt.trim()
    if (trimmed.length === 0 || isProcessingPrompt) return
    if (!engine) {
      setGenerationError(t('chat.modelUnavailable'))
      return
    }

    const submittedModel = selectedModel
    const controller = new AbortController()
    abortRef.current = controller
    setStopped(false)
    setGenerationError(null)
    setGenerationProgress({ modelCalls: 0, candidates: [], partials: [] })
    setIsProcessingPrompt(true)

    try {
      const generated = await buildChatTurn(trimmed, engine, t, controller.signal, setGenerationProgress)
      if (controller.signal.aborted) setStopped(true)
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        prompt: trimmed,
        reply: '',
        model: submittedModel,
        candidates: [],
        partials: [],
        open: false,
      }
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        prompt: trimmed,
        reply: generated.reply,
        model: submittedModel,
        candidates: generated.candidates,
        partials: generated.partials,
        open: true,
      }

      setMessages((current) => [userMessage, assistantMessage, ...current].slice(0, 4))
    } catch (error) {
      if (error instanceof LlmAbortedError) {
        setStopped(true)
      } else {
        console.warn('WebLLM generation failed:', error)
        setGenerationError(t('chat.generationFailed'))
      }
    } finally {
      abortRef.current = null
      setIsProcessingPrompt(false)
      setGenerationProgress(null)
    }
  }

  function toggleExplanation(id: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id && message.role === 'assistant'
          ? { ...message, open: !message.open }
          : message,
      ),
    )
  }

  const modelStatus = loadingModel
    ? { label: t('chat.status.loading'), tone: 'bg-amber-500' }
    : engineError
      ? { label: t('chat.status.error'), tone: 'bg-red-500' }
      : engine
        ? { label: t('chat.status.ready'), tone: 'bg-emerald-500' }
        : { label: t('chat.status.waiting'), tone: 'bg-slate-400' }

  return (
    <div className="flex flex-col gap-5 wrap-anywhere sm:gap-8">
      <header className="flex items-start gap-3 sm:items-center">
        <img
          src="/icons/lab-llm-chat.png"
          alt=""
          aria-hidden="true"
          className="size-10 shrink-0 object-contain sm:size-16"
        />
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl sm:text-3xl">{t('title')}</h1>
          <p className="max-w-prose text-ink-muted">{t('intro')}</p>
        </div>
      </header>

      <section aria-label={t('chat.modelLabel')} className="@container rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5">
        <div className="grid items-start gap-4 @min-[56rem]:grid-cols-[minmax(0,1fr)_16rem]">
          <fieldset className="@container min-w-0">
            <legend className="text-sm font-semibold text-ink">{t('chat.modelLabel')}</legend>
            <div role="group" aria-label={t('chat.modelLabel')} className="mt-2 grid grid-cols-1 gap-2 @min-[18rem]:grid-cols-2 @min-[37.5rem]:grid-cols-4">
              {MODEL_ORDER.map((modelId) => {
                const selected = selectedModel === modelId
                const descriptionId = `llm-model-description-${modelId}`
                return (
                  <button
                    key={modelId}
                    type="button"
                    aria-label={t(`chat.models.${modelId}`)}
                    aria-describedby={descriptionId}
                    aria-pressed={selected}
                    disabled={isProcessingPrompt || compareRunning || lensRunning || repeatRunning}
                    onClick={() => setModelSelection({
                      model: modelId,
                      backend: modelId === 'gemma4' ? 'gpu' : selectedBackend,
                    })}
                    className={[
                      'flex min-h-touch min-w-0 items-start rounded-lg border px-2.5 py-2 text-left transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      selected
                        ? 'border-blue bg-sky-100 shadow-sm'
                        : 'border-border-subtle bg-surface hover:border-blue hover:bg-surface-sunken',
                    ].join(' ')}
                  >
                    <span id={descriptionId} className="flex flex-col items-start gap-0.5 leading-tight">
                      <span className="text-sm font-semibold text-ink">{t(`chat.models.${modelId}`)}</span>
                      <span className="text-xs text-ink-muted">
                        {t(`chat.modelDetails.${modelId}`)}
                      </span>
                      <span className="text-xs font-medium text-blue-ink">
                        GPU · {modelDisplayName('gpu', modelId)}
                      </span>
                      <span className="text-xs font-medium text-blue-ink">
                        CPU · {modelId === 'gemma4' ? t('chat.noCpuVariant') : modelDisplayName('cpu', modelId)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <aside className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface-sunken p-4" aria-label={t('chat.status.label')}>
            <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {loadingModel ? (
                <span
                  aria-hidden="true"
                  className="size-4 motion-safe:animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
                />
              ) : (
                <span className={`size-2.5 rounded-full ${modelStatus.tone}`} aria-hidden="true" />
              )}
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {t('chat.status.label')}
              </span>
              <span className="text-sm font-medium text-ink">{modelStatus.label}</span>
            </div>
            <div className="text-sm leading-6 text-ink-muted" aria-live="polite">
              {loadingModel ? (
                <p>
                  {t('chat.loadingModel', { model: modelDisplayName(selectedBackend, selectedModel) })}
                  <span className="ml-2 tabular-nums" aria-hidden="true">
                    {t('chat.loadingProgressPercent', { percent: Math.round((loadProgress ?? 0) * 100) })}
                  </span>
                </p>
              ) : engineError ? (
                <p>{t('chat.modelError', { error: engineError })}</p>
              ) : engine ? (
                <p>{t(engine.backend === 'cpu' ? 'chat.modelReadyCpu' : 'chat.modelReady', {
                  model: modelDisplayName(engine.backend, selectedModel),
                })}</p>
              ) : null}
            </div>
            {engineError && !loadingModel ? (
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => setRetryKey((key) => key + 1)}
              >
                {t('chat.retry')}
              </Button>
            ) : null}
            <LoadingInsight loading={loadingModel} />
          </aside>
        </div>
      </section>

      {/* Tabs rather than one long page. Every panel stays mounted (hidden, not
          unmounted) so switching tab never throws away an answer or a comparison. */}
      <div role="tablist" aria-label={t('compare.tab.label')} className="flex flex-wrap gap-2">
        {LAB_TABS.map((id) => (
          <Button
            key={id}
            role="tab"
            id={`llm-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`llm-panel-${id}`}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => {
              setTab(id)
            }}
          >
            {t(`compare.tab.${id}`)}
          </Button>
        ))}
      </div>

      <div role="tabpanel" id="llm-panel-tools" aria-labelledby="llm-tab-tools" hidden={tab !== 'tools'}>
        <div className="flex flex-col gap-8">
          <p className="max-w-prose text-sm text-ink-muted">{t('labTabs.toolsIntro')}</p>
          <section id="llm-next-word" tabIndex={-1} className="rounded-lg border border-border-subtle bg-surface p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-xl">{t('chat.title')}</h2>
                <p className="max-w-prose text-sm text-ink-muted">{t('chat.intro')}</p>
              </div>

            </div>

            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-sunken p-4">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('chat.promptLabel')}</span>
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value)
                  }}
                  rows={3}
                  placeholder={t('chat.promptPlaceholder')}
                  className="rounded border border-border-subtle bg-surface px-3 py-2"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  busy={isProcessingPrompt}
                  onClick={() => {
                    void handleSubmitPrompt()
                  }}
                  disabled={isProcessingPrompt || loadingModel || !engine || prompt.trim().length === 0}
                >
                  {isProcessingPrompt ? t('chat.processing') : t('chat.send')}
                </Button>
                {isProcessingPrompt ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      abortRef.current?.abort()
                    }}
                  >
                    {t('chat.stop')}
                  </Button>
                ) : null}
                {stopped && !isProcessingPrompt ? (
                  <p role="status" className="w-full text-sm text-ink-muted">{t('chat.stopped')}</p>
                ) : null}
                {generationError ? (
                  <p role="alert" className="w-full text-sm text-red-700">{generationError}</p>
                ) : null}
                {isProcessingPrompt ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <span
                      className="size-3 motion-safe:animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
                      aria-hidden="true"
                    />
                    {t('chat.processing')}
                  </span>
                ) : null}
                {isProcessingPrompt && generationProgress ? (
                  <SearchTrace progress={generationProgress} t={t} />
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-4">
              {messages.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-subtle bg-surface px-4 py-3 text-sm text-ink-muted">
                  {t('chat.empty')}
                </p>
              ) : null}

              {messages.map((message) =>
                message.role === 'user' ? (
                  <article
                    key={message.id}
                    className="ml-auto max-w-[min(100%,48rem)] rounded-2xl bg-blue px-4 py-3 text-ink-inverse shadow-sm"
                  >
                    <p className="text-xs uppercase tracking-wide opacity-80">{t('chat.userLabel')}</p>
                    <p className="mt-1 text-sm leading-6">{message.prompt}</p>
                  </article>
                ) : (
                  <AssistantCard
                    key={message.id}
                    message={message}
                    t={t}
                    onToggle={() => {
                      toggleExplanation(message.id)
                    }}
                  />
                ),
              )}
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <ComparePanel
              engine={engine}
              loadingModel={loadingModel}
              modelName={engine ? modelDisplayName(engine.backend, selectedModel) : t(`chat.models.${selectedModel}`)}
              onRunningChange={setCompareRunning}
              presetRequest={presetRequest}
            />
            <WordLens
              engine={engine}
              loadingModel={loadingModel}
              modelName={engine ? modelDisplayName(engine.backend, selectedModel) : t(`chat.models.${selectedModel}`)}
              onRunningChange={setLensRunning}
            />
            <RepeatPanel
              engine={engine}
              loadingModel={loadingModel}
              onRunningChange={setRepeatRunning}
            />
          </div>
        </div>
      </div>

      <div role="tabpanel" id="llm-panel-challenges" aria-labelledby="llm-tab-challenges" hidden={tab !== 'challenges'}>
        <div className="flex flex-col gap-8">
          <p className="max-w-prose text-sm text-ink-muted">{t('labTabs.challengesIntro')}</p>
          <ReasoningChat key={`${selectedModel}-${selectedBackend}-${retryKey}`} engine={engine} loadingModel={loadingModel} />
          <ReasoningChat
            key={`sentiment-${selectedModel}-${selectedBackend}-${retryKey}`}
            variant="sentiment"
            engine={engine}
            loadingModel={loadingModel}
          />
          <ReasoningChat
            key={`bias-${selectedModel}-${selectedBackend}-${retryKey}`}
            variant="bias"
            engine={engine}
            loadingModel={loadingModel}
          />
          <ReasoningChat
            key={`deception-${selectedModel}-${selectedBackend}-${retryKey}`}
            variant="deception"
            engine={engine}
            loadingModel={loadingModel}
          />
        </div>
      </div>

      <div role="tabpanel" id="llm-panel-missions" aria-labelledby="llm-tab-missions" hidden={tab !== 'missions'}>
        <LlmMissions onGoTo={goToMissionTarget} />
      </div>
    </div>
  )
}

function AssistantCard({
  message,
  t,
  onToggle,
}: {
  readonly message: ChatMessage
  readonly t: TFunction<'llm'>
  readonly onToggle: () => void
}) {
  return (
    <article className="max-w-4xl rounded-2xl border border-border-subtle bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-muted">{t('chat.modelLabel')} · {t(`chat.models.${message.model}`)}</p>
          <p className="mt-1 text-sm leading-6 text-ink">
            {t('chat.replyPrefix')} {message.reply || t('chat.noOutput')}
          </p>
        </div>

        <Button variant="secondary" onClick={onToggle} aria-expanded={message.open}>
          {t('chat.why')}
        </Button>
      </div>

      {message.open ? (
        <div className="mt-4 flex flex-col gap-2 rounded-xl bg-surface p-3 sm:p-4">
          <h3 className="text-sm font-medium text-ink">{t('chat.wordOptionsTitle')}</h3>
          <p className="text-sm text-ink-muted">{t('chat.wordAnalysisDescription')}</p>
          {message.candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('chat.noCompleteWords')}</p>
          ) : null}
          {message.candidates.map((candidate) => (
            <article key={candidate.word} className="rounded-lg border border-border-subtle bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="min-w-0 text-lg font-semibold text-ink">{candidate.word}</h4>
                <span className="shrink-0 tabular-nums text-sm font-medium text-ink-muted">
                  {simplePercent(candidate.probability)}
                </span>
              </div>
              {/* Simple view first: whole percentages. The token arithmetic, with its
                  decimals and ␣ marks, is one click away rather than in the way. */}
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-ink-muted">{t('compare.showCalculation')}</summary>
                {candidate.paths.map((path, pathIndex) => (
                  <p key={`${candidate.word}-${pathIndex}`} className="mt-2 break-words font-mono text-xs text-ink-muted">
                    <TokenProduct tokens={path.tokens} total={path.probability} />
                  </p>
                ))}
                {candidate.paths.length > 1 ? (
                  <p className="mt-2 text-xs font-medium text-ink-muted">
                    {t('chat.mergedWordScore', {
                      calculation: candidate.paths
                        .map((path) => `${(path.probability * 100).toFixed(4)}%`)
                        .join(' + '),
                      total: (candidate.probability * 100).toFixed(4),
                    })}
                  </p>
                ) : null}
              </details>
            </article>
          ))}
          {message.partials.length > 0 ? (
            <div className="rounded-lg border border-dashed border-border-subtle bg-white p-3">
              <h4 className="text-sm font-medium text-ink">{t('chat.partialOutput')}</h4>
              {message.partials.map((partial, index) => (
                <p key={`${partial.text}-${index}`} className="mt-2 break-words font-mono text-xs text-ink-muted">
                  {partial.text}{' · '}
                  <TokenProduct tokens={partial.tokens} total={partial.probability} />
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function SearchTrace({
  progress,
  t,
}: {
  readonly progress: WordSearchProgress
  readonly t: TFunction<'llm'>
}) {
  return (
    <div aria-live="polite" className="w-full rounded-lg border border-border-subtle bg-white p-3">
      <p className="text-xs font-medium text-ink">{t('chat.traceCalls', { count: progress.modelCalls })}</p>
      {progress.candidates.map((candidate) => (
        <div key={candidate.word} className="mt-1 text-xs text-ink-muted">
          <p>{t('chat.traceWord', { word: candidate.word })} · {(candidate.probability * 100).toFixed(3)}%</p>
          {candidate.paths.slice(0, 1).map((path, index) => (
            <p key={index} className="break-words font-mono">
              <TokenProduct tokens={path.tokens} total={path.probability} />
            </p>
          ))}
        </div>
      ))}
      {progress.partials.map((partial, index) => (
        <p key={`${partial.text}-${index}`} className="mt-1 break-words font-mono text-xs text-ink-muted">
          {t('chat.tracePartial', { text: partial.text })}:{' '}
          <TokenProduct tokens={partial.tokens} total={partial.probability} />
        </p>
      ))}
    </div>
  )
}

function TokenProduct({
  tokens,
  total,
}: {
  readonly tokens: readonly WordTokenScore[]
  readonly total: number
}) {
  return (
    <>
      {tokens.map((token, tokenIndex) => (
        <span key={`${token.token}-${tokenIndex}`}>
          {tokenIndex > 0 ? ' × ' : ''}
          {visibleToken(token.token)} ({(token.probability * 100).toFixed(2)}%)
        </span>
      ))}
      {' = '}{(total * 100).toFixed(4)}%
    </>
  )
}

/** Whole percentages for the simple view; below 1 % says so instead of showing «0 %». */
function simplePercent(probability: number): string {
  const percent = probability * 100
  return percent > 0 && percent < 1 ? '< 1 %' : `${String(Math.round(percent))} %`
}

/** Make whitespace-only tokens readable instead of rendering them as nothing. */
function visibleToken(token: string): string {
  if (token.length === 0) return '∅'
  return token.replace(/\n/g, '↵').replace(/ /g, '␣')
}

async function buildChatTurn(
  prompt: string,
  engine: LlmEngine,
  t: TFunction<'llm'>,
  signal: AbortSignal,
  onProgress: (progress: WordSearchProgress) => void,
) {
  let latestProgress: WordSearchProgress = { modelCalls: 0, candidates: [], partials: [] }
  // Stopping makes the next query reject; the search then returns what it already found
  // (or rethrows if it had found nothing), so a stop keeps the work done so far.
  const candidates = await findWordCandidates(async (partialWord) => {
    return engine.nextTokenAlternatives(
      buildWordCompletionPrompt(
        prompt,
        t('chat.wordCompletionInstruction'),
        t('chat.wordCompletionOutputInstruction'),
      ),
      partialWord,
      signal,
    )
  }, {
    onProgress: (progress) => {
      latestProgress = progress
      onProgress(progress)
    },
  })
  const partials = latestProgress.partials

  return {
    reply: candidates[0]?.word ?? partials[0]?.text ?? '',
    candidates,
    partials,
  }
}
