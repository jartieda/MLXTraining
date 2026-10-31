import { CreateMLCEngine } from '@mlc-ai/web-llm'
import { getCpuModelId, getWebLlmModelId, type WebLlmModelId } from './webllm'
import type { ModelTokenAlternative } from './wordCompletion'

export type LlmBackend = 'gpu' | 'cpu'

/** The only thing the lab needs from a model: the top next-token alternatives for a prompt. */
export interface LlmEngine {
  readonly backend: LlmBackend
  nextTokenAlternatives(userMessage: string): Promise<readonly ModelTokenAlternative[]>
  unload(): Promise<void>
}

const TOP_K = 3

interface GpuNavigator {
  readonly gpu?: { requestAdapter(): Promise<unknown> }
}

async function hasUsableWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as GpuNavigator).gpu
    if (!gpu) return false
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

/**
 * Prefer WebGPU (WebLLM). When the browser has no usable GPU adapter, or the GPU engine
 * fails to start, fall back to a smaller model running on the CPU through WebAssembly.
 */
export async function createLlmEngine(
  model: WebLlmModelId,
  onProgress: (progress: number) => void,
): Promise<LlmEngine> {
  if (await hasUsableWebGpu()) {
    try {
      return await createGpuEngine(model, onProgress)
    } catch (error) {
      console.warn('WebGPU engine failed, falling back to CPU:', error)
      onProgress(0)
    }
  }
  return createCpuEngine(model, onProgress)
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
    async nextTokenAlternatives(userMessage) {
      const completion = await engine.chat.completions.create({
        messages: [{ role: 'user', content: userMessage }],
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
  const causalLm = await AutoModelForCausalLM.from_pretrained(modelId, {
    dtype: 'q4',
    device: 'wasm',
    progress_callback: progressCallback,
  })
  onProgress(1)

  return {
    backend: 'cpu',
    async nextTokenAlternatives(userMessage) {
      const inputs = tokenizer.apply_chat_template(
        [{ role: 'user', content: userMessage }],
        { add_generation_prompt: true, return_dict: true },
      )
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
    async unload() {
      await causalLm.dispose()
    },
  }
}
