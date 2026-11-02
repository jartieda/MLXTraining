export type WebLlmModelId = 'gemma' | 'llama' | 'qwen'

export const WEBLLM_MODEL_MAP: Record<WebLlmModelId, string> = {
  gemma: 'gemma-2-2b-it-q4f32_1-MLC',
  llama: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  qwen: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
}

/** Smaller ONNX builds of the same families, used on the CPU when WebGPU is unavailable. */
export const CPU_MODEL_MAP: Record<WebLlmModelId, string> = {
  gemma: 'onnx-community/gemma-3-270m-it-ONNX',
  llama: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
  qwen: 'onnx-community/Qwen2.5-0.5B-Instruct',
}

/**
 * ONNX weight type used on the CPU. The onnxruntime-web WebAssembly backend does not implement
 * `GatherBlockQuantized`, which the q4 builds (and Gemma's q8 build) use for the embedding
 * table, so those variants fail with "Could not find an implementation". Gemma therefore runs
 * in full precision (~1.1 GB); Llama and Qwen use their q8 builds, which only use supported ops.
 */
export const CPU_DTYPE_MAP: Record<WebLlmModelId, 'fp32' | 'q8'> = {
  gemma: 'fp32',
  llama: 'q8',
  qwen: 'q8',
}

/**
 * The model actually loaded for each engine, as the learner should see it. The CPU engine
 * does not run a "reduced version" of the GPU model: it runs a different, much smaller
 * model (for Gemma, even a different generation), so its probabilities are not comparable.
 */
export const MODEL_DISPLAY_NAME: Record<'gpu' | 'cpu', Record<WebLlmModelId, string>> = {
  gpu: {
    gemma: 'Gemma 2 · 2B',
    llama: 'Llama 3.2 · 3B',
    qwen: 'Qwen 2.5 · 3B',
  },
  cpu: {
    gemma: 'Gemma 3 · 270M',
    llama: 'Llama 3.2 · 1B',
    qwen: 'Qwen 2.5 · 0.5B',
  },
}

/**
 * Control tokens of the three chat templates. A learner who types one of them would
 * otherwise close the user turn and write into the assistant's, so they are removed
 * from anything she writes before it reaches a template or a tokenizer.
 */
const CONTROL_TOKEN = /<\|[^|<>\s]{1,40}\|>|<\/?(?:bos|eos|pad|s|start_of_turn|end_of_turn)>/giu

export function stripControlTokens(text: string): string {
  return text.replace(CONTROL_TOKEN, '')
}

export function getWebLlmModelId(modelId: WebLlmModelId): string {
  return WEBLLM_MODEL_MAP[modelId]
}

export function getCpuModelId(modelId: WebLlmModelId): string {
  return CPU_MODEL_MAP[modelId]
}

/**
 * Raw chat-template text that ends inside the assistant turn, so a text-completion request
 * continues `assistantPrefix` instead of starting a new reply. WebLLM's chat API cannot
 * prefill the assistant turn, hence the templates are spelled out here.
 */
export function buildRawChatPrompt(model: WebLlmModelId, rawUserMessage: string, assistantPrefix: string): string {
  const userMessage = stripControlTokens(rawUserMessage)
  switch (model) {
    case 'gemma':
      return `<bos><start_of_turn>user\n${userMessage}<end_of_turn>\n<start_of_turn>model\n${assistantPrefix}`
    case 'llama':
      return `<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n${userMessage}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n${assistantPrefix}`
    case 'qwen':
      return `<|im_start|>system\nYou are Qwen, created by Alibaba Cloud. You are a helpful assistant.<|im_end|>\n<|im_start|>user\n${userMessage}<|im_end|>\n<|im_start|>assistant\n${assistantPrefix}`
  }
}
