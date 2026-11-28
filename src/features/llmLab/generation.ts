import type { ChatTurn } from './llmEngine'
import { stripControlTokens } from './webllm'

/** Learner-written text never reaches a template or tokenizer with control tokens in it. */
export function cleanTurns(messages: readonly ChatTurn[]): { role: ChatTurn['role']; content: string }[] {
  return messages.map((turn) => ({ role: turn.role, content: stripControlTokens(turn.content) }))
}

/**
 * Generation settings shared by both engines, so one exercise behaves the same whichever
 * engine runs it: greedy decoding (reproducible in a classroom, where two learners
 * comparing answers should see the same one) with a light repetition penalty, which
 * small models need to avoid looping.
 */
export const REPETITION_PENALTY = 1.1

export const TOP_K = 3
