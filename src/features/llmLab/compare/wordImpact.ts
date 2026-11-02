import type { LlmEngine } from '../llmEngine'
import { scoreOptions, type AnswerOption, type OptionScores } from './scoreOptions'

/**
 * The word lens: occlusion for text. The closed question is asked once with the whole
 * text and once more for each word with that word removed; how much the probability of
 * the original answer drops is that word's impact. Same idea as covering patches of an
 * image in the Lab CV, built only on `scoreOptions`, so the engine is not modified.
 */

/** A piece of the text: a word the lens can remove, or the spaces and punctuation around it. */
export interface TextPiece {
  readonly text: string
  /** Index among the words, or `null` for spaces and punctuation. */
  readonly wordIndex: number | null
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

/** Split a text into words and the separators between them, keeping every character. */
export function splitWords(text: string): TextPiece[] {
  const pieces: TextPiece[] = []
  let last = 0
  let wordIndex = 0
  for (const match of text.matchAll(WORD)) {
    const start = match.index
    if (start > last) pieces.push({ text: text.slice(last, start), wordIndex: null })
    pieces.push({ text: match[0], wordIndex })
    wordIndex += 1
    last = start + match[0].length
  }
  if (last < text.length) pieces.push({ text: text.slice(last), wordIndex: null })
  return pieces
}

/** The text without one word, punctuation kept and the double space it leaves removed. */
export function withoutWord(pieces: readonly TextPiece[], wordIndex: number): string {
  return pieces
    .filter((piece) => piece.wordIndex !== wordIndex)
    .map((piece) => piece.text)
    .join('')
    .replace(/\s{2,}/gu, ' ')
    .replace(/\s+([,.;:!?»”)])/gu, '$1')
    .trim()
}

export interface WordImpact {
  readonly wordIndex: number
  readonly word: string
  /** Probability of the original answer with this word removed, or `null` when not measured. */
  readonly without: number | null
  /**
   * Points the original answer loses when the word is removed, in [-1, 1]. Positive: the
   * word supports the answer. Negative: the word pushes against it.
   */
  readonly impact: number
  /**
   * The answer dropped out of the reported tokens, so its probability is only known to be
   * below the smallest one reported: the impact is a lower bound, «at least».
   */
  readonly atLeast: boolean
}

export interface LensResult {
  readonly pieces: readonly TextPiece[]
  /** The option the model prefers for the whole text, the one every word is measured against. */
  readonly answer: AnswerOption
  readonly baseline: number
  readonly baselineOther: number
  readonly impacts: readonly WordImpact[]
}

/** The option with the highest measured probability, or `null` when no letter was measured. */
export function topOption(scores: OptionScores): { option: AnswerOption; probability: number } | null {
  let best: { option: AnswerOption; probability: number } | null = null
  for (const option of scores.options) {
    if (option.probability === null) continue
    if (best === null || option.probability > best.probability) best = { option, probability: option.probability }
  }
  return best
}

/**
 * Impact of removing one word on the original answer. When the answer is no longer among
 * the reported tokens its probability is at most that of the least likely one reported
 * and at most whatever probability the reported tokens leave over, so the drop is at least `baseline - that`.
 */
export function impactOf(baseline: number, letter: string, scores: OptionScores): Omit<WordImpact, 'wordIndex' | 'word'> {
  const option = scores.options.find((item) => item.letter === letter)
  const without = option?.probability ?? null
  if (without !== null) return { without, impact: baseline - without, atLeast: false }
  const reported = scores.tokens.map((token) => token.probability)
  const leftOver = Math.max(0, 1 - reported.reduce((sum, value) => sum + value, 0))
  const ceiling = Math.min(leftOver, ...reported)
  return { without: null, impact: Math.max(0, baseline - ceiling), atLeast: true }
}

export class LensOffFormatError extends Error {
  constructor() {
    super('The model did not answer the whole text with an option letter')
    this.name = 'LensOffFormatError'
  }
}

/**
 * Run the lens: one query for the whole text, then one per word. `onProgress` reports
 * how many words have been measured. A stopped run throws whatever the engine throws.
 */
export async function runWordLens(
  engine: Pick<LlmEngine, 'nextTokenAlternatives'>,
  text: string,
  buildText: (variant: string) => string,
  options: readonly AnswerOption[],
  instruction: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<LensResult> {
  const pieces = splitWords(text)
  const words = pieces.filter((piece) => piece.wordIndex !== null)
  const full = await scoreOptions(engine, buildText(text), options, instruction, signal)
  const top = topOption(full)
  if (top === null) throw new LensOffFormatError()

  const impacts: WordImpact[] = []
  onProgress(0, words.length)
  for (const piece of words) {
    signal?.throwIfAborted()
    const index = piece.wordIndex!
    const scores = await scoreOptions(engine, buildText(withoutWord(pieces, index)), options, instruction, signal)
    impacts.push({ wordIndex: index, word: piece.text, ...impactOf(top.probability, top.option.letter, scores) })
    onProgress(impacts.length, words.length)
  }
  return { pieces, answer: top.option, baseline: top.probability, baselineOther: full.other, impacts }
}

/** Words that most support the answer: largest positive impact first. */
export function topSupporting(impacts: readonly WordImpact[], count = 3): WordImpact[] {
  return impacts
    .filter((item) => item.impact > 0)
    .sort((left, right) => right.impact - left.impact)
    .slice(0, count)
}

/** Below this drop (in probability) a word is shown as "barely changes anything". */
export const NEGLIGIBLE_IMPACT = 0.02

// ── «¿Dice la verdad sobre sí mismo?» ────────────────────────────────────────

/** Comparison key for words: case and accents do not count. */
export function wordKey(word: string): string {
  return word
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/** Every quoted fragment in a reply: "…", «…», “…” or '…'. Trimmed, empty ones dropped. */
export function quotedFragments(reply: string): string[] {
  const fragments: string[] = []
  for (const match of reply.matchAll(/"([^"\n]+)"|«([^»\n]+)»|“([^”\n]+)”|‘([^’\n]+)’/gu)) {
    const fragment = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim()
    if (fragment.length > 0) fragments.push(fragment)
  }
  return fragments
}

export type SelfReportBand = 'strong' | 'partial' | 'disagreement' | 'noQuotes'

export interface SelfReportCheck {
  /** Quotes the model gave that are really in the text, in the order it gave them. */
  readonly quotes: readonly { readonly text: string; readonly hitsLens: boolean }[]
  /** The lens's top words, and whether the model named each one. */
  readonly lensTop: readonly { readonly word: string; readonly named: boolean }[]
  readonly named: number
  readonly band: SelfReportBand
}

/**
 * Compare what the model says influenced it with what the lens measured. A quote counts
 * if it is part of the text; it "hits" if it contains one of the lens's top words, and
 * a top word is "named" if any quote contains it. Same three bands as «¿Coinciden?» in
 * the Lab CV: all named, some named, none.
 */
export function checkSelfReport(reply: string, text: string, lensTop: readonly string[]): SelfReportCheck {
  const textWords = new Set(splitWords(text).filter((piece) => piece.wordIndex !== null).map((piece) => wordKey(piece.text)))
  const topKeys = lensTop.map(wordKey)
  const quotes = quotedFragments(reply)
    .map((fragment) => ({ text: fragment, words: splitWords(fragment).filter((p) => p.wordIndex !== null).map((p) => wordKey(p.text)) }))
    .filter((quote) => quote.words.length > 0 && quote.words.every((word) => textWords.has(word)))
  const quotedWords = new Set(quotes.flatMap((quote) => quote.words))

  const top = lensTop.map((word, index) => ({ word, named: quotedWords.has(topKeys[index]!) }))
  const named = top.filter((item) => item.named).length
  const band: SelfReportBand =
    quotes.length === 0 ? 'noQuotes' : named === top.length && named > 0 ? 'strong' : named > 0 ? 'partial' : 'disagreement'
  return {
    quotes: quotes.map((quote) => ({ text: quote.text, hitsLens: quote.words.some((word) => topKeys.includes(word)) })),
    lensTop: top,
    named,
    band,
  }
}
