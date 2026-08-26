import { getSupabase } from '@/lib/supabase'
import type { AccountRole, InvitationPurpose } from '@/lib/database.types'

/**
 * T131–T134 — the administrator's entire remote surface.
 *
 * **Three reads, and that is the whole of it** (FR-055, SC-018): educator profiles,
 * the invitations she issued, and a classroom's id, name and owner. There is no
 * function here for a learner, a project, a training run, a progress record or a
 * reflection, and adding one would be caught by `tests/e2e/us9-admin-isolation.spec.ts`
 * — but the stronger guarantee is that there is no policy that would let one work.
 *
 * The narrowness is the role. An administrator exists to manage who may run a
 * classroom, not to look inside one, and she is the only role in the system defined
 * mostly by what it cannot see. That is why this module is short: not because the
 * feature is small, but because the read surface is deliberately two tables and a
 * three-column view wide.
 *
 * Like the classroom feature, this directory cannot import the on-device sample store
 * at all (lint rule `no-local-store-in-classroom`), so FR-055's "no image" holds by
 * construction rather than by review.
 */

export interface EducatorSummary {
  readonly id: string
  /** How she appears. An administrator never sees a learner's alias, only an adult's. */
  readonly displayName: string | null
  readonly role: AccountRole
  readonly isActive: boolean
}

export interface IssuedInvitation {
  readonly id: string
  /** An educator's email address — the one personal datum this system holds. */
  readonly target: string
  readonly purpose: InvitationPurpose
  readonly expiresAt: string
  readonly redeemedAt: string | null
  readonly revokedAt: string | null
  readonly createdAt: string
}

/**
 * A classroom, as an administrator sees it: a name and an owner.
 *
 * Read through `admin_classrooms`, which is her only route — `classrooms` itself has
 * no administrator policy, so it returns zero rows to her (K5). The view exposes no
 * column from which a learner, a project or a reflection could be reached, which is
 * what lets FR-057 exist without giving her a way into FR-055's forbidden territory.
 */
export interface AdminClassroom {
  readonly id: string
  readonly name: string
  readonly educatorId: string
}

export async function listEducators(): Promise<readonly EducatorSummary[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role, is_active')
    // Redundant with P6, which already restricts her to educators and
    // administrators — and kept because a query that asked for everything and
    // filtered client-side would look identical until the policy changed.
    .in('role', ['educator', 'administrator'])
    .order('display_name')

  if (error || !data) return []
  return data.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
  }))
}

export async function listIssuedInvitations(
  administratorId: string,
): Promise<readonly IssuedInvitation[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  // `code_hash` is absent because it is absent from the grant (I2). The plaintext
  // was returned once by the issuing RPC and exists nowhere now.
  const { data, error } = await supabase
    .from('invitations')
    .select('id, target, purpose, expires_at, redeemed_at, revoked_at, created_at')
    .eq('issuer_id', administratorId)
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

export async function listAdminClassrooms(): Promise<readonly AdminClassroom[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase.from('admin_classrooms').select('id, name, educator_id')
  if (error || !data) return []
  return data.map((row) => ({ id: row.id, name: row.name, educatorId: row.educator_id }))
}

/**
 * The four states of an invitation, derived rather than stored.
 *
 * Redemption wins over expiry: an account that exists is not "expired", and telling
 * an administrator otherwise would send her to reissue an invitation for an educator
 * who already has an account.
 */
export type InvitationState = 'live' | 'redeemed' | 'revoked' | 'expired'

export function invitationState(
  invitation: IssuedInvitation,
  now = new Date(),
): InvitationState {
  if (invitation.redeemedAt !== null) return 'redeemed'
  if (invitation.revokedAt !== null) return 'revoked'
  return new Date(invitation.expiresAt) <= now ? 'expired' : 'live'
}

// ─────────────────────────────────────────────────────── privileged actions

export type AdminFailure =
  | 'notAdministrator'
  | 'badEmail'
  | 'lastAdministrator'
  | 'notAnEducator'
  | 'alreadyOwns'
  | 'unconfigured'
  | 'unknown'

export type IssueResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly failure: AdminFailure }

/**
 * Invites an educator by email address (FR-053).
 *
 * Returns the code **once**, like every other invitation in the system. The lab does
 * not send it — there is no mail configuration anywhere in this codebase, deliberately
 * — so the caller must hand it over, and `InviteEducator` offers a `mailto:` and a
 * copy button for that.
 */
export async function issueEducatorInvitation(email: string): Promise<IssueResult> {
  const supabase = await getSupabase()
  if (!supabase) return { ok: false, failure: 'unconfigured' }

  const { data, error } = await supabase.rpc('issue_educator_invitation', {
    email: email.trim().toLowerCase(),
  })

  if (error) return { ok: false, failure: classifyAdminError(error.message) }
  if (typeof data !== 'string' || data.length === 0) return { ok: false, failure: 'unknown' }
  return { ok: true, code: data }
}

/** Matched on the database's own wording, for the reason the other classifiers are. */
export function classifyAdminError(message: string): AdminFailure {
  const text = message.toLowerCase()
  if (text.includes('only an administrator')) return 'notAdministrator'
  if (text.includes('does not look like an email')) return 'badEmail'
  if (text.includes('last remaining active administrator') || text.includes('last administrator')) {
    return 'lastAdministrator'
  }
  if (text.includes('must be an active educator')) return 'notAnEducator'
  if (text.includes('already belongs to that educator')) return 'alreadyOwns'
  return 'unknown'
}

export async function revokeInvitation(id: string): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const { error } = await supabase.rpc('revoke_invitation', { id })
  return !error
}

/**
 * Deactivates an educator (FR-054), or refuses when she is the last administrator
 * (FR-056).
 *
 * The refusal is enforced inside `deactivate_educator` and by a partial constraint,
 * not here — a client-side check would be removed by anyone who cared to try, and the
 * consequence of getting it wrong is a program locked out of its own administration
 * with no path back except a database migration.
 *
 * Her classrooms and her learners' work are untouched. Only her access ends, which is
 * why FR-057's reassignment exists alongside it.
 */
export async function deactivateEducator(id: string): Promise<AdminFailure | null> {
  const supabase = await getSupabase()
  if (!supabase) return 'unconfigured'
  const { error } = await supabase.rpc('deactivate_educator', { id })
  return error ? classifyAdminError(error.message) : null
}

/**
 * Moves a classroom to another active educator (FR-057).
 *
 * The only column an administrator may write anywhere in the schema. She cannot
 * rename, archive or delete a classroom — `admin_classrooms` is not updatable and has
 * no `INSTEAD OF` trigger (K6) — so this one narrow write is her whole authority over
 * a classroom, and it exists solely so that deactivating an educator never strands a
 * group of learners.
 */
export async function reassignClassroom(
  classroomId: string,
  toEducatorId: string,
): Promise<AdminFailure | null> {
  const supabase = await getSupabase()
  if (!supabase) return 'unconfigured'
  const { error } = await supabase.rpc('reassign_classroom', {
    classroom: classroomId,
    to_educator: toEducatorId,
  })
  return error ? classifyAdminError(error.message) : null
}

/**
 * A `mailto:` URL handing the code over (FR-053).
 *
 * The application sends nothing. This opens the administrator's *own* mail client
 * with the recipient and message prefilled, so the message is sent by her, from her
 * address, through her provider — which is why there is no SMTP configuration in this
 * project and no service that could leak a recipient list.
 *
 * The code is interpolated into `body` by the caller rather than passed here, so this
 * function never handles a credential it might log or mangle.
 */
export function handoverMailto(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
