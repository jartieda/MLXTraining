import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

/**
 * Harness for the row-level-security contract suite.
 *
 * These tests run against a **real local Supabase Postgres**, not a mock. That is
 * not thoroughness for its own sake: row-level security is this project's entire
 * authorisation model (Principle II — there is no server to check anything), so a
 * mocked policy engine would assert nothing about the thing being relied on.
 *
 * Roles are simulated the way PostgREST does it — `set local role authenticated`
 * plus a `request.jwt.claims` setting that `auth.uid()` reads — rather than by
 * signing JWTs and going over HTTP. Same policy evaluation, no network, and a
 * failure points at a policy instead of at a fetch.
 */

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations')
const SEED_FILE = join(REPO_ROOT, 'supabase', 'seed.sql')

/** `supabase start` publishes Postgres here. */
export const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export function databaseUrl(): string {
  return process.env.SUPABASE_DB_URL ?? DEFAULT_DATABASE_URL
}

export const UNAVAILABLE_REASON =
  'No local Supabase Postgres on 127.0.0.1:54322. Run `npx supabase start` (needs Docker), ' +
  'or set SUPABASE_DB_URL. These are the row-level-security contract tests and they are ' +
  'merge-blocking in CI — a local skip is not a pass.'

/** Fixed ids from supabase/seed.sql, so a failure names the same account every run. */
export const SEED = {
  admin: '00000000-0000-4000-a000-0000000000a1',
  educator1: '00000000-0000-4000-a000-0000000000e1',
  educator2: '00000000-0000-4000-a000-0000000000e2',
  learner1: '00000000-0000-4000-a000-00000000001a',
  learner1b: '00000000-0000-4000-a000-00000000001b',
  learner2: '00000000-0000-4000-a000-00000000002a',
  classroom1: '00000000-0000-4000-b000-0000000000c1',
  classroom2: '00000000-0000-4000-b000-0000000000c2',
  invitationEducator: '00000000-0000-4000-c000-0000000000d1',
  invitationLearner: '00000000-0000-4000-c000-0000000000d2',
  invitationReset: '00000000-0000-4000-c000-0000000000d3',
  project1: '00000000-0000-4000-d000-0000000000f1',
  project2: '00000000-0000-4000-d000-0000000000f2',
  run1: '00000000-0000-4000-e000-0000000000a1',
  /** Plaintext codes the seed hashed. Known here only because the seed put them there. */
  codeEducator: 'SEEDA2',
  codeLearner: 'SEEDB3',
  codeReset: 'SEEDC4',
} as const

let client: Client | null = null
let available: boolean | null = null

/**
 * Whether a usable database is reachable. Checks for the `auth` schema too: a
 * plain Postgres without Supabase's auth schema would fail every test for a
 * reason that has nothing to do with a policy.
 */
export async function checkAvailable(): Promise<boolean> {
  if (available !== null) return available

  const probe = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 2000 })
  try {
    await probe.connect()
    const result = await probe.query<{ present: boolean }>(
      `select exists (select 1 from information_schema.schemata where schema_name = 'auth') as present`,
    )
    available = result.rows[0]?.present === true
  } catch {
    available = false
  } finally {
    await probe.end().catch(() => undefined)
  }

  // In CI a missing database must be a FAILURE, not a skip. These are the
  // twenty-two row-level-security contracts, and row-level security is the whole
  // authorisation model — a green pipeline that quietly ran none of them is worse
  // than a red one, because it reports the opposite of the truth.
  if (!available && process.env.CI) {
    throw new Error(
      `The row-level-security contract suite cannot run and this is CI. ${UNAVAILABLE_REASON}`,
    )
  }

  return available
}

export async function connect(): Promise<Client> {
  if (client) return client
  client = new Client({ connectionString: databaseUrl() })
  await client.connect()
  return client
}

export async function disconnect(): Promise<void> {
  if (!client) return
  await client.end()
  client = null
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

/**
 * Rebuilds the schema from the migrations and reapplies the seed.
 *
 * The migrations are executed as whole files rather than split into statements.
 * Splitting on semicolons would cut every plpgsql function body in half, and a
 * parser good enough to avoid that is a parser this suite would then also have
 * to trust.
 */
export async function resetDatabase(): Promise<void> {
  const pg = await connect()

  // `public` first: it holds the foreign keys into auth.users, so dropping it
  // lets the auth rows go without a cascade fight.
  await pg.query('drop schema if exists public cascade')
  await pg.query('create schema public')
  await pg.query('grant usage on schema public to postgres, anon, authenticated, service_role')
  await pg.query('delete from auth.users')

  for (const name of migrationFiles()) {
    await pg.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  }
  await pg.query(readFileSync(SEED_FILE, 'utf8'))
}

export interface RoleSession {
  /** Runs a query as the impersonated account. */
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>
  /** Runs a query expecting it to fail, and returns the error. */
  expectError(sql: string, params?: readonly unknown[]): Promise<Error>
}

/**
 * Runs `fn` as the given account, inside a transaction that is always rolled back.
 *
 * Rolling back rather than committing is what lets every scenario start from the
 * same seed without a full rebuild between them: a test that deletes a learner
 * cannot leak into the next one. Scenarios that must observe their own committed
 * effect use `asRoleCommitted` instead, and say why.
 */
export async function asRole<T>(
  userId: string | null,
  fn: (session: RoleSession) => Promise<T>,
  options: { origin?: string } = {},
): Promise<T> {
  const pg = await connect()
  await pg.query('begin')
  try {
    await applyRole(pg, userId, options.origin)
    return await fn(makeSession(pg))
  } finally {
    await pg.query('rollback')
  }
}

/**
 * As `asRole`, but commits. Needed where a definer function's effect must be
 * observable to a *later* session — the audit-log and delete-learner scenarios.
 * Callers are responsible for a `resetDatabase()` afterwards.
 */
export async function asRoleCommitted<T>(
  userId: string | null,
  fn: (session: RoleSession) => Promise<T>,
  options: { origin?: string } = {},
): Promise<T> {
  const pg = await connect()
  await pg.query('begin')
  try {
    await applyRole(pg, userId, options.origin)
    const result = await fn(makeSession(pg))
    await pg.query('commit')
    return result
  } catch (error) {
    await pg.query('rollback')
    throw error
  }
}

async function applyRole(pg: Client, userId: string | null, origin?: string): Promise<void> {
  // `anon` for an unauthenticated caller — which `redeem_invitation` must accept,
  // because the account being created does not exist yet (I5).
  const role = userId === null ? 'anon' : 'authenticated'

  const claims =
    userId === null
      ? JSON.stringify({ role: 'anon' })
      : JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' })

  await pg.query(`select set_config('request.jwt.claims', $1, true)`, [claims])

  // The forwarded address the I5 rate limit buckets on. Set explicitly so a test
  // can present itself as one origin or several.
  await pg.query(`select set_config('request.headers', $1, true)`, [
    JSON.stringify({ 'x-forwarded-for': origin ?? '203.0.113.1' }),
  ])

  await pg.query(`set local role ${role}`)
}

function makeSession(pg: Client): RoleSession {
  return {
    query: async <T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
      const result = await pg.query<T>(sql, params ? [...params] : undefined)
      return result.rows
    },
    expectError: async (sql: string, params?: readonly unknown[]) => {
      try {
        await pg.query(sql, params ? [...params] : undefined)
      } catch (error) {
        // A failed statement aborts the transaction, so the savepoint dance below
        // would be needed to continue. Callers that need to keep going open a new
        // `asRole` block instead, which is clearer than nesting savepoints.
        return error instanceof Error ? error : new Error(String(error))
      }
      throw new Error(`Expected the statement to be refused, but it succeeded: ${sql}`)
    },
  }
}

/** Runs a statement as the table owner, bypassing every policy. Setup only. */
export async function asOwner<T extends Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[],
): Promise<T[]> {
  const pg = await connect()
  const result = await pg.query<T>(sql, params ? [...params] : undefined)
  return result.rows
}
