/**
 * The prepared comparisons of the A/B comparator. Structure lives here; every word the
 * learner reads or the model receives lives in `llm.json` under `compare.presets.<id>`,
 * so both languages stay complete (the locale parity test walks the keys).
 */

/** What is compared: the next word, the probability of each option, or the full answer. */
export type CompareLayer = 'nextWord' | 'options' | 'freeText'

/** Which question the verdict asks the learner. */
export type CompareCase = 'sentiment' | 'bias' | 'prompt' | 'hallucination'

export interface ComparePreset {
  readonly id: string
  readonly caseKind: CompareCase
  readonly layer: CompareLayer
  /**
   * Option letters for `options` presets. The option texts are translated; B may list
   * them in another order (`optionsB`), which is how the position-bias preset works.
   */
  readonly letters?: readonly string[]
  readonly swapOptionsInB?: boolean
}

export const COMPARE_PRESETS: readonly ComparePreset[] = [
  { id: 'sentimentWord', caseKind: 'sentiment', layer: 'options', letters: ['A', 'B', 'C'] },
  { id: 'sentimentIrony', caseKind: 'sentiment', layer: 'options', letters: ['A', 'B', 'C'] },
  { id: 'biasName', caseKind: 'bias', layer: 'options', letters: ['A', 'B'] },
  { id: 'biasStereotype', caseKind: 'bias', layer: 'nextWord' },
  { id: 'promptTone', caseKind: 'prompt', layer: 'options', letters: ['A', 'B'] },
  { id: 'promptNegation', caseKind: 'prompt', layer: 'options', letters: ['A', 'B'] },
  { id: 'promptOrder', caseKind: 'prompt', layer: 'options', letters: ['A', 'B'], swapOptionsInB: true },
  { id: 'falsePremise', caseKind: 'hallucination', layer: 'freeText' },
  { id: 'allowIdk', caseKind: 'hallucination', layer: 'freeText' },
]

export const DEFAULT_PRESET_ID = 'sentimentWord'

export function findPreset(id: string): ComparePreset {
  return COMPARE_PRESETS.find((preset) => preset.id === id) ?? COMPARE_PRESETS[0]!
}
