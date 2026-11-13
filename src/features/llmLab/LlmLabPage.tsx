import { useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import {
  createLlmEngine,
  LlmAbortedError,
  WebGpuUnavailableError,
  type LlmBackend,
  type LlmEngine,
} from './llmEngine'
import { ReasoningChat } from './ReasoningChat'
import { ComparePanel } from './compare/ComparePanel'
import { WordLens } from './compare/WordLens'
import { RepeatMockup } from './compare/RepeatMockup'
import { LlmMissions } from './missions/LlmMissions'
import type { MissionTarget } from './missions/missions'
import { MODEL_DISPLAY_NAME } from './webllm'
import {
  buildWordCompletionPrompt,
  findWordCandidates,
  type WordCandidate,
  type WordPartialPath,
  type WordSearchProgress,
  type WordTokenScore,
} from './wordCompletion'

type ModelId = 'gemma' | 'llama' | 'qwen'

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

const MODEL_ORDER: readonly ModelId[] = ['gemma', 'llama', 'qwen']
const BACKEND_ORDER: readonly LlmBackend[] = ['gpu', 'cpu']
/** The same three tabs as the Lab CV: tools, challenges and missions. */
const LAB_TABS = ['tools', 'challenges', 'missions'] as const

/** Sentinel stored in `engineError` so the message is translated when rendered. */
const WEBGPU_UNAVAILABLE = 'webgpu-unavailable:'

// Engine creation and unloading share one WebGPU device. Running them concurrently
// (StrictMode double effects, switching models quickly) makes requestAdapter fail with
// "Unable to find a compatible GPU", so every load/unload is chained on this queue.
let engineQueue: Promise<unknown> = Promise.resolve()

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

  const [selectedModel, setSelectedModel] = useState<ModelId>('gemma')
  const [selectedBackend, setSelectedBackend] = useState<LlmBackend>('gpu')
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
    let createdEngine: LlmEngine | null = null

    setEngine(null)
    setLoadingModel(true)
    setLoadProgress(0)
    setEngineError(null)
    setGenerationError(null)

    async function initializeEngine() {
      if (!active) return
      try {
        const nextEngine =
          injectedTestEngine() ??
          (await createLlmEngine(selectedModel, selectedBackend, (progress) => {
            if (active) setLoadProgress(progress)
          }))
        createdEngine = nextEngine

        // If the model was switched or the page closed while loading, the cleanup
        // below unloads this engine once loading has settled.
        if (active) setEngine(nextEngine)
      } catch (error) {
        console.warn('WebLLM engine could not start:', error)
        if (active) {
          setEngine(null)
          setEngineError(
            error instanceof WebGpuUnavailableError
              ? `${WEBGPU_UNAVAILABLE}${error.reason}`
              : error instanceof Error
                ? error.message
                : 'WebLLM failed to initialize',
          )
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
      engineQueue = loadTask.then(async () => {
        if (createdEngine) await createdEngine.unload().catch(() => undefined)
      })
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
    ? {
        label: t('chat.status.loading'),
        tone: 'bg-amber-500',
        text: t('chat.loadingProgress', { percent: Math.round((loadProgress ?? 0) * 100) }),
      }
    : engineError
      ? { label: t('chat.status.error'), tone: 'bg-red-500', text: engineError.startsWith(WEBGPU_UNAVAILABLE) ? t(`chat.webGpuUnavailable.${engineError.slice(WEBGPU_UNAVAILABLE.length)}`) : t('chat.modelError', { error: engineError }) }
      : engine
        ? { label: t('chat.status.ready'), tone: 'bg-emerald-500', text: t(engine.backend === 'cpu' ? 'chat.modelReadyCpu' : 'chat.modelReady', { model: MODEL_DISPLAY_NAME[engine.backend][selectedModel] }) }
        : { label: t('chat.status.waiting'), tone: 'bg-slate-400', text: t('chat.loading') }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('intro')}</p>
      </header>

      <section aria-label={t('chat.modelLabel')} className="rounded-lg border border-border-subtle bg-surface p-4">
        <div className="min-w-0 md:max-w-xl">
          <p className="mb-2 text-sm font-medium text-ink">{t('chat.modelLabel')}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:grid-cols-1">
            {MODEL_ORDER.map((modelId) => (
              <Button
                key={modelId}
                type="button"
                variant={selectedModel === modelId ? 'primary' : 'secondary'}
                aria-pressed={selectedModel === modelId}
                disabled={isProcessingPrompt || compareRunning || lensRunning}
                onClick={() => {
                  setSelectedModel(modelId)
                }}
              >
                {t(`chat.models.${modelId}`)}
              </Button>
            ))}
          </div>
          <p className="mb-2 mt-4 text-sm font-medium text-ink">{t('chat.backendLabel')}</p>
          <div className="grid grid-cols-2 gap-2">
            {BACKEND_ORDER.map((backendId) => (
              <Button
                key={backendId}
                type="button"
                variant={selectedBackend === backendId ? 'primary' : 'secondary'}
                aria-pressed={selectedBackend === backendId}
                disabled={isProcessingPrompt || compareRunning || lensRunning}
                onClick={() => {
                  setSelectedBackend(backendId)
                }}
              >
                {t(`chat.backends.${backendId}`)}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{t(`chat.backendHint.${selectedBackend}`)}</p>
          <div
            aria-live="polite"
            className="mt-3 flex items-center gap-2 rounded-full border border-border-subtle bg-surface-sunken px-2.5 py-1.5"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${modelStatus.tone}`} aria-hidden="true" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t('chat.status.label')}</span>
            <span className="text-xs text-ink">{modelStatus.label}</span>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{modelStatus.text}</p>
          {engineError && !loadingModel ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                setRetryKey((key) => key + 1)
              }}
            >
              {t('chat.retry')}
            </Button>
          ) : null}
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
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPrompt('')
                    }}
                  >
                    {t('common:action.clearPrompt')}
                  </Button>
                )}
                {stopped && !isProcessingPrompt ? (
                  <p role="status" className="w-full text-sm text-ink-muted">{t('chat.stopped')}</p>
                ) : null}
                {generationError ? (
                  <p role="alert" className="w-full text-sm text-red-700">{generationError}</p>
                ) : null}
                {isProcessingPrompt ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-amber-600" aria-hidden="true" />
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
                    className="ml-auto max-w-3xl rounded-2xl bg-blue px-4 py-3 text-ink-inverse shadow-sm"
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
              modelName={engine ? MODEL_DISPLAY_NAME[engine.backend][selectedModel] : t(`chat.models.${selectedModel}`)}
              onRunningChange={setCompareRunning}
              presetRequest={presetRequest}
            />
            <WordLens
              engine={engine}
              loadingModel={loadingModel}
              modelName={engine ? MODEL_DISPLAY_NAME[engine.backend][selectedModel] : t(`chat.models.${selectedModel}`)}
              onRunningChange={setLensRunning}
            />
            <RepeatMockup />
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
        <div className="mt-4 flex flex-col gap-2 rounded-xl bg-surface p-4">
          <h3 className="text-sm font-medium text-ink">{t('chat.wordOptionsTitle')}</h3>
          <p className="text-sm text-ink-muted">{t('chat.wordAnalysisDescription')}</p>
          {message.candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('chat.noCompleteWords')}</p>
          ) : null}
          {message.candidates.map((candidate) => (
            <article key={candidate.word} className="rounded-lg border border-border-subtle bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-lg font-semibold text-ink">{candidate.word}</h4>
                <span className="tabular-nums text-sm font-medium text-ink-muted">
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
