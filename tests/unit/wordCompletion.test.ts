/* eslint-disable @typescript-eslint/require-await -- async fakes mirror the real model query signature */
import { describe, expect, it } from 'vitest'
import {
  buildWordCompletionPrompt,
  findWordCandidates,
  WORD_COMPLETION_INSTRUCTION,
  type ModelTokenAlternative,
} from '@/features/llmLab/wordCompletion'

describe('word completion prompt', () => {
  it('always starts with the requested instruction and preserves the prompt', () => {
    expect(buildWordCompletionPrompt('  La luna brilla  ')).toBe(
      `${WORD_COMPLETION_INSTRUCTION}: La luna brilla\nResponde únicamente con una palabra.`,
    )
  })

  it('does not put the partial word in the user message (it is prefilled in the reply)', () => {
    expect(buildWordCompletionPrompt('La luna')).not.toContain('«')
  })
})

describe('word candidate search', () => {
  it('multiplies token probabilities and sums distinct paths for the same word', async () => {
    const predictions: Record<string, readonly ModelTokenAlternative[]> = {
      '': [
        { token: 'cat ', logprob: Math.log(0.3) },
        { token: 'ca', logprob: Math.log(0.5) },
        { token: 'dog ', logprob: Math.log(0.1) },
      ],
      ca: [{ token: 't ', logprob: Math.log(0.4) }],
    }

    const candidates = await findWordCandidates(async (partial) => predictions[partial] ?? [])
    const cat = candidates.find(({ word }) => word === 'cat')

    expect(cat?.paths).toHaveLength(2)
    expect(cat?.paths[0]?.probability).toBeCloseTo(0.3)
    expect(cat?.paths[1]?.probability).toBeCloseTo(0.2)
    expect(cat?.probability).toBeCloseTo(0.5)
    expect(cat?.paths[1]?.tokens.map(({ token }) => token)).toEqual(['ca', 't '])
  })

  it('continues searching and returns at most three unique completed words', async () => {
    const candidates = await findWordCandidates(async (partial) => {
      if (partial.length > 0) return [{ token: 'a ', logprob: Math.log(0.5) }]
      return [
        { token: 'one ', logprob: Math.log(0.9) },
        { token: 'two ', logprob: Math.log(0.8) },
        { token: 'three ', logprob: Math.log(0.7) },
      ]
    })

    expect(candidates.map(({ word }) => word)).toEqual(['one', 'two', 'three'])
  })

  it('appends a continuation that repeats the prefix text, as in "pa" + "pa"', async () => {
    const candidates = await findWordCandidates(async (partial) => {
      if (partial === '') return [{ token: 'pa', logprob: Math.log(0.8) }]
      if (partial === 'pa') return [{ token: 'pa ', logprob: Math.log(0.5) }]
      return []
    })

    expect(candidates[0]?.word).toBe('papa')
    expect(candidates[0]?.probability).toBeCloseTo(0.4)
  })

  it('does not treat a partial word at the depth limit as complete', async () => {
    const updates: Array<{ modelCalls: number; candidates: readonly unknown[]; partials: readonly { text: string }[] }> = []
    const candidates = await findWordCandidates(
      async () => [{ token: 'unfinished', logprob: Math.log(0.9) }],
      { maxTokenDepth: 1, onProgress: (progress) => updates.push(progress) },
    )

    expect(candidates).toEqual([])
    expect(updates.at(-1)?.partials[0]?.text).toBe('unfinished')
  })

  it('preserves the last partial prefix when the model returns no further tokens', async () => {
    const updates: Array<{ modelCalls: number; candidates: readonly unknown[]; partials: readonly { text: string }[] }> = []
    const candidates = await findWordCandidates(
      async (partial) => partial === ''
        ? [{ token: 'prefij', logprob: Math.log(0.7) }]
        : [],
      { onProgress: (progress) => updates.push(progress) },
    )

    expect(candidates).toEqual([])
    expect(updates.at(-1)?.partials[0]?.text).toBe('prefij')
    expect(updates.at(-1)?.modelCalls).toBe(2)
  })

  it('respects the model-call budget', async () => {
    let calls = 0
    await findWordCandidates(async () => {
      calls += 1
      return [
        { token: 'a', logprob: Math.log(0.8) },
        { token: 'b', logprob: Math.log(0.7) },
        { token: 'c', logprob: Math.log(0.6) },
      ]
    }, { maxTokenDepth: 8, maxModelCalls: 2 })

    expect(calls).toBe(2)
  })

  it('includes the closing token probability in the word score', async () => {
    const candidates = await findWordCandidates(async (partial) => {
      if (partial === '') return [{ token: 'azul', logprob: Math.log(0.8) }]
      return [{ token: '<end_of_turn>', logprob: Math.log(0.5) }]
    })

    expect(candidates[0]?.word).toBe('azul')
    expect(candidates[0]?.probability).toBeCloseTo(0.4)
    expect(candidates[0]?.paths[0]?.tokens.map(({ token }) => token)).toEqual(['azul', '<end_of_turn>'])
  })

  it('ignores a leading whitespace token and strips leading quotes', async () => {
    const candidates = await findWordCandidates(async () => [
      { token: '\n', logprob: Math.log(0.5) },
      { token: '«azul» ', logprob: Math.log(0.3) },
    ])

    expect(candidates.map(({ word }) => word)).toEqual(['azul'])
  })

  it('shares one model query between paths that build the same prefix', async () => {
    const queried: string[] = []
    await findWordCandidates(async (partial) => {
      queried.push(partial)
      if (partial === '') {
        return [
          { token: 'ab', logprob: Math.log(0.5) },
          { token: 'a', logprob: Math.log(0.4) },
        ]
      }
      if (partial === 'a') return [{ token: 'b', logprob: Math.log(0.9) }]
      return [{ token: ' ', logprob: Math.log(0.9) }]
    })

    expect(queried.filter((partial) => partial === 'ab')).toHaveLength(1)
  })

  it('returns what was found when the model fails after the first query', async () => {
    const candidates = await findWordCandidates(async (partial) => {
      if (partial === '') {
        return [
          { token: 'sol ', logprob: Math.log(0.6) },
          { token: 'lu', logprob: Math.log(0.3) },
        ]
      }
      throw new Error('model lost')
    })

    expect(candidates.map(({ word }) => word)).toEqual(['sol'])
  })

  it('rethrows when the very first query fails and nothing was gathered', async () => {
    await expect(
      findWordCandidates(async () => {
        throw new Error('model lost')
      }),
    ).rejects.toThrow('model lost')
  })
})