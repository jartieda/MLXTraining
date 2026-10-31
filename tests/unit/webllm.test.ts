import { describe, expect, it } from 'vitest'
import { prebuiltAppConfig } from '@mlc-ai/web-llm'
import { WEBLLM_MODEL_MAP, getWebLlmModelId } from '@/features/llmLab/webllm'

describe('WebLLM model mapping', () => {
  it('only maps to model IDs that exist in the installed WebLLM catalog', () => {
    const known = new Set(prebuiltAppConfig.model_list.map((model) => model.model_id))
    for (const modelId of Object.values(WEBLLM_MODEL_MAP)) {
      expect(known.has(modelId)).toBe(true)
    }
  })

  it('maps the lab model names to real WebLLM runtime IDs', () => {
    expect(getWebLlmModelId('gemma')).toBe('gemma-2-2b-it-q4f32_1-MLC')
    expect(getWebLlmModelId('llama')).toBe('Llama-3.1-8B-Instruct-q4f32_1-MLC')
    expect(getWebLlmModelId('qwen')).toBe('Qwen2.5-3B-Instruct-q4f16_1-MLC')
  })
})
