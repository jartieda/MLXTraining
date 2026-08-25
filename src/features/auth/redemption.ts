import { getSupabase, classifyRedemptionError, type RedemptionRefusal } from '@/lib/supabase'

/**
 * T074 / T075 — the client half of the invitation state machine.
 *
 * There is exactly one call here, `redeem_invitation`, and it is the only route by
 * which an account comes into existence (FR-024, G6). Redemption is callable with
 * no session because the account being created does not exist yet (I5), which is
 * why this module needs nothing from `session.ts` except what happens afterwards.
 *
 * Nothing in this file decides *why* a refusal happened. The database decides
 * that, and deliberately refuses to distinguish two of the cases — a wrong code
 * and a code matching nothing are byte-identical (SC-020). Re-deriving a reason
 * from the arguments here would invent the distinction the database went out of
 * its way to withhold.
 */

/** The 32 symbols a code is drawn from. Excludes O, 0, I and 1 (FR-028, I6). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

/**
 * Normalises what someone typed off a whiteboard.
 *
 * Uppercases, then drops anything outside the alphabet. Dropping rather than
 * substituting is the only honest option for the excluded characters: `O` and `0`
 * are *both* excluded, and so are `I` and `1`, so a typed `0` has no valid
 * counterpart to be corrected into. Lowercase `l` needs no special case — it
 * uppercases to `L`, which is in the alphabet and unambiguous precisely because
 * `1` is not.
 */
export function normaliseCode(raw: string): string {
  return [...raw.toUpperCase()]
    .filter((character) => CODE_ALPHABET.includes(character))
    .join('')
    .slice(0, CODE_LENGTH)
}

export function isCompleteCode(value: string): boolean {
  return normaliseCode(value).length === CODE_LENGTH
}

/**
 * The alias sent on a password reset.
 *
 * `redeem_invitation` validates its `alias` argument for every purpose but ignores
 * it on a reset — a reset is not an invitation to rename yourself, and her
 * classmates already know her by the name she has. So the reset form does not ask
 * for one, and this satisfies the signature's 2–24 character check without ever
 * being stored. It is not shown to anyone and never reaches `profiles`.
 */
export const RESET_ALIAS_PLACEHOLDER = 'reset'

export interface RedemptionSuccess {
  readonly ok: true
  readonly accountId: string
}

export interface RedemptionFailure {
  readonly ok: false
  readonly refusal: RedemptionRefusal
}

export type RedemptionOutcome = RedemptionSuccess | RedemptionFailure

export async function redeemInvitation(input: {
  readonly code: string
  readonly password: string
  readonly alias: string
}): Promise<RedemptionOutcome> {
  const supabase = await getSupabase()
  if (!supabase) return { ok: false, refusal: 'unconfigured' }

  const { data, error } = await supabase.rpc('redeem_invitation', {
    code: normaliseCode(input.code),
    password: input.password,
    alias: input.alias.trim(),
  })

  if (error) return { ok: false, refusal: classifyRedemptionError(error.message) }
  if (typeof data !== 'string' || data.length === 0) {
    return { ok: false, refusal: 'unknown' }
  }

  return { ok: true, accountId: data }
}
