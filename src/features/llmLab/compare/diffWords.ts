export interface DiffSegment {
  readonly text: string
  readonly changed: boolean
}

export interface WordDiff {
  readonly a: readonly DiffSegment[]
  readonly b: readonly DiffSegment[]
  /** How many words differ: the larger of words removed from A and words added in B. */
  readonly changedWords: number
}

/** A warning is shown above this: with several changes the learner cannot tell which one mattered. */
export const MAX_CONTROLLED_CHANGES = 2

function words(text: string): string[] {
  return text.trim().split(/\s+/u).filter((word) => word.length > 0)
}

/** Comparison key: case and surrounding punctuation do not count as a change of word. */
function key(word: string): string {
  return word.toLocaleLowerCase('es').replace(/^[¿¡"«“'(]+|[.,;:!?"»”')]+$/gu, '')
}

/** Word-level diff of two prompts (longest common subsequence). */
export function diffWords(textA: string, textB: string): WordDiff {
  const a = words(textA)
  const b = words(textB)
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        key(a[i]!) === key(b[j]!) ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
    }
  }

  const segmentsA: DiffSegment[] = []
  const segmentsB: DiffSegment[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (key(a[i]!) === key(b[j]!)) {
      segmentsA.push({ text: a[i]!, changed: false })
      segmentsB.push({ text: b[j]!, changed: false })
      i += 1
      j += 1
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      segmentsA.push({ text: a[i]!, changed: true })
      i += 1
    } else {
      segmentsB.push({ text: b[j]!, changed: true })
      j += 1
    }
  }
  for (; i < a.length; i += 1) segmentsA.push({ text: a[i]!, changed: true })
  for (; j < b.length; j += 1) segmentsB.push({ text: b[j]!, changed: true })

  const removed = segmentsA.filter((segment) => segment.changed).length
  const added = segmentsB.filter((segment) => segment.changed).length
  return { a: segmentsA, b: segmentsB, changedWords: Math.max(removed, added) }
}
