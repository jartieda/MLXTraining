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
export function buildRawChatPrompt(model: WebLlmModelId, userMessage: string, assistantPrefix: string): string {
  switch (model) {
    case 'gemma':
      return `<bos><start_of_turn>user\n${userMessage}<end_of_turn>\n<start_of_turn>model\n${assistantPrefix}`
    case 'llama':
      return `<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n${userMessage}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n${assistantPrefix}`
    case 'qwen':
      return `<|im_start|>system\nYou are Qwen, created by Alibaba Cloud. You are a helpful assistant.<|im_end|>\n<|im_start|>user\n${userMessage}<|im_end|>\n<|im_start|>assistant\n${assistantPrefix}`
  }
}
