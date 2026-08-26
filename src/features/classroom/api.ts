import { getSupabase } from '@/lib/supabase'
import type { InvitationPurpose, PerClassMetric, ProgressState } from '@/lib/database.types'

/**
 * T105–T109 — everything the educator's screens read and write.
 *
 * **This module deliberately cannot see an image.** It imports the Supabase client
 * and nothing else; the on-device sample store is unreachable from
 * `src/features/classroom/` by lint rule, because on a shared classroom Chromebook
 * the educator's browser may well be holding a learner's IndexedDB from the previous
 * lesson, and a "helpful" thumbnail would work on exactly that machine (FR-041).
 *
 * The authorisation model is not here either. Every function below is a plain query
 * or a named RPC, and what an educator may read is decided by the row-level-security
 * policies — `is_educator_of` for the roster, `educator_id = auth.uid()` for the
 * classrooms. A cross-classroom read returns zero rows rather than an error, which is
 * why the interface must treat "no rows" as "not yours" rather than as "empty"
 * (SC-011, FR-042).
 */

export interface Classroom {
  readonly id: string
  readonly name: string
  readonly archivedAt: string | null
  readonly createdAt: string
}

export interface RosterEntry {
  readonly learnerId: string
  /** The only identifier the roster shows. See the note on `PendingInvitation`. */
  readonly alias: string
  readonly isActive: boolean
}

export interface PendingInvitation {
  readonly id: string
  /**
   * The username she assigned.
   *
   * Shown for a *pending* invitation and nowhere else, because before redemption the
   * username is the only identifier that exists — she cannot tell two pending
   * invitations apart without it. Once a learner has redeemed and chosen an alias,
   * the roster shows the alias and drops the username entirely (FR-025).
   */
  readonly target: string
  readonly purpose: InvitationPurpose
  readonly expiresAt: string
  readonly redeemedAt: string | null
  readonly revokedAt: string | null
  readonly createdAt: string
}

export type InvitationState = 'live' | 'redeemed' | 'revoked' | 'expired'

/** The four states of Scenario 6.2, derived rather than stored. */
export function invitationState(invitation: PendingInvitation, now = new Date()): InvitationState {
  if (invitation.redeemedAt !== null) return 'redeemed'
  if (invitation.revokedAt !== null) return 'revoked'
  return new Date(invitation.expiresAt) <= now ? 'expired' : 'live'
}

export interface LearnerProgress {
  readonly learnerId: string
  readonly moduleId: string
  readonly state: ProgressState
  readonly completedSteps: readonly string[]
  readonly updatedAt: string
}

export interface LearnerReflection {
  readonly learnerId: string
  readonly moduleId: string
  readonly questionId: string
  readonly answer: string
  readonly updatedAt: string
}

export interface LearnerRun {
  readonly learnerId: string
  readonly projectName: string
  readonly finishedAt: string
  readonly overallAccuracy: number
  readonly imbalanceRatio: number | null
  readonly perClass: readonly PerClassMetric[]
}

// ─────────────────────────────────────────────────────────── classrooms

export async function listClassrooms(educatorId: string): Promise<readonly Classroom[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('classrooms')
    .select('id, name, archived_at, created_at')
    .eq('educator_id', educatorId)
    .order('created_at', { ascending: false })

  if (error || !data) return []
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  }))
}

export async function createClassroom(
  educatorId: string,
  name: string,
): Promise<Classroom | null> {
  const supabase = await getSupabase()
  if (!supabase) return null

  const id = crypto.randomUUID()
  // `educator_id` is supplied and also checked by the policy's `with check`, so a
  // client that lied about it would be refused rather than create an orphan.
  const { error } = await supabase
    .from('classrooms')
    .insert({ id, name: name.trim(), educator_id: educatorId })

  if (error) return null
  return { id, name: name.trim(), archivedAt: null, createdAt: new Date().toISOString() }
}

export async function renameClassroom(id: string, name: string): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const { error } = await supabase.from('classrooms').update({ name: name.trim() }).eq('id', id)
  return !error
}

/**
 * Archives or un-archives (FR-038).
 *
 * Archiving hides a finished classroom without deleting it or its learners' work — a
 * distinction worth keeping sharp, because "the term is over" and "remove thirty
 * accounts" are very different intentions and only one of them is reversible.
 */
export async function setClassroomArchived(id: string, archived: boolean): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const { error } = await supabase
    .from('classrooms')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
  return !error
}

// ─────────────────────────────────────────────────────────── roster

/**
 * The learners enrolled in one classroom, by alias.
 *
 * Read from `educator_roster`, which is the only relation through which a username is
 * readable at all (P3) — and the username is deliberately not selected here. She
 * issued it and has it on the invitation; putting it on the roster would make it a
 * display surface for no benefit, and FR-025's rule is easiest to keep when the
 * column is simply never asked for.
 */
export async function listRoster(classroomId: string): Promise<readonly RosterEntry[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('educator_roster')
    .select('id, alias, is_active')
    .eq('classroom_id', classroomId)
    .order('alias')

  if (error || !data) return []
  return data.map((row) => ({ learnerId: row.id, alias: row.alias, isActive: row.is_active }))
}

export async function listInvitations(
  educatorId: string,
  classroomId: string,
): Promise<readonly PendingInvitation[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  // `code_hash` is absent from the selection because it is absent from the grant
  // (I2 — the strictest rule in the schema). The plaintext code was returned once by
  // the issuing RPC and exists nowhere now.
  const { data, error } = await supabase
    .from('invitations')
    .select('id, target, purpose, expires_at, redeemed_at, revoked_at, created_at')
    .eq('issuer_id', educatorId)
    .eq('classroom_id', classroomId)
    .order('created_at', { ascending: false })

  if (error || !data) return []
  return data.map((row) => ({
    id: row.id,
    target: row.target,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }))
}

// ─────────────────────────────────────────────────────────── learner detail

export async function listProgress(
  learnerIds: readonly string[],
): Promise<readonly LearnerProgress[]> {
  const supabase = await getSupabase()
  if (!supabase || learnerIds.length === 0) return []

  const { data, error } = await supabase
    .from('lesson_progress')
    .select('learner_id, module_id, state, completed_steps, updated_at')
    .in('learner_id', [...learnerIds])

  if (error || !data) return []
  return data.map((row) => ({
    learnerId: row.learner_id,
    moduleId: row.module_id,
    state: row.state,
    completedSteps: row.completed_steps,
    updatedAt: row.updated_at,
  }))
}

export async function listReflections(
  learnerIds: readonly string[],
): Promise<readonly LearnerReflection[]> {
  const supabase = await getSupabase()
  if (!supabase || learnerIds.length === 0) return []

  const { data, error } = await supabase
    .from('reflections')
    .select('learner_id, module_id, question_id, answer, updated_at')
    .in('learner_id', [...learnerIds])

  if (error || !data) return []
  return data.map((row) => ({
    learnerId: row.learner_id,
    moduleId: row.module_id,
    questionId: row.question_id,
    answer: row.answer,
    updatedAt: row.updated_at,
  }))
}

/**
 * The accuracy figures FR-040 requires, joined through `projects` to their owner.
 *
 * `projects` carries a name and two counts and no image column exists anywhere in the
 * schema (G2), so joining it here cannot widen what an educator can see. The join is
 * done client-side over two selects rather than as a PostgREST embed, because an
 * embed evaluates the child's policies through the parent's and the resulting
 * behaviour is much harder to reason about than two independently-policed reads.
 */
export async function listRuns(learnerIds: readonly string[]): Promise<readonly LearnerRun[]> {
  const supabase = await getSupabase()
  if (!supabase || learnerIds.length === 0) return []

  const { data: projects, error: projectError } = await supabase
    .from('projects')
    .select('id, owner_id, name')
    .in('owner_id', [...learnerIds])

  if (projectError || !projects || projects.length === 0) return []

  const owners = new Map(projects.map((row) => [row.id, { ownerId: row.owner_id, name: row.name }]))

  const { data: runs, error: runError } = await supabase
    .from('training_runs')
    .select('project_id, finished_at, overall_accuracy, imbalance_ratio, per_class')
    .in('project_id', [...owners.keys()])
    .order('finished_at', { ascending: false })

  if (runError || !runs) return []

  return runs.flatMap((row) => {
    const project = owners.get(row.project_id)
    if (!project) return []
    return [
      {
        learnerId: project.ownerId,
        projectName: project.name,
        finishedAt: row.finished_at,
        overallAccuracy: row.overall_accuracy,
        imbalanceRatio: row.imbalance_ratio,
        perClass: row.per_class,
      },
    ]
  })
}

// ─────────────────────────────────────────────────── invitations and lifecycle

export type IssueFailure =
  | 'usernameTaken'
  | 'invitationExists'
  | 'usernameShape'
  | 'notYourClassroom'
  | 'unconfigured'
  | 'unknown'

export type IssueResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly failure: IssueFailure }

/**
 * Issues a learner invitation, returning the plaintext code **once** (FR-026, R15).
 *
 * Once is not a limitation to work around. The code is a bearer credential for
 * creating an account inside a named classroom, and only its hash is stored, so
 * showing it again later is not something the interface is choosing not to do — there
 * is nothing to show. The caller must therefore display it immediately and say so.
 */
export async function issueLearnerInvitation(
  classroomId: string,
  username: string,
): Promise<IssueResult> {
  const supabase = await getSupabase()
  if (!supabase) return { ok: false, failure: 'unconfigured' }

  const { data, error } = await supabase.rpc('issue_learner_invitation', {
    classroom: classroomId,
    username: username.trim(),
  })

  if (error) return { ok: false, failure: classifyIssueError(error.message) }
  if (typeof data !== 'string' || data.length === 0) return { ok: false, failure: 'unknown' }
  return { ok: true, code: data }
}

/**
 * Matched on the database's own wording, for the same reason
 * `classifyRedemptionError` is: the distinctions the interface may draw are the ones
 * the database drew, and no others.
 */
export function classifyIssueError(message: string): IssueFailure {
  const text = message.toLowerCase()
  // Checked before the generic "already" cases: an unredeemed invitation for the
  // same username is recoverable by revoking it, and a taken username is not, so
  // telling her the wrong one sends her to the wrong action.
  if (text.includes('unredeemed invitation for that username')) return 'invitationExists'
  if (text.includes('username is already taken')) return 'usernameTaken'
  if (text.includes('a username must be between') || text.includes('may contain only')) {
    return 'usernameShape'
  }
  if (text.includes('do not own an active classroom')) return 'notYourClassroom'
  return 'unknown'
}

/** A fresh single-use code so a learner can set a new password (FR-030). */
export async function issuePasswordReset(learnerId: string): Promise<IssueResult> {
  const supabase = await getSupabase()
  if (!supabase) return { ok: false, failure: 'unconfigured' }

  const { data, error } = await supabase.rpc('issue_password_reset', { learner: learnerId })
  if (error) return { ok: false, failure: 'unknown' }
  if (typeof data !== 'string' || data.length === 0) return { ok: false, failure: 'unknown' }
  return { ok: true, code: data }
}

export async function revokeInvitation(id: string): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const { error } = await supabase.rpc('revoke_invitation', { id })
  return !error
}

/**
 * Removes a learner from the classroom, and nothing else (FR-039, E4).
 *
 * One row: the enrolment. Her account, her projects, her progress and her reflections
 * all survive, and only the educator's visibility ends. This is the light action; the
 * heavy one is `deleteLearner` below, and keeping them visibly separate is the whole
 * point — an educator tidying up a roster at the end of term must not be one
 * mis-click from destroying a learner's work.
 */
export async function removeFromClassroom(
  classroomId: string,
  learnerId: string,
): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const { error } = await supabase
    .from('enrolments')
    .delete()
    .eq('classroom_id', classroomId)
    .eq('learner_id', learnerId)
  return !error
}

/**
 * Deletes the account and every remote row belonging to it (FR-052, SC-015).
 *
 * Irreversible, audited in the same transaction as its effect (FR-058), and unable to
 * reach her local samples and models — which is the intended consequence of keeping
 * images on the device, and something the interface must say rather than leave her to
 * assume either way (Scenario 6.7).
 */
export async function deleteLearner(learnerId: string): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const { error } = await supabase.rpc('delete_learner', { id: learnerId })
  return !error
}
