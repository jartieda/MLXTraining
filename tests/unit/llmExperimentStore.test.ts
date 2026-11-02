import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { deleteExperiment, listExperiments, saveExperiment } from '@/features/llmLab/compare/experimentStore'

describe('LLM experiment store', () => {
  it('saves, lists newest first and deletes, on the device only', async () => {
    const base = {
      presetId: 'biasName',
      modelName: 'Gemma 2 · 2B',
      promptA: 'Lucía…',
      promptB: 'Javier…',
      bet: 'no' as const,
      band: 'large' as const,
      summary: 'La respuesta más probable es otra.',
    }
    const first = await saveExperiment(base)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await saveExperiment({ ...base, presetId: 'promptOrder', band: 'same' })

    const listed = await listExperiments()
    expect(listed.map((item) => item.id)).toEqual([second.id, first.id])

    await deleteExperiment(first.id)
    expect((await listExperiments()).map((item) => item.id)).toEqual([second.id])
  })
})
