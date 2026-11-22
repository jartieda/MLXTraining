import { getSupabase, supabaseProblem } from '@/lib/supabase'
import type { AnonymousQuizSubmission } from './quiz'

export type QuizSubmissionFailure =
  | 'submitNotConfigured'
  | 'submitMigrationMissing'
  | 'submitPermissions'
  | 'submitNetworkError'
  | 'submitFailed'

export class QuizSubmissionError extends Error {
  readonly reason: QuizSubmissionFailure

  constructor(reason: QuizSubmissionFailure) {
    super(reason)
    this.name = 'QuizSubmissionError'
    this.reason = reason
  }
}

export async function submitAnonymousQuiz(submission: AnonymousQuizSubmission): Promise<void> {
  const supabase = await getSupabase()
  if (!supabase) {
    console.warn(supabaseProblem() ?? 'Supabase is not configured.')
    throw new QuizSubmissionError('submitNotConfigured')
  }

  const { error } = await supabase.rpc('submit_anonymous_quiz', {
    p_submission_id: submission.id,
    p_quiz_version: submission.version,
    p_phase: submission.phase,
    p_quiz_type: submission.quizType,
    p_language: submission.language,
    p_answers: { ...submission.answers },
    p_likert: { ...submission.likert },
    p_country_code: submission.countryCode,
    p_country_consent: submission.countryConsent,
  })

  if (!error) return

  console.warn('Anonymous quiz RPC failed:', error)
  if (['PGRST202', '42883', '42P01'].includes(error.code)) {
    throw new QuizSubmissionError('submitMigrationMissing')
  }
  if (error.code === '42501') throw new QuizSubmissionError('submitPermissions')
  throw new QuizSubmissionError('submitFailed')
}
