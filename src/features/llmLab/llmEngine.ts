import { createOnnxWorkerEngine } from './onnxWorkerEngine'
import { cleanTurns, REPETITION_PENALTY, TOP_K } from './generation'
import {
  buildRawChatPrompt,
  getWebLlmModelId,
  type WebLlmModelId,
  type LabModelId,
} from './webllm'
import type { ModelTokenAlternative } from './wordCompletion'

export type LlmBackend = 'gpu' | 'cpu'

export interface ChatTurn {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

export interface LlmGenerationOptions {
  readonly temperature?: number
}

/** What the lab needs from a model: next-token alternatives and free-text chat replies. */
export interface LlmEngine {
  readonly backend: LlmBackend
  /**
   * Next-token alternatives after `assistantPrefix`, which is the start of the assistant's reply.
   * Rejects with `LlmAbortedError` if `signal` is aborted before the request starts.
   */
  nextTokenAlternatives(
    userMessage: string,
    assistantPrefix?: string,
    signal?: AbortSignal,
  ): Promise<readonly ModelTokenAlternative[]>
  /**
   * Generate a reply (greedy, at most `maxTokens` new tokens) for a conversation. Aborting
   * `signal` drops the request if it is still queued, or stops it mid-generation and
   * rejects with `LlmAbortedError`.
   */
  generate(
    messages: readonly ChatTurn[],
    maxTokens: number,
    signal?: AbortSignal,
    options?: LlmGenerationOptions,
  ): Promise<string>
  unload(): Promise<void>
}

/** The learner stopped a request. Not a failure: the interface says "stopped", not "error". */
export class LlmAbortedError extends Error {
  constructor() {
    super('The request was stopped')
    this.name = 'LlmAbortedError'
  }
}

/** An engine before serialisation: it can stop whatever it is generating right now. */
export interface RawLlmEngine {
  readonly backend: LlmBackend
  nextTokenAlternatives(userMessage: string, assistantPrefix?: string): Promise<readonly ModelTokenAlternative[]>
  generate(messages: readonly ChatTurn[], maxTokens: number, options?: LlmGenerationOptions): Promise<string>
  /** Stop the generation in progress, if any; it then resolves early with partial text. */
  interrupt(): void
  unload(): Promise<void>
}

interface GpuNavigator {
  readonly gpu?: {
    requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<unknown>
  }
}

export type WebGpuProblem = 'insecure' | 'unsupported' | 'noAdapter'

/** Returns why WebGPU cannot be used, or `null` when an adapter is available. */
async function findWebGpuProblem(): Promise<WebGpuProblem | null> {
  const gpu = (navigator as unknown as GpuNavigator).gpu
  if (!gpu) return window.isSecureContext ? 'unsupported' : 'insecure'
  // Chrome can hide the discrete GPU from a default request when the integrated one is
  // the active display adapter, so ask explicitly for the high-performance adapter too.
  for (const options of [{ powerPreference: 'high-performance' as const }, undefined]) {
    try {
      if ((await gpu.requestAdapter(options)) != null) return null
    } catch {
      // try the next option
    }
  }
  return 'noAdapter'
}

/** Thrown when the user picks the GPU engine but the browser exposes no usable WebGPU adapter. */
export class WebGpuUnavailableError extends Error {
  readonly reason: WebGpuProblem

  constructor(reason: WebGpuProblem) {
    super(`No usable WebGPU adapter (${reason})`)
    this.name = 'WebGpuUnavailableError'
    this.reason = reason
  }
}

/**
 * Create the engine for the backend the user chose: WebGPU (WebLLM) or a smaller model on
 * the CPU through WebAssembly. There is no automatic fallback; failures are reported so
 * the user can switch backend explicitly.
 */
export async function createLlmEngine(
  model: LabModelId,
  backend: LlmBackend,
  onProgress: (progress: number) => void,
): Promise<LlmEngine> {
  if (backend === 'cpu') {
    if (model === 'gemma4') throw new Error('Gemma 4 E2B requires WebGPU')
    return serialize(await createOnnxWorkerEngine(model, onProgress))
  }
  const problem = await findWebGpuProblem()
  if (problem) throw new WebGpuUnavailableError(problem)
  if (model === 'gemma4') return serialize(await createOnnxWorkerEngine(model, onProgress))
  return serialize(await createGpuEngine(model, onProgress))
}

/**
 * One model, one request at a time: the lab's sections share a single engine.
 *
 * A request carries its own abort signal. Aborting a queued request drops it before it
 * starts; aborting the running one interrupts the engine. The interrupt is only wired
 * while that request is the one running, because the engine's interrupt stops *whatever*
 * is generating, and one section's "Stop" must never cut off another section's answer.
 */
export function serialize(engine: RawLlmEngine): LlmEngine {
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const guarded = async (): Promise<T> => {
      if (signal?.aborted) throw new LlmAbortedError()
      const onAbort = () => {
        engine.interrupt()
      }
      signal?.addEventListener('abort', onAbort)
      try {
        const result = await task()
        if (signal?.aborted) throw new LlmAbortedError()
        return result
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    }
    const run = tail.then(guarded, guarded)
    tail = run.catch(() => undefined)
    return run
  }
  return {
    backend: engine.backend,
    nextTokenAlternatives: (userMessage, assistantPrefix, signal) =>
      enqueue(() => engine.nextTokenAlternatives(userMessage, assistantPrefix), signal),
    generate: (messages, maxTokens, signal, options) =>
      enqueue(() => engine.generate(messages, maxTokens, options), signal),
    unload: () => engine.unload(),
  }
}

async function createGpuEngine(
  model: WebLlmModelId,
  onProgress: (progress: number) => void,
): Promise<RawLlmEngine> {
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm')
  const engine = await CreateMLCEngine(getWebLlmModelId(model), {
    initProgressCallback: (report) => {
      onProgress(report.progress)
    },
  })

  return {
    backend: 'gpu',
    async nextTokenAlternatives(userMessage, assistantPrefix = '') {
      const completion = await engine.completions.create({
        prompt: buildRawChatPrompt(model, userMessage, assistantPrefix),
        // WebLLM clamps temperature 0 to 1e-6, which turns the softmax into a one-hot
        // distribution (every token reported at 100%). Temperature 1 keeps the model's
        // real probabilities; only the first token's top_logprobs are used, not the sample.
        temperature: 1,
        top_p: 1,
        max_tokens: 1,
        logprobs: true,
        top_logprobs: TOP_K,
      })
      return completion.choices[0]?.logprobs?.content?.[0]?.top_logprobs ?? []
    },
    async generate(messages, maxTokens, options) {
      const temperature = options?.temperature ?? 0
      const completion = await engine.chat.completions.create({
        messages: cleanTurns(messages),
        // Default to greedy; callers can opt into sampling for repeated-answer analysis.
        temperature,
        top_p: temperature > 0 ? 0.9 : 1,
        repetition_penalty: REPETITION_PENALTY,
        max_tokens: maxTokens,
      })
      return completion.choices[0]?.message.content?.trim() ?? ''
    },
    interrupt() {
      void engine.interruptGenerate()
    },
    async unload() {
      await engine.unload()
    },
  }
}
