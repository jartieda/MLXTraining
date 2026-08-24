import { create } from 'zustand'
import type { AccountRole } from '@/lib/database.types'

/**
 * The session store.
 *
 * Introduced with the shell (T034) because routing and the local-storage owner
 * scope both need to know who is signed in; the sign-in and redemption flows that
 * populate it arrive with US4 (T073).
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
