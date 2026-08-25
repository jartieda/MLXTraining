import { getSupabase } from '@/lib/supabase'
import type { RunMetrics } from '@/lib/db'

/**
 * T089 / FR-010, data-model.md — the remote copy of a finished run.
 *
 * What crosses the boundary is names, counts and accuracies. There is no column
 * anywhere in `training_runs` that could hold an image or a weight, which is a
 * schema guarantee rather than a promise made here (G2, SC-010) — but it is worth
 * naming at the one call site that writes to it, because this is the only place in
 * the product where something derived from a learner's photographs is sent
 * anywhere at all. It is derived far enough that it is a number.
 *
 * Two things this module deliberately does not do:
 *
 * - **It is not the source of truth.** The local `models.metrics` row is, and it
 *   is written first and unconditionally. An anonymous learner gets the whole of
 *   FR-010 with no account (FR-023), so a remote write that fails must cost her
 *   nothing.
 * - **It does not retry.** A school connection drops mid-lesson often, and a
 *   learner who has just trained a model is about to test it, not wait. The row is
 *   metadata about work that is safe on her device either way.
 */

export interface RemoteRunSummary {
  readonly id: string
  readonly finishedAt: string
  readonly overallAccuracy: number
  readonly imbalanceRatio: number | null
}

/**
 * Records one finished run. Returns whether it was written, for the caller that
 * wants to say "not saved to your account" rather than nothing.
 *
 * Only completed runs are recorded (FR-050). There is no call site for an
 * unfinished one, because `markModelFailed` is what the failure paths reach for.
 */
export async function recordTrainingRun(
  projectId: string,
  runId: string,
  metrics: RunMetrics,
): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false

  const { error } = await supabase.from('training_runs').insert({
    // The same id as the local `models.runId`, which is what makes the two halves
    // one run rather than two records of one event (data-model.md).
    id: runId,
    project_id: projectId,
    per_class: metrics.perClass.map((entry) => ({
      classId: entry.classId,
      className: entry.className,
      sampleCount: entry.sampleCount,
      accuracy: entry.accuracy,
    })),
    // Row-major, ordered by `per_class`. Transposing it here would reverse every
    // conclusion an educator later draws from the same numbers.
    confusion: metrics.confusion.map((row) => [...row]),
    overall_accuracy: metrics.overallAccuracy,
    imbalance_ratio: metrics.imbalanceRatio,
    backbone_alpha: metrics.backboneAlpha,
    epochs: metrics.epochs,
  })

  return !error
}

export async function fetchRunSummaries(projectId: string): Promise<readonly RemoteRunSummary[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('training_runs')
    .select('id, finished_at, overall_accuracy, imbalance_ratio')
    .eq('project_id', projectId)
    .order('finished_at', { ascending: false })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    finishedAt: row.finished_at,
    overallAccuracy: row.overall_accuracy,
    imbalanceRatio: row.imbalance_ratio,
  }))
}
