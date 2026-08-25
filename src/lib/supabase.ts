import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from './database.types'

/**
 * T033 — the Supabase client.
 *
 * Called directly, with no wrapper abstraction, as Principle VII requires: a
 * repository layer over a client that is already a repository buys nothing and
 * hides which policy a failing query hit.
 *
 * Two things are load-bearing here.
 *
 * **The anon key is the only key that exists in this codebase.** There is no
 * `service_role` key anywhere, and there must never be one — it bypasses every
 * row-level-security policy, and those policies are the entire authorisation
 * model (Principle II). Elevated operations go through the nine SECURITY DEFINER
 * functions instead, which is why `rpc` below is the only privileged surface.
 *
 * **The environment is validated at module load, not at first use.** A missing or
 * malformed URL should fail on the landing page with a message a contributor can
 * act on, not silently at the moment a learner tries to sign in.
 */

const environmentSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .url('VITE_SUPABASE_URL must be a full URL, e.g. https://abcdefgh.supabase.co'),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'VITE_SUPABASE_ANON_KEY looks too short to be a real key'),
})

export type Environment = z.infer<typeof environmentSchema>

export interface EnvironmentResult {
  readonly ok: boolean
  readonly environment: Environment | null
  readonly problem: string | null
}

/**
 * Reads and validates the `VITE_` variables.
 *
 * Returns a result rather than throwing. The unauthenticated lab is the whole
 * product for a visitor with no account (FR-023) and it needs no Supabase at all,
 * so a missing configuration must degrade to "you cannot sign in" rather than a
 * blank screen for everyone.
 */
export function readEnvironment(source: Record<string, unknown> = import.meta.env): EnvironmentResult {
  const parsed = environmentSchema.safeParse(source)
  if (parsed.success) {
    return { ok: true, environment: parsed.data, problem: null }
  }

  const problem = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')

  return { ok: false, environment: null, problem }
}

export type LabSupabaseClient = SupabaseClient<Database>

let cached: LabSupabaseClient | null = null
let pending: Promise<LabSupabaseClient | null> | null = null
let cachedProblem: string | null = null

/**
 * The client, or `null` when the environment is not configured.
 *
 * Callers must handle `null`: it is the normal state of a checkout with no
 * `.env`, and of a deployment intended to run the local lab only.
 *
 * **Asynchronous because `@supabase/supabase-js` is imported dynamically**, and
 * that is a budget decision with a measured cost. Importing it statically puts
 * ~74 KB compressed into the initial chunk and pushes past the 200 KB budget
 * SC-008 rests on — for a library that an anonymous visitor never calls, since
 * FR-023 gives her the whole lab with no account. So it arrives when someone
 * actually signs in.
 *
 * The `pending` promise is what makes that safe under concurrency: the shell
 * bootstraps a session while a page may already be reading a profile, and two
 * racing callers must get the same client rather than two, each with its own
 * token refresh loop competing over one storage key.
 */
export async function getSupabase(): Promise<LabSupabaseClient | null> {
  if (cached) return cached
  if (cachedProblem !== null) return null
  if (pending) return pending

  pending = createLabClient()
  const client = await pending
  pending = null
  return client
}

async function createLabClient(): Promise<LabSupabaseClient | null> {
  const result = readEnvironment()
  if (!result.ok || !result.environment) {
    cachedProblem = result.problem ?? 'Supabase is not configured.'
    return null
  }

  const { createClient } = await import('@supabase/supabase-js')

  cached = createClient<Database>(
    result.environment.VITE_SUPABASE_URL,
    result.environment.VITE_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // A learner authenticates by username, never by a link in an email she
        // does not have (R16), so there is no callback URL to detect.
        detectSessionInUrl: false,
        storageKey: 'ml4g.auth',
      },
      global: {
        headers: { 'x-application-name': 'ml4g-xai-lab' },
      },
    },
  )

  return cached
}

/**
 * Why the client is unavailable, for a message a contributor can act on.
 *
 * Answered from the environment alone, without constructing anything. Both this
 * and `isSupabaseConfigured` stay synchronous for that reason: whether an account
 * service exists is a question the interface asks while rendering, and the answer
 * has never depended on the library being loaded.
 */
export function supabaseProblem(): string | null {
  if (cached) return null
  if (cachedProblem !== null) return cachedProblem
  const result = readEnvironment()
  return result.ok ? null : (result.problem ?? 'Supabase is not configured.')
}

export function isSupabaseConfigured(): boolean {
  return supabaseProblem() === null
}

/** Test-only: drops the memoised client so a fresh environment can be asserted. */
export function resetSupabaseForTesting(): void {
  cached = null
  pending = null
  cachedProblem = null
}

/**
 * The invitation lifetime, for the interface to state when a code expires.
 * Read from the environment so it cannot drift from the database's own 72 hours
 * without someone noticing both.
 */
export function invitationTtlHours(): number {
  const raw: unknown = import.meta.env.VITE_INVITATION_TTL_HOURS
  const parsed = z.coerce.number().int().positive().safeParse(raw)
  return parsed.success ? parsed.data : 72
}

/**
 * Maps a Postgres error onto the locale key the interface should show.
 *
 * The three invitation refusals must stay distinguishable (FR-028) while the two
 * "not valid" cases must stay identical (I5, SC-020), and both properties are
 * decided by the database's own message. Matching on it here rather than
 * re-deriving a reason from the code is what keeps the client from inventing a
 * distinction the database deliberately refused to make.
 */
export type RedemptionRefusal =
  | 'expired'
  | 'used'
  | 'cancelled'
  | 'rateLimited'
  | 'invalid'
  | 'aliasTaken'
  | 'aliasLength'
  | 'passwordTooShort'
  | 'unconfigured'
  | 'unknown'

export function classifyRedemptionError(message: string): RedemptionRefusal {
  const text = message.toLowerCase()
  if (text.includes('too many attempts')) return 'rateLimited'
  if (text.includes('expired')) return 'expired'
  if (text.includes('already been used')) return 'used'
  if (text.includes('cancelled')) return 'cancelled'
  // Both alias refusals say "display name", so the taken case has to be matched
  // first and on its own distinctive phrase. Ordered the other way round, a
  // learner told to pick a shorter name would in fact have picked a name her
  // classmate already has — a message that sends her to fix the wrong thing.
  if (text.includes('already uses that display name')) return 'aliasTaken'
  if (text.includes('display name between')) return 'aliasLength'
  if (text.includes('8 characters')) return 'passwordTooShort'
  if (text.includes('not valid')) return 'invalid'
  return 'unknown'
}
