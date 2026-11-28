import type { RawLlmEngine } from './llmEngine'
import type { OnnxRequest } from './onnxWorkerEngine'
import { CPU_DTYPE_MAP, GEMMA4_ONNX_ID, getCpuModelId, stripControlTokens, type LabModelId } from './webllm'
import { cleanTurns, REPETITION_PENALTY, TOP_K } from './generation'

let engine: RawLlmEngine | undefined
self.onmessage = async ({ data }: MessageEvent<OnnxRequest>) => {
  try {
    if (data.type === 'interrupt') {
      engine?.interrupt()
      return
    }
    if (data.type === 'load') {
      engine = await createOnnxEngine(data.model, progress => self.postMessage({ progress }))
      self.postMessage({ result: undefined })
      return
    }
    if (!engine) throw new Error('ONNX model unavailable')
    const result = data.type === 'generate'
      ? await engine.generate(...data.args)
      : await engine.nextTokenAlternatives(...data.args)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}

async function createOnnxEngine(
  model: LabModelId,
  onProgress: (progress: number) => void,
): Promise<RawLlmEngine> {
  const { AutoTokenizer, AutoModelForCausalLM, InterruptableStoppingCriteria, Tensor, env } = await import(
    '@huggingface/transformers'
  )

  // The ONNX Runtime WebAssembly files are served from this origin. The default is a CDN,
  // which the Content-Security-Policy (`script-src 'self'`) would block.
  const gemma4 = model === 'gemma4'
  const modelId = gemma4 ? GEMMA4_ONNX_ID : getCpuModelId(model)
  const marker = await fetch(`/models/${modelId}/ready.json`, { cache: 'no-cache' })
  // Static SPA hosts may serve index.html with status 200 for missing files.
  const local = marker.ok && marker.headers.get('content-type')?.includes('application/json') === true
  env.allowLocalModels = local
  env.allowRemoteModels = !local
  if (local) env.useBrowserCache = false
  env.useWasmCache = false
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } }
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = gemma4 ? {
      mjs: new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
      wasm: new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
    } : {
      mjs: new URL(
        '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
        import.meta.url,
      ).href,
      wasm: new URL(
        '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
        import.meta.url,
      ).href,
    }
  }

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
    dtype: gemma4 ? 'q4' : CPU_DTYPE_MAP[model],
    device: gemma4 ? 'webgpu' : 'wasm',
    progress_callback: progressCallback,
  })
  onProgress(1)

  // One criterion for the engine's lifetime: requests are serialised, so at most one
  // generation reads it at a time, and it is reset before each one.
  const chatTemplateOptions = {
    add_generation_prompt: true, tokenize: false, ...(gemma4 ? { enable_thinking: false } : {}),
  } as const
  const stopping = new InterruptableStoppingCriteria()
  // Gemma 4 can return just the final position instead of a vocabulary-sized
  // vector for every prompt token. The lens only scores the next token.
  const lastLogits = gemma4 ? { num_logits_to_keep: new Tensor('int64', [1n], []) } : {}

  return {
    backend: gemma4 ? 'gpu' : 'cpu',
    async nextTokenAlternatives(userMessage, assistantPrefix = '') {
      const prompt = tokenizer.apply_chat_template(
        [{ role: 'user', content: stripControlTokens(userMessage) }],
        chatTemplateOptions,
      )
      const inputs = tokenizer(`${prompt}${assistantPrefix}`, { add_special_tokens: false })
      const outputs = (await causalLm({ ...inputs, ...lastLogits })) as {
        [name: string]: { dispose(): void }
        logits: { dims: number[]; data: ArrayLike<number>; dispose(): void }
      }

      const { logits } = outputs
      try {
        const sequenceLength = logits.dims[1] ?? 1
        const vocabularySize = logits.dims[2] ?? 0
        const offset = (sequenceLength - 1) * vocabularySize
        const data = logits.data

        let max = -Infinity
        for (let i = 0; i < vocabularySize; i++) {
          const value = data[offset + i] ?? -Infinity
          if (value > max) max = value
        }
        let sum = 0
        const best: { id: number; value: number }[] = []
        for (let i = 0; i < vocabularySize; i++) {
          const value = data[offset + i] ?? -Infinity
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
        for (const tensor of Object.values(outputs)) tensor.dispose()
      }
    },
    async generate(messages, maxTokens, options) {
      const temperature = options?.temperature ?? 0
      const prompt = tokenizer.apply_chat_template(
        cleanTurns(messages),
        chatTemplateOptions,
      )
      const inputs = tokenizer(prompt, { add_special_tokens: false }) as {
        input_ids: { dims: number[] }
      }
      const promptLength = inputs.input_ids.dims[1] ?? 0
      stopping.reset()
      const output = (await causalLm.generate({
        ...inputs,
        max_new_tokens: maxTokens,
        do_sample: temperature > 0,
        ...(temperature > 0 ? { temperature } : {}),
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
