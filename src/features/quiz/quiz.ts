/**
 * «¿Qué he aprendido?»: an initial open response (pre) and a final test plus the same
 * open response (post), so the written answers can be compared. It is a research
 * instrument: the structure and the
 * scoring live here, the words in `home.json` under `quiz.*`, and nothing leaves the
 * device unless the learner downloads the file and hands it in.
 *
 * Bump QUIZ_VERSION whenever an item, an option or the correct answer changes, so files
 * from different versions are never pooled by mistake.
 */

export const QUIZ_VERSION = '2026-11-v4'

export const OPTION_IDS = ['a', 'b', 'c', 'd'] as const
export type OptionId = (typeof OPTION_IDS)[number]
/** «No lo sé» is offered on every item so a guess is not counted as knowledge. */
export const IDK = 'idk'
export type Choice = OptionId | typeof IDK
export type QuizType = 'basic' | 'advanced'
export type ConfidenceRating = 1 | 2 | 3

export interface QuizItem {
  readonly id: string
  readonly correct: OptionId
  /** What the item measures, for the analysis. */
  readonly topic: 'xai' | 'cv' | 'bias' | 'llm'
}

/** The original questionnaire remains the basic test. */
export const QUIZ_ITEMS: readonly QuizItem[] = [
  { id: 'q1', correct: 'b', topic: 'xai' },
  { id: 'q2', correct: 'b', topic: 'cv' },
  { id: 'q3', correct: 'a', topic: 'cv' },
  { id: 'q4', correct: 'b', topic: 'bias' },
  { id: 'q5', correct: 'b', topic: 'bias' },
  { id: 'q6', correct: 'b', topic: 'bias' },
  { id: 'q7', correct: 'a', topic: 'cv' },
  { id: 'q8', correct: 'b', topic: 'llm' },
  { id: 'q9', correct: 'b', topic: 'llm' },
  { id: 'q10', correct: 'b', topic: 'llm' },
  { id: 'q11', correct: 'b', topic: 'bias' },
  { id: 'q12', correct: 'b', topic: 'xai' },
]

/** Scenario-based extension of the basic test, using the same stable item IDs. */
export const ADVANCED_QUIZ_ITEMS: readonly QuizItem[] = [
  { id: 'q1', correct: 'c', topic: 'xai' },
  { id: 'q2', correct: 'a', topic: 'cv' },
  { id: 'q3', correct: 'd', topic: 'cv' },
  { id: 'q4', correct: 'b', topic: 'xai' },
  { id: 'q5', correct: 'a', topic: 'xai' },
  { id: 'q6', correct: 'c', topic: 'cv' },
  { id: 'q7', correct: 'd', topic: 'bias' },
  { id: 'q8', correct: 'b', topic: 'bias' },
  { id: 'q9', correct: 'c', topic: 'llm' },
  { id: 'q10', correct: 'a', topic: 'llm' },
  { id: 'q11', correct: 'd', topic: 'llm' },
  { id: 'q12', correct: 'b', topic: 'xai' },
]

type AdvancedOpenQuestion = 'xai' | 'bias'

/** 1–5 agreement items. `reversed` items are scored 6 − answer in the analysis. */
export const LIKERT_ITEMS: readonly { readonly id: string; readonly reversed: boolean }[] = [
  { id: 'l1', reversed: false },
  { id: 'l2', reversed: false },
  { id: 'l3', reversed: true },
  { id: 'l4', reversed: false },
]

export const LIKERT_SCALE = [1, 2, 3, 4, 5] as const

export type QuizPhase = 'pre' | 'post'

export interface QuizAttempt {
  readonly id: string
  readonly version: string
  readonly participant: string
  readonly group: string
  readonly phase: QuizPhase
  readonly quizType: QuizType
  readonly language: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly answers: Readonly<Record<string, Choice | null>>
  /** Retained only to export attempts from the preceding questionnaire version. */
  readonly confidence?: Readonly<Record<string, ConfidenceRating | null>>
  readonly likert: Readonly<Record<string, number | null>>
  readonly openAnswer: string
  /** Retained only to export advanced open responses from the preceding version. */
  readonly openAnswers?: Readonly<Record<AdvancedOpenQuestion, string>>
}

export interface AnonymousQuizSubmission {
  readonly id: string
  readonly version: string
  readonly phase: QuizPhase
  readonly quizType: QuizType
  readonly language: 'en' | 'es'
  readonly answers: Readonly<Record<string, Choice | null>>
  readonly likert: Readonly<Record<string, number | null>>
  readonly countryCode: string
  readonly countryConsent: true
}

export function toAnonymousQuizSubmission(
  attempt: QuizAttempt,
  submissionId: string,
  countryCode: string,
  countryConsent: boolean,
): AnonymousQuizSubmission {
  if (!countryConsent || !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error('A country and explicit consent are required to submit the quiz.')
  }

  return {
    id: submissionId,
    version: attempt.version,
    phase: attempt.phase,
    quizType: attempt.quizType,
    language: attempt.language.toLowerCase().startsWith('es') ? 'es' : 'en',
    answers: { ...attempt.answers },
    likert: { ...attempt.likert },
    countryCode,
    countryConsent: true,
  }
}

export interface QuizScore {
  readonly correct: number
  readonly idk: number
  readonly blank: number
  readonly total: number
}

export function scoreAttempt(
  answers: QuizAttempt['answers'],
  quizType: QuizType = 'basic',
): QuizScore {
  let correct = 0
  let idk = 0
  let blank = 0
  const items = quizType === 'advanced' ? ADVANCED_QUIZ_ITEMS : QUIZ_ITEMS
  for (const item of items) {
    const answer = answers[item.id] ?? null
    if (answer === null) blank++
    else if (answer === IDK) idk++
    else if (answer === item.correct) correct++
  }
  return { correct, idk, blank, total: QUIZ_ITEMS.length }
}

/** A participant code: letters, digits and dashes only, so no name slips in by accident. */
export function normalizeCode(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20)
}

// ── Storage on this device ─────────────────────────────────────────────────

const KEY = 'ml4g.quizAttempts'

export function loadAttempts(): QuizAttempt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as QuizAttempt[]) : []
  } catch {
    return []
  }
}

export function saveAttempt(attempt: QuizAttempt): void {
  localStorage.setItem(KEY, JSON.stringify([...loadAttempts(), attempt]))
}

export function clearAttempts(): void {
  localStorage.removeItem(KEY)
}

// ── Export ─────────────────────────────────────────────────────────────────

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * One row per attempt, wide format: ready for a spreadsheet, R or SPSS. Each item has
 * the chosen option and a 0/1 correctness column (empty when blank; 0 for «No lo sé»).
 */
export function attemptsToCsv(attempts: readonly QuizAttempt[]): string {
  const hasLegacyConfidence = attempts.some((attempt) =>
    Object.values(attempt.confidence ?? {}).some(
      (value) => value === 1 || value === 2 || value === 3,
    ),
  )
  const hasLegacyOpenAnswers = attempts.some((attempt) =>
    Object.values(attempt.openAnswers ?? {}).some(
      (value) => typeof value === 'string' && value.length > 0,
    ),
  )
  const header = [
    'version',
    'participant',
    'group',
    'phase',
    'quiz_type',
    'language',
    'started_at',
    'finished_at',
    'duration_s',
    ...QUIZ_ITEMS.flatMap((item) => [`${item.id}_answer`, `${item.id}_correct`]),
    'score',
    'idk_count',
    'blank_count',
    ...(hasLegacyConfidence ? QUIZ_ITEMS.map((item) => `${item.id}_confidence`) : []),
    ...LIKERT_ITEMS.map((item) => `${item.id}${item.reversed ? '_reversed' : ''}`),
    'open_answer',
    ...(hasLegacyOpenAnswers ? ['open_xai', 'open_bias'] : []),
  ]
  const rows = attempts.map((attempt) => {
    const quizType = attempt.quizType ?? 'basic'
    const score = attempt.phase === 'post' ? scoreAttempt(attempt.answers, quizType) : null
    const duration = Math.round(
      (Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)) / 1000,
    )
    return [
      attempt.version,
      attempt.participant,
      attempt.group,
      attempt.phase,
      quizType,
      attempt.language,
      attempt.startedAt,
      attempt.finishedAt,
      Number.isFinite(duration) ? duration : null,
      ...(quizType === 'advanced' ? ADVANCED_QUIZ_ITEMS : QUIZ_ITEMS).flatMap((item) => {
        const answer = attempt.answers[item.id] ?? null
        return [answer, answer === null ? null : answer === item.correct ? 1 : 0]
      }),
      score?.correct ?? null,
      score?.idk ?? null,
      score?.blank ?? null,
      ...(hasLegacyConfidence
        ? QUIZ_ITEMS.map((item) => attempt.confidence?.[item.id] ?? null)
        : []),
      ...LIKERT_ITEMS.map((item) => attempt.likert[item.id] ?? null),
      attempt.openAnswer,
      ...(hasLegacyOpenAnswers
        ? [attempt.openAnswers?.xai ?? '', attempt.openAnswers?.bias ?? '']
        : []),
    ]
  })
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function attemptFileName(
  attempts: readonly QuizAttempt[],
  extension: 'csv' | 'json',
): string {
  const first = attempts.length === 1 ? attempts[0] : undefined
  const stem = first
    ? `cuestionario-${first.participant || 'anonimo'}-${first.phase}`
    : 'cuestionarios'
  return `${stem}.${extension}`
}

export function downloadText(content: string, fileName: string, type: string): void {
  // A BOM so spreadsheet programs open accents correctly.
  const blob = new Blob([type.startsWith('text/csv') ? '﻿' + content : content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
