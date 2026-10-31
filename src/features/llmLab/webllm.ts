export type WebLlmModelId = 'gemma' | 'llama' | 'qwen'

export const WEBLLM_MODEL_MAP: Record<WebLlmModelId, string> = {
  gemma: 'gemma-2-2b-it-q4f32_1-MLC',
  llama: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
  qwen: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
}

/** Smaller ONNX builds of the same families, used on the CPU when WebGPU is unavailable. */
export const CPU_MODEL_MAP: Record<WebLlmModelId, string> = {
  gemma: 'onnx-community/gemma-3-270m-it-ONNX',
  llama: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
  qwen: 'onnx-community/Qwen2.5-0.5B-Instruct',
}

export function getWebLlmModelId(modelId: WebLlmModelId): string {
  return WEBLLM_MODEL_MAP[modelId]
}

export function getCpuModelId(modelId: WebLlmModelId): string {
  return CPU_MODEL_MAP[modelId]
}
