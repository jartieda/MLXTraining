import { vi } from 'vitest'
import type { AccountRole, UiLocale } from '@/lib/database.types'

/**
 * A fake Supabase client for the US4 component tests.
 *
 * The row-level-security contracts are tested against a real Postgres in
 * `tests/db/` and nothing here re-tests them — a mocked policy engine asserts
 * nothing about the thing being relied on. What these tests are for is the other
 * half: given a refusal the database has already decided on, does the *interface*
 * say the right thing? So this fake models only the shapes the auth screens
 * consume, and every refusal it produces is a message copied from
 * `supabase/migrations/0002_functions.sql` verbatim.
 *
 * Copied verbatim on purpose. `classifyRedemptionError` matches on the database's
 * own wording, so a test that invented its own phrasing would pass while the real
 * refusal fell through to `unknown`.
 */

export interface ProfileRow {
  id: string
  alias: string
  role: AccountRole
  display_name: string | null
  is_active: boolean
  locale: UiLocale
  classroom_id: string | null
  created_at: string
}

export interface ProjectRow {
  id: string
  owner_id: string
  name: string
  class_count: number
  sample_count: number
  created_at: string
  updated_at: string
}

/** The exact refusals `redeem_invitation` raises. Do not paraphrase. */
export const DB_MESSAGE = {
  indistinguishable: 'That code is not valid. Check it with whoever gave it to you.',
  rateLimited: 'Too many attempts. Wait an hour and try again.',
  cancelled: 'That code was cancelled. Ask for a new one.',
  used: 'That code has already been used. Ask for a new one.',
  expired: 'That code has expired. Ask for a new one.',
  aliasTaken: 'Someone in your class already uses that display name. Pick another.',
  aliasLength: 'Choose a display name between 2 and 24 characters.',
  passwordTooShort: 'Choose a password of at least 8 characters.',
} as const

export interface LessonProgressRow {
  learner_id: string
  module_id: string
  state: 'not_started' | 'in_progress' | 'completed'
  completed_steps: string[]
  updated_at: string
}

export interface ReflectionRow {
  id: string
  learner_id: string
  module_id: string
  question_id: string
  answer: string
  updated_at: string
}

interface Tables {
  profiles: ProfileRow[]
  projects: ProjectRow[]
  lesson_progress: LessonProgressRow[]
  reflections: ReflectionRow[]
}

/**
 * A chainable stand-in for PostgrestFilterBuilder.
 *
 * Only `select`/`eq`/`order`/`maybeSingle` and `upsert` are modelled, because
 * only those are called. A fake that grew a `gte` nobody uses would be a second
 * implementation of PostgREST maintained for nothing.
 */
class FakeQuery<T extends Record<string, unknown>> implements PromiseLike<{ data: T[]; error: null }> {
  private rows: T[]
  private deleting = false
  private readonly onUpsert: (values: readonly Partial<T>[], options?: unknown) => void
  private readonly onDelete: (rows: readonly T[]) => void

  // Written out rather than as constructor parameter properties: `tsconfig.app.json`
  // sets `erasableSyntaxOnly`, which forbids the shorthand.
  constructor(
    rows: readonly T[],
    onUpsert: (values: readonly Partial<T>[], options?: unknown) => void,
    onDelete: (rows: readonly T[]) => void = () => undefined,
  ) {
    this.rows = [...rows]
    this.onUpsert = onUpsert
    this.onDelete = onDelete
  }

  select(): this {
    return this
  }

  order(): this {
    return this
  }

  eq(column: keyof T, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value)
    // A delete is terminal only once its filters are applied, so the rows are
    // reported on each `eq` and the last call is the one the test reads.
    if (this.deleting) this.onDelete(this.rows)
    return this
  }

  delete(): this {
    this.deleting = true
    return this
  }

  maybeSingle(): Promise<{ data: T | null; error: null }> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null })
  }

  upsert(
    values: Partial<T> | readonly Partial<T>[],
    options?: unknown,
  ): Promise<{ data: null; error: null }> {
    this.onUpsert(Array.isArray(values) ? values : [values as Partial<T>], options)
    return Promise.resolve({ data: null, error: null })
  }

  insert(values: Partial<T> | readonly Partial<T>[]): Promise<{ data: null; error: null }> {
    this.onUpsert(Array.isArray(values) ? values : [values as Partial<T>])
    return Promise.resolve({ data: null, error: null })
  }

  then<R1 = { data: T[]; error: null }, R2 = never>(
    onFulfilled?: ((value: { data: T[]; error: null }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onFulfilled, onRejected)
  }
}

export interface FakeSupabase {
  readonly tables: Tables
  readonly upserted: Record<string, unknown[]>
  /** The options passed with each upsert, so a test can assert `onConflict`. */
  readonly upsertOptions: Record<string, unknown[]>
  readonly deleted: Record<string, unknown[]>
  readonly rpc: ReturnType<typeof vi.fn>
  readonly signInWithPassword: ReturnType<typeof vi.fn>
  readonly signOut: ReturnType<typeof vi.fn>
  /** The account the fake reports as already signed in on load. */
  currentUserId: string | null
  /** Makes the next `signInWithPassword` fail the way GoTrue does. */
  refuseSignIn(status?: number): void
  /** Makes the next `rpc` reject with a Postgres-shaped error. */
  refuseRpc(message: string, code?: string): void
  /** Makes the next `rpc` resolve with a new account id. */
  acceptRpc(userId: string): void
}

export function createFakeSupabase(seed: Partial<Tables> = {}): FakeSupabase {
  const tables: Tables = {
    profiles: seed.profiles ?? [],
    projects: seed.projects ?? [],
    lesson_progress: seed.lesson_progress ?? [],
    reflections: seed.reflections ?? [],
  }
  const upserted: Record<string, unknown[]> = {}
  const upsertOptions: Record<string, unknown[]> = {}
  const deleted: Record<string, unknown[]> = {}

  interface PostgresError {
    message: string
    code: string
    details: string
    hint: string
  }
  const rpc = vi.fn(
    (): Promise<{ data: string | null; error: PostgresError | null }> =>
      Promise.resolve({ data: null, error: null }),
  )
  const signInWithPassword = vi.fn()
  const signOut = vi.fn(() => Promise.resolve({ error: null }))

  const fake: FakeSupabase = {
    tables,
    upserted,
    upsertOptions,
    deleted,
    rpc,
    signInWithPassword,
    signOut,
    currentUserId: null,
    refuseSignIn(status = 400) {
      signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', status, name: 'AuthApiError' },
      })
    },
    refuseRpc(message, code = '22023') {
      rpc.mockResolvedValueOnce({
        data: null,
        error: { message, code, details: '', hint: '' },
      })
    },
    acceptRpc(userId) {
      rpc.mockResolvedValueOnce({ data: userId, error: null })
    },
  }

  signInWithPassword.mockImplementation(({ email }: { email: string; password: string }) => {
    // The fake resolves a credential the way `authIdentifierFor` does, so a test
    // that passes the wrong domain fails here rather than silently succeeding.
    const local = email.split('@')[0] ?? ''
    const profile = tables.profiles.find((row) => row.id === local || row.alias === local)
    if (!profile) {
      return Promise.resolve({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', status: 400, name: 'AuthApiError' },
      })
    }
    fake.currentUserId = profile.id
    return Promise.resolve({
      data: { user: { id: profile.id, email }, session: { access_token: 'fake' } },
      error: null,
    })
  })

  const client = {
    auth: {
      signInWithPassword,
      signOut: () => {
        fake.currentUserId = null
        return signOut()
      },
      getSession: () =>
        Promise.resolve({
          data: {
            session: fake.currentUserId ? { user: { id: fake.currentUserId } } : null,
          },
          error: null,
        }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
    },
    rpc,
    from: (table: keyof Tables) =>
      new FakeQuery(
        tables[table] as unknown as Record<string, unknown>[],
        (values, options) => {
          upserted[table] = [...(upserted[table] ?? []), ...values]
          if (options !== undefined) {
            upsertOptions[table] = [...(upsertOptions[table] ?? []), options]
          }
        },
        (rows) => {
          deleted[table] = [...rows]
        },
      ),
  }

  ;(fake as { client?: unknown }).client = client
  return fake
}

export function clientOf(fake: FakeSupabase): unknown {
  return (fake as unknown as { client: unknown }).client
}

/** A ready-made learner profile row. */
export function learnerProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: 'learner-1',
    alias: 'Comet',
    role: 'learner',
    display_name: null,
    is_active: true,
    locale: 'en',
    classroom_id: 'classroom-1',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
