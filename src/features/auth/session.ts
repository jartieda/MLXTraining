import { create } from 'zustand'
import { getSupabase } from '@/lib/supabase'
import type { AccountRole, Database } from '@/lib/database.types'

/**
 * The session store, and the one place a credential becomes an auth identifier.
 *
 * Introduced with the shell (T034) because routing and the local-storage owner
 * scope both need to know who is signed in; T073 (US4) fills it in.
 *
 * The important property is that **anonymous is a first-class state, not an error
 * state**. FR-023 gives an unauthenticated visitor the complete local lab, so
 * `account === null` is the normal case for a large share of use and every
 * consumer must handle it without a warning or a redirect.
 */

export interface Account {
  readonly id: string
  /** The only identifier ever shown to another learner (FR-025). */
  readonly alias: string
  readonly role: AccountRole
  /** How an educator or administrator appears. `null` for a learner. */
  readonly displayName: string | null
  readonly classroomId: string | null
}

export type SessionStatus = 'loading' | 'anonymous' | 'signed-in'

interface SessionState {
  readonly status: SessionStatus
  readonly account: Account | null
  readonly setAccount: (account: Account | null) => void
  readonly setLoading: () => void
  readonly signOut: () => void
}

export const useSession = create<SessionState>((set) => ({
  // 'loading' until the stored session is resolved, so the shell does not flash
  // the signed-out navigation at a learner who is in fact signed in.
  status: 'loading',
  account: null,
  setAccount: (account) => {
    set({ account, status: account ? 'signed-in' : 'anonymous' })
  },
  setLoading: () => {
    set({ status: 'loading' })
  },
  signOut: () => {
    set({ account: null, status: 'anonymous' })
  },
}))

/**
 * The owner id for local-storage reads and writes (D9).
 *
 * `null` for an anonymous session, which is exactly what `src/lib/db.ts` expects:
 * anonymous work is stored under a `null` owner and is invisible to any signed-in
 * account on the same device. Shared devices are the norm in schools, so this is
 * a real privacy boundary rather than a bookkeeping detail.
 */
export function useOwnerId(): string | null {
  return useSession((state) => state.account?.id ?? null)
}

export function useIsRole(...roles: readonly AccountRole[]): boolean {
  return useSession((state) => (state.account ? roles.includes(state.account.role) : false))
}

// ─────────────────────────────────────────────────────── the R16 boundary

/**
 * The domain a learner's synthetic auth identifier lives in.
 *
 * `invalid` is reserved by RFC 2606 as permanently non-resolvable, and a reserved
 * domain is chosen over a plausible-looking one precisely so that no
 * misconfiguration can ever cause mail to be delivered somewhere real (R16).
 * It matches `redeem_invitation` in supabase/migrations/0002_functions.sql; the
 * two must not drift, or every learner account becomes unreachable at sign-in.
 */
export const LEARNER_AUTH_DOMAIN = 'learner.invalid'

/**
 * Maps what a person types into what the auth provider needs — the single
 * boundary FR-024/R16 describes, and the only place in the client that knows the
 * synthetic identifier exists.
 *
 * A learner types the username her educator gave her; an educator or an
 * administrator types the email address she was invited by. The `@` is the whole
 * discriminator, and it is reliable because a username may not contain one
 * (0001_schema.sql constrains it to `[A-Za-z0-9._-]`).
 *
 * The result is never displayed. It is not a means of contact and showing it
 * would imply otherwise (FR-025, FR-029).
 */
export function authIdentifierFor(credential: string): string {
  const trimmed = credential.trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : `${trimmed}@${LEARNER_AUTH_DOMAIN}`
}

// ─────────────────────────────────────────────────────── sign-in and sign-out

export type SignInFailure = 'wrongCredentials' | 'deactivated' | 'unconfigured' | 'network'

export interface SignInResult {
  readonly ok: boolean
  readonly failure: SignInFailure | null
}

type ProfileRow = Database['public']['Tables']['profiles']['Row']

function toAccount(row: ProfileRow): Account {
  return {
    id: row.id,
    alias: row.alias,
    role: row.role,
    displayName: row.display_name,
    classroomId: row.classroom_id,
  }
}

/**
 * Reads the caller's own profile row (P1).
 *
 * `username` is deliberately absent from the selection, and not as a courtesy:
 * it is absent from the `authenticated` grant altogether (0003_rls.sql), so
 * asking for it would fail the query outright. FR-025 is enforced by the schema
 * rather than by remembering.
 */
async function fetchOwnProfile(userId: string): Promise<ProfileRow | null> {
  const supabase = await getSupabase()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, alias, role, display_name, is_active, locale, classroom_id, created_at')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) return null
  return data
}

/**
 * Signs in for all three roles (FR-024).
 *
 * Two refusals are collapsed into one on purpose. A username that does not exist
 * and a password that is wrong both return `wrongCredentials`, because a
 * distinguishable "no such user" is an enumeration oracle over a namespace an
 * educator assigns — and the usernames she assigns are guessable by design
 * (Edge Cases, SC-020).
 *
 * `is_active = false` is checked here and acted on by signing straight back out.
 * The database is the real enforcement — `current_account_role()` returns nothing
 * for an inactive account, so every policy already denies her — but a session
 * that exists and reads nothing looks like a broken lab rather than a switched-off
 * account, and she deserves to be told which it is (FR-054).
 */
export async function signIn(credential: string, password: string): Promise<SignInResult> {
  const supabase = await getSupabase()
  if (!supabase) return { ok: false, failure: 'unconfigured' }

  useSession.getState().setLoading()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: authIdentifierFor(credential),
    password,
  })

  if (error || !data.user) {
    useSession.getState().signOut()
    // GoTrue answers a bad credential with an HTTP status; a fetch that never
    // arrived has none. Reporting a school's dropped connection as a wrong
    // password sends a learner hunting for a mistake she did not make.
    const isTransport = !error || typeof error.status !== 'number' || error.status === 0
    return { ok: false, failure: isTransport ? 'network' : 'wrongCredentials' }
  }

  const profile = await fetchOwnProfile(data.user.id)

  if (!profile) {
    await supabase.auth.signOut()
    useSession.getState().signOut()
    return { ok: false, failure: 'wrongCredentials' }
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    useSession.getState().signOut()
    return { ok: false, failure: 'deactivated' }
  }

  useSession.getState().setAccount(toAccount(profile))
  return { ok: true, failure: null }
}

export async function signOutSession(): Promise<void> {
  const supabase = await getSupabase()
  await supabase?.auth.signOut()
  useSession.getState().signOut()
}

/**
 * Resolves the stored session once, at start-up, and follows it thereafter.
 *
 * Called from `main.tsx` before the first paint is *not* awaited: FR-023 makes
 * the lab usable with no account, so blocking the landing page on a token refresh
 * over a school connection would cost every anonymous visitor the wait for
 * something she never asked for. The store starts `loading` and drops to
 * `anonymous` the moment there is nothing to restore.
 */
export async function bootstrapSession(): Promise<void> {
  const supabase = await getSupabase()
  if (!supabase) {
    useSession.getState().setAccount(null)
    return
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      useSession.getState().signOut()
      return
    }
    void fetchOwnProfile(session.user.id).then((profile) => {
      useSession
        .getState()
        .setAccount(profile && profile.is_active ? toAccount(profile) : null)
    })
  })

  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user) {
    useSession.getState().setAccount(null)
    return
  }

  const profile = await fetchOwnProfile(user.id)
  useSession.getState().setAccount(profile && profile.is_active ? toAccount(profile) : null)
}
