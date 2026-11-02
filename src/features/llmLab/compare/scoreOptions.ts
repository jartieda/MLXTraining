import type { LlmEngine } from '../llmEngine'
import type { ModelTokenAlternative } from '../wordCompletion'

/** One answer option of a closed question, as the learner reads it. */
export interface AnswerOption {
  /** Single-character label the model is asked to reply with: `A`, `B`, `C`… */
  readonly letter: string
  readonly text: string
}

export interface OptionScore extends AnswerOption {
  /**
   * Probability that the reply starts with this letter, or `null` when the letter was
   * not among the tokens the engine reported. `null` is "not measured", never 0 %.
   */
  readonly probability: number | null
}

export interface OptionScores {
  readonly options: readonly OptionScore[]
  /** Probability mass the reported tokens give to anything that is not an option letter. */
  readonly other: number
  /** The raw first-token alternatives, for «Ver el cálculo». */
  readonly tokens: readonly { readonly token: string; readonly probability: number }[]
}

/**
 * The closed question exactly as the model receives it: the learner's text, the options
 * and the instruction to reply with the letter only. Built here rather than in the
 * engine, so comparing two prompts never needs an engine change.
 */
export function buildOptionsPrompt(text: string, options: readonly AnswerOption[], instruction: string): string {
  const lines = options.map((option) => `${option.letter}) ${option.text}`)
  return `${text.trim()}\n\n${lines.join('\n')}\n\n${instruction}`
}

/** The letter a token stands for, if it is just a letter optionally followed by `)`, `.` or `:`. */
function letterOf(token: string): string | null {
  const cleaned = token.replace(/^(?:▁|Ġ|\s)+/u, '').trim()
  const match = /^([A-Za-z])(?:[).:]|$)/u.exec(cleaned)
  return match ? match[1]!.toUpperCase() : null
}

/** Probability per option letter from the first-token alternatives of a reply. */
export function scoreFromAlternatives(
  alternatives: readonly ModelTokenAlternative[],
  options: readonly AnswerOption[],
): OptionScores {
  const byLetter = new Map<string, number>()
  const tokens = alternatives
    .filter((alternative) => Number.isFinite(alternative.logprob))
    .map((alternative) => ({ token: alternative.token, probability: Math.exp(alternative.logprob) }))

  for (const { token, probability } of tokens) {
    const letter = letterOf(token)
    if (letter === null || !options.some((option) => option.letter.toUpperCase() === letter)) continue
    // " A" and "A" are different tokens that mean the same answer, so they add up.
    byLetter.set(letter, (byLetter.get(letter) ?? 0) + probability)
  }

  const scored = options.map((option) => ({
    ...option,
    probability: byLetter.get(option.letter.toUpperCase()) ?? null,
  }))
  const measured = [...byLetter.values()].reduce((sum, value) => sum + value, 0)
  return { options: scored, other: Math.max(0, 1 - measured), tokens }
}

/**
 * Ask the closed question and read the probability of each option's letter from the
 * first token of the reply. Only uses `nextTokenAlternatives`, which reports the top
 * three tokens, so a letter outside them is reported as not measured.
 */
export async function scoreOptions(
  engine: Pick<LlmEngine, 'nextTokenAlternatives'>,
  text: string,
  options: readonly AnswerOption[],
  instruction: string,
  signal?: AbortSignal,
): Promise<OptionScores> {
  const alternatives = await engine.nextTokenAlternatives(buildOptionsPrompt(text, options, instruction), '', signal)
  return scoreFromAlternatives(alternatives, options)
}

/** Above this share of non-option replies, the percentages say little and the interface warns. */
export const OFF_FORMAT_THRESHOLD = 0.5
