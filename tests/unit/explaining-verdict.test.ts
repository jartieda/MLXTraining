import { describe, expect, it } from 'vitest'
import { buildModelVerdict, buildUserVerdict } from '@/features/explaining/CompareView'

describe('buildModelVerdict', () => {
  it('flags a miss and explains it from the heat-map evidence', () => {
    const verdict = buildModelVerdict(
      1,
      0,
      ['cat', 'dog'],
      {
        vertical: 'top',
        horizontal: 'left',
        spread: 0.7,
        diffuse: true,
        degenerate: false,
      } as { diffuse: boolean; degenerate: boolean },
      'disagreement',
    )

    expect(verdict.correct).toBe(false)
    expect(verdict.predictedIndex).toBe(1)
    expect(verdict.expectedIndex).toBe(0)
    expect(verdict.reason).toBe('disagreement')
  })
})

describe('buildUserVerdict', () => {
  it('shows a heat-map based explanation when the learner says the model missed', () => {
    const result = buildUserVerdict(
      'no',
      {
        correct: false,
        predictedIndex: 1,
        expectedIndex: 0,
        reason: 'wrong-area',
      },
      'cat',
      'dog',
    )

    expect(result.userChoice).toBe('no')
    expect(result.summary).toContain('dog')
    expect(result.summary).toContain('cat')
    expect(result.reason).toBe('wrong-area')
  })

  it('still produces an explanation when the predicted class index is 0', () => {
    const predictedClassIndex = 0
    const userChoice = 'yes' as const

    const result =
      userChoice === null || predictedClassIndex === null
        ? null
        : buildUserVerdict(
            userChoice,
            {
              correct: true,
              predictedIndex: predictedClassIndex,
              expectedIndex: 0,
              reason: 'correct',
            },
            'cat',
            'cat',
          )

    expect(result).not.toBeNull()
    expect(result?.userChoice).toBe('yes')
    expect(result?.reason).toBe('correct')
  })
})
