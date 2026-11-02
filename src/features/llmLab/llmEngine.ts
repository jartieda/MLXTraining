import { CreateMLCEngine } from '@mlc-ai/web-llm'
import {
  buildRawChatPrompt,
  CPU_DTYPE_MAP,
  getCpuModelId,
  getWebLlmModelId,
  stripControlTokens,
  type WebLlmModelId,
} from './webllm'
import type { ModelTokenAlternative } from './wordCompletion'

export type LlmBackend = 'gpu' | 'cpu'

export interface ChatTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
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
  generate(messages: readonly ChatTurn[], maxTokens: number, signal?: AbortSignal): Promise<string>
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
  generate(messages: readonly ChatTurn[], maxTokens: number): Promise<string>
  /** Stop the generation in progress, if any; it then resolves early with partial text. */
  interrupt(): void
  unload(): Promise<void>
}

/** Learner-written text never reaches a template or tokenizer with control tokens in it. */
function cleanTurns(messages: readonly ChatTurn[]): { role: ChatTurn['role']; content: string }[] {
  return messages.map((turn) => ({ role: turn.role, content: stripControlTokens(turn.content) }))
}

/**
 * Generation settings shared by both engines, so one exercise behaves the same whichever
 * engine runs it: greedy decoding (reproducible in a classroom, where two learners
 * comparing answers should see the same one) with a light repetition penalty, which
 * small models need to avoid looping.
 */
const REPETITION_PENALTY = 1.1

const TOP_K = 3

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
  model: WebLlmModelId,
  backend: LlmBackend,
  onProgress: (progress: number) => void,
): Promise<LlmEngine> {
  if (backend === 'cpu') return serialize(await createCpuEngine(model, onProgress))
  const problem = await findWebGpuProblem()
  if (problem) throw new WebGpuUnavailableError(problem)
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
    generate: (messages, maxTokens, signal) => enqueue(() => engine.generate(messages, maxTokens), signal),
    unload: () => engine.unload(),
  }
}

async function createGpuEngine(
  model: WebLlmModelId,
  onProgress: (progress: number) => void,
): Promise<RawLlmEngine> {
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
    async generate(messages, maxTokens) {
      const completion = await engine.chat.completions.create({
        messages: cleanTurns(messages),
        // Greedy, like the CPU engine (WebLLM clamps 0 to 1e-6, which is argmax).
        temperature: 0,
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

async function createCpuEngine(
  model: WebLlmModelId,
  onProgress: (progress: number) => void,
): Promise<RawLlmEngine> {
  const { AutoTokenizer, AutoModelForCausalLM, InterruptableStoppingCriteria, env } = await import(
    '@huggingface/transformers'
  )

  // The ONNX Runtime WebAssembly files are served from this origin. The default is a CDN,
  // which the Content-Security-Policy (`script-src 'self'`) would block.
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } }
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = {
      mjs: new URL(
        '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
        import.meta.url,
      ).href,
      wasm: new URL(
        '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
        import.meta.url,
      ).href,
    }
  }

  const modelId = getCpuModelId(model)
  const files = new Map<string, { loaded: number; total: number }>()
  const progressCallback = (info: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== 'progress' || !info.file || !info.total) return
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total })
    let loaded = 0
    let total = 0
    for (const file of files.values()) {
      loaded += file.loaded
      total += file.total
    }
    onProgress(total > 0 ? loaded / total : 0)
  }

  const tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback: progressCallback })
  // See CPU_DTYPE_MAP: q4 builds (and Gemma's q8) use GatherBlockQuantized, which the
  // onnxruntime-web WebAssembly backend does not implement.
  const causalLm = await AutoModelForCausalLM.from_pretrained(modelId, {
    dtype: CPU_DTYPE_MAP[model],
    device: 'wasm',
    progress_callback: progressCallback,
  })
  onProgress(1)

  // One criterion for the engine's lifetime: requests are serialised, so at most one
  // generation reads it at a time, and it is reset before each one.
  const stopping = new InterruptableStoppingCriteria()

  return {
    backend: 'cpu',
    async nextTokenAlternatives(userMessage, assistantPrefix = '') {
      const prompt = tokenizer.apply_chat_template(
        [{ role: 'user', content: stripControlTokens(userMessage) }],
        { add_generation_prompt: true, tokenize: false },
      )
      const inputs = tokenizer(`${prompt}${assistantPrefix}`, { add_special_tokens: false })
      const { logits } = (await causalLm(inputs)) as {
        logits: { dims: number[]; data: ArrayLike<number>; dispose(): void }
      }

      try {
        const sequenceLength = logits.dims[1] ?? 1
        const vocabularySize = logits.dims[2] ?? 0
        const offset = (sequenceLength - 1) * vocabularySize

        let max = -Infinity
        for (let i = 0; i < vocabularySize; i++) {
          const value = logits.data[offset + i] ?? -Infinity
          if (value > max) max = value
        }
        let sum = 0
        const best: { id: number; value: number }[] = []
        for (let i = 0; i < vocabularySize; i++) {
          const value = logits.data[offset + i] ?? -Infinity
          sum += Math.exp(value - max)
          if (best.length < TOP_K || value > (best[best.length - 1]?.value ?? -Infinity)) {
            best.push({ id: i, value })
            best.sort((a, b) => b.value - a.value)
            if (best.length > TOP_K) best.pop()
          }
        }
        const logSum = Math.log(sum)

        return best.map(({ id, value }) => ({
          token: tokenizer.decode([id], { clean_up_tokenization_spaces: false }),
          logprob: value - max - logSum,
        }))
      } finally {
        logits.dispose()
      }
    },
    async generate(messages, maxTokens) {
      const prompt = tokenizer.apply_chat_template(
        cleanTurns(messages),
        { add_generation_prompt: true, tokenize: false },
      )
      const inputs = tokenizer(prompt, { add_special_tokens: false }) as {
        input_ids: { dims: number[] }
      }
      const promptLength = inputs.input_ids.dims[1] ?? 0
      stopping.reset()
      const output = (await causalLm.generate({
        ...inputs,
        max_new_tokens: maxTokens,
        do_sample: false,
        repetition_penalty: REPETITION_PENALTY,
        stopping_criteria: stopping,
      })) as unknown as {
        tolist(): (number | bigint)[][]
      }
      const generated = (output.tolist()[0] ?? []).slice(promptLength).map(Number)
      return tokenizer.decode(generated, { skip_special_tokens: true }).trim()
    },
    interrupt() {
      stopping.interrupt()
    },
    async unload() {
      await causalLm.dispose()
    },
  }
}
