import { describe, expect, it } from 'vitest'
import {
  attemptFileName,
  attemptsToCsv,
  IDK,
  normalizeCode,
  QUIZ_ITEMS,
  QUIZ_VERSION,
  scoreAttempt,
  type QuizAttempt,
} from '@/features/quiz/quiz'

function attempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id: 'x',
    version: QUIZ_VERSION,
    participant: 'A-01',
    group: 'G1',
    phase: 'pre',
    language: 'es',
    startedAt: '2026-11-12T10:00:00.000Z',
    finishedAt: '2026-11-12T10:08:30.000Z',
    answers: {},
    likert: { l1: 2, l3: 5 },
    openAnswer: 'Sirve para "entender", creo',
    ...overrides,
  }
}

describe('learning questionnaire', () => {
  it('counts right answers, «No lo sé» and blanks separately', () => {
    const answers = Object.fromEntries(QUIZ_ITEMS.map((item) => [item.id, item.correct]))
    expect(scoreAttempt(answers)).toEqual({ correct: 12, idk: 0, blank: 0, total: 12 })
    expect(scoreAttempt({ ...answers, q1: IDK, q2: null, q3: 'd' })).toEqual({ correct: 9, idk: 1, blank: 1, total: 12 })
  })

  it('keeps participant codes free of names, accents and spaces', () => {
    expect(normalizeCode('lucía 07')).toBe('LUCIA07')
    expect(normalizeCode('g-2b!')).toBe('G-2B')
  })

  it('exports one wide CSV row per attempt, with correctness columns and quoted text', () => {
    const csv = attemptsToCsv([attempt({ answers: { q1: 'b', q2: IDK } })])
    const [header, row] = csv.trim().split('\r\n')
    const columns = header!.split(',')
    expect(columns.slice(0, 8)).toEqual(['version', 'participant', 'group', 'phase', 'language', 'started_at', 'finished_at', 'duration_s'])
    expect(columns).toContain('q12_correct')
    expect(columns).toContain('l3_reversed')
    expect(row).toContain(',510,b,1,idk,0,,,')
    expect(row!.endsWith('"Sirve para ""entender"", creo"')).toBe(true)
  })

  it('names a single attempt’s file after its code and phase', () => {
    expect(attemptFileName([attempt({ phase: 'post' })], 'csv')).toBe('cuestionario-A-01-post.csv')
    expect(attemptFileName([attempt(), attempt()], 'csv')).toBe('cuestionarios.csv')
  })
})
