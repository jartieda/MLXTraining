/* eslint-disable @typescript-eslint/require-await -- async fakes mirror the real engine signature */
import { describe, expect, it } from 'vitest'
import {
  checkSelfReport,
  impactOf,
  LensOffFormatError,
  quotedFragments,
  runWordLens,
  splitWords,
  topSupporting,
  withoutWord,
} from '@/features/llmLab/compare/wordImpact'
import { scoreFromAlternatives } from '@/features/llmLab/compare/scoreOptions'
import es from '@/locales/es/llm.json'

const OPTIONS = [
  { letter: 'A', text: 'Positivo' },
  { letter: 'B', text: 'Negativo' },
  { letter: 'C', text: 'Neutro' },
]
const EXAMPLE = es.sentiment.example

describe('word lens: splitting and removing words', () => {
  it('keeps every character and numbers only the words', () => {
    const pieces = splitWords('Hoy he perdido mi chaqueta, pero ¡estoy contenta!')
    expect(pieces.map((piece) => piece.text).join('')).toBe('Hoy he perdido mi chaqueta, pero ¡estoy contenta!')
    expect(pieces.filter((piece) => piece.wordIndex !== null).map((piece) => piece.text)).toEqual([
      'Hoy',
      'he',
      'perdido',
      'mi',
      'chaqueta',
      'pero',
      'estoy',
      'contenta',
    ])
  })

  it('the sentiment example has 18 words, so the lens makes 19 queries', () => {
    expect(splitWords(EXAMPLE).filter((piece) => piece.wordIndex !== null)).toHaveLength(18)
  })

  it('removes one word and leaves the punctuation tidy', () => {
    const pieces = splitWords('Hoy he perdido mi chaqueta, pero estoy contenta.')
    expect(withoutWord(pieces, 4)).toBe('Hoy he perdido mi, pero estoy contenta.')
    expect(withoutWord(pieces, 7)).toBe('Hoy he perdido mi chaqueta, pero estoy.')
  })
})

describe('word lens: impact', () => {
  it('is how many points the original answer loses without the word', () => {
    const scores = scoreFromAlternatives(
      [
        { token: 'A', logprob: Math.log(0.4) },
        { token: 'B', logprob: Math.log(0.5) },
      ],
      OPTIONS,
    )
    const impact = impactOf(0.8, 'A', scores)
    expect(impact.impact).toBeCloseTo(0.4)
    expect(impact.atLeast).toBe(false)
  })

  it('is a lower bound when the answer drops out of the reported tokens', () => {
    const scores = scoreFromAlternatives(
      [
        { token: 'B', logprob: Math.log(0.7) },
        { token: 'C', logprob: Math.log(0.15) },
        { token: 'Hmm', logprob: Math.log(0.1) },
      ],
      OPTIONS,
    )
    const impact = impactOf(0.8, 'A', scores)
    expect(impact.without).toBeNull()
    expect(impact.atLeast).toBe(true)
    // A is at most 5 % (what is left over), so it lost at least 75 points.
    expect(impact.impact).toBeCloseTo(0.75)
  })

  it('can be negative: the word pushed against the answer', () => {
    const scores = scoreFromAlternatives([{ token: 'A', logprob: Math.log(0.9) }], OPTIONS)
    expect(impactOf(0.6, 'A', scores).impact).toBeCloseTo(-0.3)
  })

  it('runs one query for the whole text and one per word, measured against the first answer', async () => {
    const prompts: string[] = []
    const result = await runWordLens(
      {
        nextTokenAlternatives: async (prompt) => {
          prompts.push(prompt)
          const positive = prompt.includes('contenta')
          return [
            { token: positive ? 'A' : 'B', logprob: Math.log(0.8) },
            { token: positive ? 'B' : 'A', logprob: Math.log(0.15) },
          ]
        },
      },
      'Estoy contenta hoy',
      (variant) => `¿Qué sentimiento? "${variant}"`,
      OPTIONS,
      'Responde solo con la letra.',
      () => undefined,
    )
    expect(prompts).toHaveLength(4)
    expect(result.answer.text).toBe('Positivo')
    expect(topSupporting(result.impacts)[0]?.word).toBe('contenta')
    expect(topSupporting(result.impacts)[0]?.impact).toBeCloseTo(0.65)
    // Words that change nothing are not listed as supporting the answer.
    expect(topSupporting(result.impacts)).toHaveLength(1)
  })

  it('refuses to measure when the whole text gets no option letter', async () => {
    await expect(
      runWordLens(
        { nextTokenAlternatives: async () => [{ token: 'Hola', logprob: Math.log(0.9) }] },
        'Estoy contenta',
        (variant) => variant,
        OPTIONS,
        '',
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(LensOffFormatError)
  })

  it('stops between words when asked to', async () => {
    const controller = new AbortController()
    let calls = 0
    await expect(
      runWordLens(
        {
          nextTokenAlternatives: async () => {
            calls += 1
            if (calls === 2) controller.abort()
            return [{ token: 'A', logprob: Math.log(0.9) }]
          },
        },
        'una dos tres cuatro',
        (variant) => variant,
        OPTIONS,
        '',
        () => undefined,
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(calls).toBe(2)
  })
})

describe('does it tell the truth about itself?', () => {
  it('finds quotes in every common style', () => {
    expect(quotedFragments('Positivo. "contenta", «ayudado» y “favorita”')).toEqual(['contenta', 'ayudado', 'favorita'])
  })

  it('matches when the model names every top word of the lens', () => {
    const check = checkSelfReport('Positivo. "Contenta" "ayudado" "favorita"', EXAMPLE, ['contenta', 'ayudado', 'favorita'])
    expect(check.band).toBe('strong')
    expect(check.named).toBe(3)
  })

  it('matches in part, ignoring quotes that are not in the text', () => {
    const check = checkSelfReport('Positivo. "contenta" "feliz" "chaqueta"', EXAMPLE, ['contenta', 'ayudado', 'pero'])
    expect(check.band).toBe('partial')
    expect(check.named).toBe(1)
    expect(check.quotes.map((quote) => quote.text)).toEqual(['contenta', 'chaqueta'])
  })

  it('a quoted phrase counts for the words inside it', () => {
    const check = checkSelfReport('Positivo: «me ha ayudado a encontrarla»', EXAMPLE, ['ayudado'])
    expect(check.band).toBe('strong')
    expect(check.quotes[0]?.hitsLens).toBe(true)
  })

  it('does not match when none of the lens words is named', () => {
    expect(checkSelfReport('Positivo. "chaqueta" "amiga"', EXAMPLE, ['contenta', 'pero']).band).toBe('disagreement')
  })

  it('cannot compare when the model quotes nothing from the text', () => {
    expect(checkSelfReport('Es positivo porque acaba bien.', EXAMPLE, ['contenta']).band).toBe('noQuotes')
  })
})
