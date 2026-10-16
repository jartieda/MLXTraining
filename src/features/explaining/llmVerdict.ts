import { getSupabase } from '@/lib/supabase'
import type { Agreement } from '@/ml/explain/agreement'
import type { ModelVerdictReason, UserVerdictChoice } from './CompareView'

export interface LlmVerdictRequest {
  readonly userChoice: UserVerdictChoice
  readonly expectedClass: string
  readonly predictedClass: string
  readonly classNames: readonly string[]
  readonly reason: ModelVerdictReason
  readonly gradcamEvidence: string
  readonly occlusionEvidence: string
  readonly agreementBand: Agreement['band'] | null
}

interface LlmVerdictResponse {
  readonly analysis: string
}

/**
 * Calls the backend LLM broker (`supabase/functions/v1/verdict-analysis`) and
 * returns plain text suitable for direct rendering in the verdict panel.
 */
export async function requestLlmVerdictAnalysis(
  payload: LlmVerdictRequest,
): Promise<string | null> {
  const supabase = await getSupabase()
  if (!supabase) return null

  const { data, error } = await supabase.functions.invoke('verdict-analysis', {
    body: {
      userChoice: payload.userChoice,
      expectedClass: payload.expectedClass,
      predictedClass: payload.predictedClass,
      classNames: payload.classNames,
      reason: payload.reason,
      gradcamEvidence: payload.gradcamEvidence,
      occlusionEvidence: payload.occlusionEvidence,
      agreementBand: payload.agreementBand,
      style: {
        language: 'es',
        maxSentences: 4,
        audience: 'student',
      },
    },
  })

  if (error) return null

  if (typeof data === 'string') return data.trim() || null
  if (data && typeof data === 'object' && 'analysis' in data) {
    const parsed = data as LlmVerdictResponse
    return parsed.analysis.trim() || null
  }

  return null
}
