/* eslint-disable @typescript-eslint/require-await -- async fakes mirror the real engine signature */
import { describe, expect, it } from 'vitest'
import {
  changeBand,
  compareScored,
  freeTextBand,
  LARGE_THRESHOLD,
  SAME_THRESHOLD,
} from '@/features/llmLab/compare/compareResults'
import { diffWords, MAX_CONTROLLED_CHANGES } from '@/features/llmLab/compare/diffWords'
import { COMPARE_PRESETS } from '@/features/llmLab/compare/presets'
import { buildOptionsPrompt, scoreFromAlternatives, scoreOptions } from '@/features/llmLab/compare/scoreOptions'
import es from '@/locales/es/llm.json'
import en from '@/locales/en/llm.json'

const OPTIONS = [
  { letter: 'A', text: 'Positivo' },
  { letter: 'B', text: 'Negativo' },
  { letter: 'C', text: 'Neutro' },
]

describe('scoreOptions', () => {
  it('reads each letter from the first token, adding up spellings of the same letter', () => {
    const scores = scoreFromAlternatives(
      [
        { token: 'A', logprob: Math.log(0.6) },
        { token: ' A', logprob: Math.log(0.1) },
        { token: 'B)', logprob: Math.log(0.2) },
      ],
      OPTIONS,
    )
    expect(scores.options[0]?.probability).toBeCloseTo(0.7)
    expect(scores.options[1]?.probability).toBeCloseTo(0.2)
    expect(scores.other).toBeCloseTo(0.1)
  })

  it('reports a letter outside the top tokens as not measured, never as 0', () => {
    const scores = scoreFromAlternatives([{ token: 'A', logprob: Math.log(0.9) }], OPTIONS)
    expect(scores.options[2]?.probability).toBeNull()
  })

  it('does not count words that merely start with a letter', () => {
    const scores = scoreFromAlternatives([{ token: 'Alegre', logprob: Math.log(0.8) }], OPTIONS)
    expect(scores.options[0]?.probability).toBeNull()
    expect(scores.other).toBeCloseTo(1)
  })

  it('sends the text, the options and the instruction, and starts the reply empty', async () => {
    const calls: [string, string | undefined][] = []
    await scoreOptions(
      {
        nextTokenAlternatives: async (prompt, prefix) => {
          calls.push([prompt, prefix])
          return []
        },
      },
      'Hola',
      OPTIONS,
      'Responde solo con la letra.',
    )
    expect(calls).toEqual([[buildOptionsPrompt('Hola', OPTIONS, 'Responde solo con la letra.'), '']])
    expect(calls[0]?.[0]).toContain('C) Neutro')
  })
})

describe('diffWords', () => {
  it('marks only the word that changed', () => {
    const diff = diffWords('Mi jefe es muy', 'Mi jefa es muy')
    expect(diff.changedWords).toBe(1)
    expect(diff.a.filter((segment) => segment.changed).map((segment) => segment.text)).toEqual(['jefe'])
    expect(diff.b.filter((segment) => segment.changed).map((segment) => segment.text)).toEqual(['jefa'])
  })

  it('ignores case and surrounding punctuation', () => {
    expect(diffWords('¿Es sano?', 'es sano').changedWords).toBe(0)
  })

  it('counts several changes so the interface can warn', () => {
    const diff = diffWords('Lucía tiene 3 años', 'Javier tenía 5 meses')
    expect(diff.changedWords).toBeGreaterThan(MAX_CONTROLLED_CHANGES)
  })
})

describe('compareScored and the change bands', () => {
  it('uses fixed thresholds of 5 and 20 points', () => {
    expect(changeBand(SAME_THRESHOLD - 0.01, false)).toBe('same')
    expect(changeBand(0.1, false)).toBe('small')
    expect(changeBand(-LARGE_THRESHOLD, false)).toBe('large')
    expect(changeBand(null, false)).toBe('unknown')
    expect(changeBand(0, true)).toBe('large')
  })

  it('aligns rows by answer, so swapping the option order compares the same answer', () => {
    const verdict = compareScored(
      [
        { label: 'Es saludable', probability: 0.2 },
        { label: 'No es saludable', probability: 0.7 },
      ],
      [
        { label: 'No es saludable', probability: 0.6 },
        { label: 'Es saludable', probability: 0.25 },
      ],
    )
    expect(verdict.topA).toBe('No es saludable')
    expect(verdict.topB).toBe('No es saludable')
    expect(verdict.delta).toBeCloseTo(-0.1)
    expect(verdict.band).toBe('small')
  })

  it('calls it a big change when the most likely answer is different', () => {
    const verdict = compareScored(
      [
        { label: 'exigente', probability: 0.41 },
        { label: 'simpático', probability: 0.15 },
      ],
      [
        { label: 'simpática', probability: 0.33 },
        { label: 'exigente', probability: 0.22 },
      ],
    )
    expect(verdict.band).toBe('large')
    expect(verdict.rows.find((row) => row.label === 'simpático')?.b).toBeNull()
  })

  it('treats A’s top answer vanishing from B as a big change, not as unknown', () => {
    const verdict = compareScored([{ label: 'corrió', probability: 0.8 }], [{ label: 'saltó', probability: 0.5 }])
    expect(verdict.band).toBe('large')
  })

  it('grades free-text answers by the share of words that differ', () => {
    expect(freeTextBand(0, 30)).toBe('same')
    expect(freeTextBand(3, 30)).toBe('small')
    expect(freeTextBand(15, 30)).toBe('large')
  })
})

describe('prepared comparisons', () => {
  it('have every text in both languages, with options for every letter', () => {
    for (const locale of [es, en]) {
      const presets = locale.compare.presets as Record<string, { a?: string; b?: string; options?: Record<string, string> }>
      for (const preset of COMPARE_PRESETS) {
        const texts = presets[preset.id]
        expect(texts?.a, `${preset.id}.a`).toBeTruthy()
        expect(texts?.b, `${preset.id}.b`).toBeTruthy()
        for (const letter of preset.letters ?? []) expect(texts?.options?.[letter], `${preset.id}.${letter}`).toBeTruthy()
      }
    }
  })

  it('keeps the original sentiment example of the lab as prompt A', () => {
    expect(es.compare.presets.sentimentWord.a).toBe(es.sentiment.example)
  })

  it('changes a single word in the controlled presets', () => {
    for (const id of ['sentimentWord', 'sentimentIrony', 'biasStereotype', 'promptNegation'] as const) {
      const texts = es.compare.presets[id]
      expect(diffWords(texts.a, texts.b).changedWords, id).toBeLessThanOrEqual(MAX_CONTROLLED_CHANGES)
    }
  })
})
