import { Client } from 'pg'
import { CODE_ALPHABET } from '../../../src/features/auth/redemption'

/**
 * Account fixtures for the US4 end-to-end run.
 *
 * These tests need a real Supabase, because there is no other way to exercise the
 * thing under test: `redeem_invitation` is a `SECURITY DEFINER` function and the
 * invitation state machine lives entirely inside it (R15). A faked client would
 * assert that the interface renders whatever a fake was told to return, which
 * `tests/integration/invitation.test.tsx` already covers more cheaply.
 *
 * Invitations are inserted directly rather than issued through
 * `issue_learner_invitation`, for one reason: the issuing RPC returns the code
 * once and never again, and a test needs to *know* the code it is about to type.
 * The hash is computed by the database's own `hash_invitation_code`, so the row is
 * indistinguishable from an issued one.
 *
 * Every fixture takes a caller-supplied suffix and every username is unique per
 * test. `playwright.config.ts` sets `fullyParallel` across three projects, so
 * shared fixture rows would race — and a flaky auth suite is one that gets
 * disabled, which is worse than not having it.
 */

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Fixed ids from supabase/seed.sql. */
export const SEED = {
  admin: '00000000-0000-4000-a000-0000000000a1',
  /** An administrator signs in with an email address, like every adult (R16). */
  adminEmail: 'admin@example.org',
  adminDisplayName: 'Programme office',
  educator1: '00000000-0000-4000-a000-0000000000e1',
  educator1DisplayName: 'Ms Rivera',
  /** An educator signs in with the address she was invited by, not a username (R16). */
  educator1Email: 'educator1@example.org',
  classroom1: '00000000-0000-4000-b000-0000000000c1',
  classroom1Name: 'Year 9 — Wednesday',
  /** L1: username `learner-l1`, alias "Comet", enrolled in K1. */
  learner1Id: '00000000-0000-4000-a000-00000000001a',
  learner1Username: 'learner-l1',
  learner1Alias: 'Comet',
  password: 'labpassword',
} as const

export const UNAVAILABLE_REASON =
  'US4 needs a local Supabase and VITE_SUPABASE_URL baked into the build. Run ' +
  '`npx supabase start`, copy .env.example to .env.local with the printed anon key, ' +
  'then re-run. These scenarios are merge-blocking in CI — a local skip is not a pass.'

export function databaseUrl(): string {
  return process.env.SUPABASE_DB_URL ?? DEFAULT_DATABASE_URL
}

let reachable: boolean | null = null

/**
 * Whether the signed-in half of the suite can run at all.
 *
 * Both halves are required: Postgres for the fixtures, and a `VITE_SUPABASE_URL`
 * that was present when Vite built the bundle Playwright is serving. A build made
 * without it has no client at all — `getSupabase()` returns `null` — so the tests
 * would fail on a missing form rather than on the thing they assert.
 */
export async function accountsAvailable(): Promise<boolean> {
  if (reachable !== null) return reachable
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    reachable = false
    return false
  }
  try {
    const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 3000 })
    await client.connect()
    await client.end()
    reachable = true
  } catch {
    reachable = false
  }
  return reachable
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl() })
  await client.connect()
  try {
    const result = await client.query<T>(sql, [...values])
    return result.rows
  } finally {
    await client.end()
  }
}

/** Six characters from the same 32-symbol alphabet the database generates from. */
export function makeCode(): string {
  let code = ''
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

export type InvitationState = 'live' | 'expired' | 'revoked' | 'redeemed'

export interface Invitation {
  readonly username: string
  readonly code: string
}

/**
 * Creates a learner invitation into K1 in one of the four states.
 *
 * `redeemed` is produced by stamping `redeemed_at`, not by actually redeeming:
 * redeeming would create a real account and the test wants only the refusal.
 */
export async function seedInvitation(
  username: string,
  state: InvitationState = 'live',
): Promise<Invitation> {
  const code = makeCode()

  await query(
    `insert into public.invitations
       (issuer_id, kind, purpose, target, classroom_id, code_hash, expires_at,
        redeemed_at, revoked_at)
     values ($1, 'learner', 'initial', $2, $3, public.hash_invitation_code($4),
             case when $5 = 'expired' then now() - interval '1 hour'
                  else now() + interval '72 hours' end,
             case when $5 = 'redeemed' then now() else null end,
             case when $5 = 'revoked'  then now() else null end)`,
    [SEED.educator1, username, SEED.classroom1, code, state],
  )

  return { username, code }
}

/** A password-reset invitation against an account that already exists. */
export async function seedResetCode(username: string): Promise<Invitation> {
  const code = makeCode()
  await query(
    `insert into public.invitations
       (issuer_id, kind, purpose, target, classroom_id, code_hash, expires_at)
     values ($1, 'learner', 'password_reset', $2, $3,
             public.hash_invitation_code($4), now() + interval '72 hours')`,
    [SEED.educator1, username, SEED.classroom1, code],
  )
  return { username, code }
}

/**
 * Clears the rate-limit ledger for every origin.
 *
 * Five failed attempts an hour is shared across a whole test file, since a local
 * run has one origin. Without this, the sixth deliberate refusal in the suite
 * starts failing on rate-limit grounds and the failure names the wrong cause.
 */
export async function clearRateLimit(): Promise<void> {
  await query(`delete from public.redemption_attempts`)
}

/** Removes an account and everything referencing it, so a re-run starts clean. */
export async function removeAccount(username: string): Promise<void> {
  await query(
    `do $$
     declare victim uuid;
     begin
       select id into victim from public.profiles where lower(username) = lower($1);
       if victim is not null then
         delete from public.reflections where learner_id = victim;
         delete from public.lesson_progress where learner_id = victim;
         delete from public.training_runs where project_id in
           (select id from public.projects where owner_id = victim);
         delete from public.projects where owner_id = victim;
         delete from public.enrolments where learner_id = victim;
         delete from public.profiles where id = victim;
         delete from auth.users where id = victim;
       end if;
       delete from public.invitations where lower(target) = lower($1);
     end $$;`,
    [username],
  )
}

export async function countRowsOwnedBy(ownerId: string): Promise<number> {
  const rows = await query<{ total: string }>(
    `select (select count(*) from public.projects where owner_id = $1)
          + (select count(*) from public.training_runs tr
               join public.projects p on p.id = tr.project_id where p.owner_id = $1)
       as total`,
    [ownerId],
  )
  return Number(rows[0]?.total ?? 0)
}

/** Every remote row that exists at all, for the anonymous-session assertion. */
export async function remoteRowTotals(): Promise<Record<string, number>> {
  const rows = await query<Record<string, string>>(
    `select (select count(*) from public.profiles)       as profiles,
            (select count(*) from public.projects)       as projects,
            (select count(*) from public.training_runs)  as training_runs,
            (select count(*) from public.lesson_progress) as lesson_progress,
            (select count(*) from public.reflections)    as reflections`,
  )
  const row = rows[0] ?? {}
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]))
}
