import { CreateMLCEngine } from '@mlc-ai/web-llm'
import { buildRawChatPrompt, CPU_DTYPE_MAP, getCpuModelId, getWebLlmModelId, type WebLlmModelId } from './webllm'
import type { ModelTokenAlternative } from './wordCompletion'

export type LlmBackend = 'gpu' | 'cpu'

export interface ChatTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** What the lab needs from a model: next-token alternatives and free-text chat replies. */
export interface LlmEngine {
  readonly backend: LlmBackend
  /** Next-token alternatives after `assistantPrefix`, which is the start of the assistant's reply. */
  nextTokenAlternatives(userMessage: string, assistantPrefix?: string): Promise<readonly ModelTokenAlternative[]>
  /** Generate a reply (greedy-ish, at most `maxTokens` new tokens) for a conversation. */
  generate(messages: readonly ChatTurn[], maxTokens: number): Promise<string>
  unload(): Promise<void>
}

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

/** One model, one request at a time: the lab's sections share a single engine. */
function serialize(engine: LlmEngine): LlmEngine {
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
  return {
    backend: engine.backend,
    nextTokenAlternatives: (userMessage, assistantPrefix) =>
      enqueue(() => engine.nextTokenAlternatives(userMessage, assistantPrefix)),
    generate: (messages, maxTokens) => enqueue(() => engine.generate(messages, maxTokens)),
    unload: () => engine.unload(),
  }
}

async function createGpuEngine(
  model: WebLlmModelId,
  onProgress: (progress: number) => void,
): Promise<LlmEngine> {
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
        messages: messages.map((turn) => ({ role: turn.role, content: turn.content })),
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: maxTokens,
      })
      return completion.choices[0]?.message.content?.trim() ?? ''
    },
    async unload() {
      await engine.unload()
    },
  }
}

async function createCpuEngine(
  model: WebLlmModelId,
  onProgress: (progress: number) => void,
): Promise<LlmEngine> {
  const { AutoTokenizer, AutoModelForCausalLM, env } = await import('@huggingface/transformers')

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

  return {
    backend: 'cpu',
    async nextTokenAlternatives(userMessage, assistantPrefix = '') {
      const prompt = tokenizer.apply_chat_template(
        [{ role: 'user', content: userMessage }],
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
        messages.map((turn) => ({ role: turn.role, content: turn.content })),
        { add_generation_prompt: true, tokenize: false },
      )
      const inputs = tokenizer(prompt, { add_special_tokens: false }) as {
        input_ids: { dims: number[] }
      }
      const promptLength = inputs.input_ids.dims[1] ?? 0
      const output = (await causalLm.generate({
        ...inputs,
        max_new_tokens: maxTokens,
        do_sample: false,
        repetition_penalty: 1.1,
      })) as unknown as {
        tolist(): (number | bigint)[][]
      }
      const generated = (output.tolist()[0] ?? []).slice(promptLength).map(Number)
      return tokenizer.decode(generated, { skip_special_tokens: true }).trim()
    },
    async unload() {
      await causalLm.dispose()
    },
  }
}
