import { getSupabase } from '@/lib/supabase'
import type { ProgressState } from '@/lib/database.types'
import type { ModuleId } from '@/content/lessons/schema'

/**
 * T097, T098 / FR-035, L1, L4 — module progress and reflection answers.
 *
 * **Everything here is remote-only, and that is a deliberate difference from the run
 * metrics in US7.** FR-023 gives an unauthenticated visitor the complete
 * capture-train-explain journey and it stops there: the learning path is what an
 * educator assigns and reads, so progress without an account has nobody to report to
 * and no classroom to belong to. An anonymous visitor can still read every module —
 * the content is in the bundle — and the interface says plainly that nothing is
 * recorded.
 *
 * **Saving is upsert, never insert-then-update.** L4 requires a repeat answer to the
 * same `(learner, module, question)` to replace rather than append, and the schema
 * enforces it with a unique constraint. Doing it in two steps would race a
 * double-click into a constraint violation that a learner would read as her answer
 * being rejected.
 */

export interface ModuleProgress {
  readonly moduleId: string
  readonly state: ProgressState
  readonly completedSteps: readonly string[]
  readonly updatedAt: string
}

export interface Reflection {
  readonly moduleId: string
  readonly questionId: string
  readonly answer: string
  readonly updatedAt: string
}

export async function fetchProgress(learnerId: string): Promise<readonly ModuleProgress[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('lesson_progress')
    .select('module_id, state, completed_steps, updated_at')
    .eq('learner_id', learnerId)

  if (error || !data) return []

  return data.map((row) => ({
    moduleId: row.module_id,
    state: row.state,
    completedSteps: row.completed_steps,
    updatedAt: row.updated_at,
  }))
}

export async function fetchReflections(learnerId: string): Promise<readonly Reflection[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('reflections')
    .select('module_id, question_id, answer, updated_at')
    .eq('learner_id', learnerId)

  if (error || !data) return []

  return data.map((row) => ({
    moduleId: row.module_id,
    questionId: row.question_id,
    answer: row.answer,
    updatedAt: row.updated_at,
  }))
}

/**
 * Records which steps are done (FR-035 — no save button anywhere).
 *
 * `state` is derived from the step list rather than set by the caller, so "completed"
 * can only mean "every step is ticked". A caller-supplied state would eventually
 * drift from the steps and a learner would see a module marked done with steps
 * outstanding.
 */
export async function saveProgress(
  learnerId: string,
  moduleId: ModuleId,
  completedSteps: readonly string[],
  totalSteps: number,
): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false

  const state: ProgressState =
    completedSteps.length === 0
      ? 'not_started'
      : completedSteps.length >= totalSteps
        ? 'completed'
        : 'in_progress'

  const { error } = await supabase.from('lesson_progress').upsert(
    {
      learner_id: learnerId,
      module_id: moduleId,
      state,
      completed_steps: [...completedSteps],
      updated_at: new Date().toISOString(),
    },
    // The composite primary key. Without naming it, PostgREST resolves the conflict
    // target from the primary key anyway — but naming it means a future index change
    // cannot silently turn an upsert into a duplicate insert.
    { onConflict: 'learner_id,module_id' },
  )

  return !error
}

/** Writes or replaces one answer (FR-035, L4). Trimmed, and empty means delete. */
export async function saveReflection(
  learnerId: string,
  moduleId: ModuleId,
  questionId: string,
  answer: string,
): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false

  const trimmed = answer.trim()

  if (trimmed.length === 0) {
    // Clearing an answer removes the row rather than storing an empty string. An
    // empty answer on an educator's export reads as "she wrote nothing", which is
    // true, and is different from a row that exists holding nothing.
    const { error } = await supabase
      .from('reflections')
      .delete()
      .eq('learner_id', learnerId)
      .eq('module_id', moduleId)
      .eq('question_id', questionId)
    return !error
  }

  const { error } = await supabase.from('reflections').upsert(
    {
      learner_id: learnerId,
      module_id: moduleId,
      question_id: questionId,
      // 1–4000 characters per data-model.md. Truncating here rather than letting the
      // database refuse: a learner who has written a long answer must not lose it to
      // an error she cannot act on.
      answer: trimmed.slice(0, 4000),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'learner_id,module_id,question_id' },
  )

  return !error
}

export const REFLECTION_MAX_LENGTH = 4000

/**
 * How long to wait after the last keystroke before saving (FR-035).
 *
 * Long enough that a learner typing a paragraph produces one write rather than
 * eighty, short enough that navigating away a second after she stops does not lose
 * the sentence. A blur-only save would lose an answer to a closed tab, which is the
 * failure this debounce exists to bound rather than to eliminate — the component
 * also flushes on unmount.
 */
export const AUTOSAVE_DELAY_MS = 800
