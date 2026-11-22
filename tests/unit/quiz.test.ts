import { describe, expect, it } from 'vitest'
import {
  attemptFileName,
  attemptsToCsv,
  ADVANCED_QUIZ_ITEMS,
  IDK,
  normalizeCode,
  QUIZ_ITEMS,
  QUIZ_VERSION,
  scoreAttempt,
  toAnonymousQuizSubmission,
  type QuizAttempt,
} from '@/features/quiz/quiz'

function attempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id: 'x',
    version: QUIZ_VERSION,
    participant: 'A-01',
    group: 'G1',
    phase: 'pre',
    quizType: 'basic',
    language: 'es',
    startedAt: '2026-11-12T10:00:00.000Z',
    finishedAt: '2026-11-12T10:08:30.000Z',
    answers: {},
    confidence: {},
    likert: { l1: 2, l3: 5 },
    openAnswer: 'Sirve para "entender", creo',
    openAnswers: { xai: '', bias: '' },
    ...overrides,
  }
}

describe('learning questionnaire', () => {
  it('counts right answers, «No lo sé» and blanks separately', () => {
    const answers = Object.fromEntries(QUIZ_ITEMS.map((item) => [item.id, item.correct]))
    expect(scoreAttempt(answers)).toEqual({ correct: 12, idk: 0, blank: 0, total: 12 })
    expect(scoreAttempt({ ...answers, q1: IDK, q2: null, q3: 'd' })).toEqual({
      correct: 9,
      idk: 1,
      blank: 1,
      total: 12,
    })
    const advancedAnswers = Object.fromEntries(
      ADVANCED_QUIZ_ITEMS.map((item) => [item.id, item.correct]),
    )
    expect(scoreAttempt(advancedAnswers, 'advanced')).toEqual({
      correct: 12,
      idk: 0,
      blank: 0,
      total: 12,
    })
  })

  it('keeps participant codes free of names, accents and spaces', () => {
    expect(normalizeCode('lucía 07')).toBe('LUCIA07')
    expect(normalizeCode('g-2b!')).toBe('G-2B')
  })

  it('only sends structured quiz data with the selected country after consent', () => {
    const submission = toAnonymousQuizSubmission(
      attempt({
        phase: 'post',
        language: 'es-ES',
        answers: { q1: 'b' },
        likert: { l1: 4 },
      }),
      'submission-uuid',
      'ES',
      true,
    )

    expect(submission).toEqual({
      id: 'submission-uuid',
      version: QUIZ_VERSION,
      phase: 'post',
      quizType: 'basic',
      language: 'es',
      answers: { q1: 'b' },
      likert: { l1: 4 },
      countryCode: 'ES',
      countryConsent: true,
    })
    expect(submission).not.toHaveProperty('participant')
    expect(submission).not.toHaveProperty('group')
    expect(submission).not.toHaveProperty('openAnswer')
    expect(submission).not.toHaveProperty('startedAt')
    expect(submission).not.toHaveProperty('finishedAt')
  })

  it('refuses to create a submission without country consent', () => {
    expect(() => toAnonymousQuizSubmission(attempt(), 'submission-uuid', 'ES', false)).toThrow(
      /country and explicit consent are required/i,
    )
  })

  it('exports one wide CSV row per attempt, with correctness columns and quoted text', () => {
    const csv = attemptsToCsv([
      attempt({
        quizType: 'advanced',
        phase: 'post',
        answers: { q1: 'b', q2: IDK },
        confidence: { q1: 3, q2: 1 },
        openAnswers: { xai: 'XAI explica decisiones', bias: 'Compararía grupos' },
      }),
    ])
    const [header, row] = csv.trim().split('\r\n')
    const columns = header!.split(',')
    expect(columns.slice(0, 9)).toEqual([
      'version',
      'participant',
      'group',
      'phase',
      'quiz_type',
      'language',
      'started_at',
      'finished_at',
      'duration_s',
    ])
    expect(columns).toContain('q12_correct')
    expect(columns).toContain('q1_confidence')
    expect(columns).toContain('l3_reversed')
    expect(columns).toContain('open_xai')
    expect(row).toContain('advanced')
    expect(row).toContain(',XAI explica decisiones,Compararía grupos')
    expect(row).toContain('"Sirve para ""entender"", creo"')
  })

  it('exports the initial open answer without assigning a multiple-choice score', () => {
    const [header, row] = attemptsToCsv([
      attempt({ openAnswer: 'Sé qué significa XAI', likert: { l1: 4 } }),
    ])
      .trim()
      .split('\r\n')
    const columns = header!.split(',')
    const values = row!.split(',')

    expect(values[columns.indexOf('score')]).toBe('')
    expect(values[columns.indexOf('q1_correct')]).toBe('')
    expect(values[columns.indexOf('l1')]).toBe('4')
    expect(columns).not.toContain('q1_confidence')
    expect(columns).not.toContain('open_xai')
    expect(row).toContain('Sé qué significa XAI')
  })

  it('names a single attempt’s file after its code and phase', () => {
    expect(attemptFileName([attempt({ phase: 'post' })], 'csv')).toBe('cuestionario-A-01-post.csv')
    expect(attemptFileName([attempt(), attempt()], 'csv')).toBe('cuestionarios.csv')
  })
})
