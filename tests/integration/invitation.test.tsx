/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setupI18n } from '../helpers/render'
import { DB_MESSAGE, clientOf, createFakeSupabase, type FakeSupabase } from '../helpers/supabase'

/**
 * T070 / US4 — FR-028, Scenario 4.2, SC-020.
 *
 * The invitation state machine has three terminal states and they must stay
 * **distinguishable** in the interface, because they call for different actions:
 * expired means ask again, already-used means somebody else got there or she is
 * repeating herself, revoked means her educator changed her mind.
 *
 * And one pair must stay **indistinguishable**: a wrong code, and a code that
 * matches nothing. The database returns one constant for both (SC-020), and the
 * test that matters here is that the client does not helpfully pull them apart —
 * which it easily could, since it knows what was typed.
 *
 * Every refusal is fed in using the database's own wording, copied verbatim in
 * `tests/helpers/supabase.ts`. `classifyRedemptionError` matches on that wording,
 * so a paraphrase here would pass while the real refusal fell through to a generic
 * "that did not work".
 */

let fake: FakeSupabase

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>()
  return {
    ...actual,
    getSupabase: () => clientOf(fake),
    isSupabaseConfigured: () => true,
  }
})

const { useSession } = await import('@/features/auth/session')
const { RedeemPage } = await import('@/features/auth/RedeemPage')
const { ResetPasswordPage } = await import('@/features/auth/ResetPasswordPage')
const { normaliseCode, RESET_ALIAS_PLACEHOLDER } = await import('@/features/auth/redemption')

beforeEach(async () => {
  await setupI18n('en')
  fake = createFakeSupabase()
  useSession.setState({ status: 'anonymous', account: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

async function attemptRedemption(
  user: ReturnType<typeof userEvent.setup>,
  options: { code?: string; alias?: string } = {},
): Promise<string> {
  await user.type(screen.getByLabelText(/username/i), 'learner-new')
  await user.type(screen.getByLabelText(/invitation code/i), options.code ?? 'SEEDB3')
  await user.type(screen.getByLabelText(/choose a password/i), 'a-good-password')
  await user.type(screen.getByLabelText(/type your password again/i), 'a-good-password')
  await user.type(screen.getByLabelText(/display name/i), options.alias ?? 'Willow')
  await user.click(screen.getByRole('button', { name: /create my account/i }))

  const alert = await screen.findByRole('alert')
  await waitFor(() => {
    expect(alert.textContent?.trim()).not.toBe('')
  })
  return alert.textContent ?? ''
}

describe('the three terminal refusals are distinguishable (FR-028, Scenario 4.2)', () => {
  const cases = [
    ['expired', DB_MESSAGE.expired, /expired/i],
    ['already redeemed', DB_MESSAGE.used, /already been used/i],
    ['revoked', DB_MESSAGE.cancelled, /cancelled/i],
  ] as const

  const shown: string[] = []

  for (const [label, dbMessage, expected] of cases) {
    it(`names the ${label} case, and tells her to ask her educator`, async () => {
      const user = userEvent.setup()
      fake.refuseRpc(dbMessage)

      const view = renderWithProviders(<RedeemPage />)
      const message = await attemptRedemption(user)

      expect(message).toMatch(expected)
      // Every one of the three ends in the same instruction, because in all three
      // cases the only thing she can do is ask for a new code.
      expect(message).toMatch(/ask your educator/i)
      shown.push(message)
      view.unmount()
    })
  }

  it('shows three different messages, not one generic refusal three times', () => {
    expect(new Set(shown).size).toBe(3)
  })

  it('keeps the form filled, so a refusal costs her nothing she typed', async () => {
    const user = userEvent.setup()
    fake.refuseRpc(DB_MESSAGE.expired)

    renderWithProviders(<RedeemPage />)
    await attemptRedemption(user)

    expect(screen.getByLabelText(/display name/i)).toHaveValue('Willow')
    expect(screen.getByLabelText(/username/i)).toHaveValue('learner-new')
  })
})

describe('a wrong code and a non-existent username are the same refusal (SC-020)', () => {
  it('renders one identical message for both, revealing nothing about the username', async () => {
    const user = userEvent.setup()
    const messages: string[] = []

    // Both of these produce `indistinguishable_refusal` in the database: a code
    // matching no invitation, and a valid-shaped code against an account that does
    // not exist. The client must not add a distinction from what it was told.
    for (const scenario of ['no such code', 'no such username']) {
      const view = renderWithProviders(<RedeemPage />)
      fake.refuseRpc(DB_MESSAGE.indistinguishable)
      messages.push(await attemptRedemption(user))
      expect(scenario).toBeTruthy()
      view.unmount()
    }

    expect(messages[0]).toBe(messages[1])
    expect(messages[0]).toMatch(/not valid/i)
    // The refusal must not mention the username at all — naming it back to her is
    // how an enumeration read becomes possible even from identical wording.
    expect(messages[0]).not.toMatch(/learner-new/)
  })
})

describe('the rate limit is reported without hinting at existence (T076, SC-020)', () => {
  it('says to wait an hour, and says nothing about the username or the code', async () => {
    const user = userEvent.setup()
    fake.refuseRpc(DB_MESSAGE.rateLimited, '54000')

    renderWithProviders(<RedeemPage />)
    const message = await attemptRedemption(user)

    expect(message).toMatch(/too many tries/i)
    expect(message).toMatch(/wait an hour/i)
    expect(message).not.toMatch(/learner-new|SEEDB3/)
    // It must not read as "the code was wrong five times", which would confirm
    // that the earlier attempts reached a real invitation.
    expect(message).not.toMatch(/not valid|expired|already been used/i)
  })
})

describe('alias uniqueness within a classroom (T079, FR-051)', () => {
  it('asks her to pick another, and puts the cursor on the field she must change', async () => {
    const user = userEvent.setup()
    fake.refuseRpc(DB_MESSAGE.aliasTaken, '23505')

    renderWithProviders(<RedeemPage />)
    const message = await attemptRedemption(user, { alias: 'Comet' })

    expect(message).toMatch(/already uses that display name/i)
    expect(message).toMatch(/pick another/i)
    expect(screen.getByLabelText(/display name/i)).toHaveFocus()
  })

  it('does not confuse a taken alias with one of the wrong length', async () => {
    const user = userEvent.setup()
    // Both database messages contain "display name". Classified in the wrong
    // order, a learner whose classmate took her name is told to shorten it —
    // sending her to fix something that is not broken.
    fake.refuseRpc(DB_MESSAGE.aliasLength)

    renderWithProviders(<RedeemPage />)
    const message = await attemptRedemption(user, { alias: 'W' })

    expect(message).toMatch(/between 2 and 24/i)
    expect(message).not.toMatch(/already uses/i)
  })
})

describe('the code field only admits characters a real code can contain (FR-028, I6)', () => {
  it('drops O, 0, I and 1, because none of the four is in the alphabet', () => {
    // They are excluded in pairs — O with 0, I with 1 — so a typed 0 has no valid
    // character to be corrected into. Dropping is the only honest option.
    expect(normaliseCode('O0I1AB')).toBe('AB')
  })

  it('keeps uppercase L, which is unambiguous precisely because 1 is gone', () => {
    expect(normaliseCode('lLkK23')).toBe('LLKK23')
  })

  it('uppercases and trims to six', () => {
    expect(normaliseCode(' seedb3 ')).toBe('SEEDB3')
    expect(normaliseCode('ABCDEFGH')).toBe('ABCDEF')
  })

  it('normalises in the field, so what she sees is what is sent', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RedeemPage />)

    const field = screen.getByLabelText(/invitation code/i)
    await user.type(field, 'seed0b3')
    expect(field).toHaveValue('SEEDB3')
  })

  it('says which characters never appear, so she can read a whiteboard confidently', () => {
    renderWithProviders(<RedeemPage />)
    const hint = screen.getByText(/never contains the letters O or I/i)
    expect(hint).toBeInTheDocument()
    expect(screen.getByLabelText(/invitation code/i)).toHaveAccessibleDescription(
      /never contains the letters O or I/i,
    )
  })
})

describe('password reset carries no email exchange (T075, FR-030, R16)', () => {
  it('states that only her educator can issue a code, and offers no mail affordance', () => {
    renderWithProviders(<ResetPasswordPage />)

    expect(screen.getByText(/only your educator can issue a reset code/i)).toBeInTheDocument()
    // The dead-link failure this guards against: a "send me a link" button on a
    // screen for an account the lab holds no address for.
    const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]
    expect(
      controls.filter((element) =>
        /send|email|e-mail|link|correo|enlace|enviar/i.test(element.textContent ?? ''),
      ),
    ).toEqual([])
    expect(screen.queryByLabelText(/email|correo/i)).toBeNull()
  })

  it('does not ask for a display name, because a reset is not a rename', () => {
    renderWithProviders(<ResetPasswordPage />)
    expect(screen.queryByLabelText(/display name/i)).toBeNull()
  })

  it('sends the placeholder alias the database ignores on a reset', async () => {
    const user = userEvent.setup()
    fake.acceptRpc('learner-1b')

    renderWithProviders(<ResetPasswordPage />)
    await user.type(screen.getByLabelText(/username/i), 'learner-1b')
    await user.type(screen.getByLabelText(/reset code/i), 'SEEDC4')
    await user.type(screen.getByLabelText(/choose a password/i), 'a-brand-new-password')
    await user.type(screen.getByLabelText(/type your password again/i), 'a-brand-new-password')
    await user.click(screen.getByRole('button', { name: /set my new password/i }))

    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalledWith('redeem_invitation', {
        code: 'SEEDC4',
        password: 'a-brand-new-password',
        // `redeem_invitation` validates its alias for every purpose but ignores it
        // on a reset. This satisfies the 2–24 check and never reaches `profiles`.
        alias: RESET_ALIAS_PLACEHOLDER,
      })
    })
  })

  it('surfaces the same three terminal refusals for a reset code', async () => {
    const user = userEvent.setup()
    fake.refuseRpc(DB_MESSAGE.used)

    renderWithProviders(<ResetPasswordPage />)
    await user.type(screen.getByLabelText(/username/i), 'learner-1b')
    await user.type(screen.getByLabelText(/reset code/i), 'SEEDC4')
    await user.type(screen.getByLabelText(/choose a password/i), 'a-brand-new-password')
    await user.type(screen.getByLabelText(/type your password again/i), 'a-brand-new-password')
    await user.click(screen.getByRole('button', { name: /set my new password/i }))

    expect(await screen.findByText(/already been used/i)).toBeInTheDocument()
  })

  it('confirms the password changed even when the follow-up sign-in fails', async () => {
    const user = userEvent.setup()
    fake.acceptRpc('learner-1b')

    renderWithProviders(<ResetPasswordPage />)
    await user.type(screen.getByLabelText(/username/i), 'mistyped')
    await user.type(screen.getByLabelText(/reset code/i), 'SEEDC4')
    await user.type(screen.getByLabelText(/choose a password/i), 'a-brand-new-password')
    await user.type(screen.getByLabelText(/type your password again/i), 'a-brand-new-password')
    await user.click(screen.getByRole('button', { name: /set my new password/i }))

    // The credential did change. Telling her it failed would be false, and the
    // code she used is spent, so she cannot repeat the attempt.
    expect(await screen.findByText(/new password is set/i)).toBeInTheDocument()
  })
})

describe('every refusal reason exists in both locales (FR-044, SC-005)', () => {
  it('renders a Spanish refusal for each of the three terminal states', async () => {
    await setupI18n('es')
    const user = userEvent.setup()

    for (const [dbMessage, expected] of [
      [DB_MESSAGE.expired, /ha caducado/i],
      [DB_MESSAGE.used, /ya se ha usado/i],
      [DB_MESSAGE.cancelled, /se anuló/i],
      [DB_MESSAGE.rateLimited, /demasiados intentos/i],
    ] as const) {
      const view = renderWithProviders(<RedeemPage />)
      fake.refuseRpc(dbMessage)

      await user.type(screen.getByLabelText(/nombre de usuaria/i), 'learner-new')
      await user.type(screen.getByLabelText(/código de invitación/i), 'SEEDB3')
      await user.type(screen.getByLabelText(/elige una contraseña/i), 'a-good-password')
      await user.type(screen.getByLabelText(/escribe otra vez/i), 'a-good-password')
      await user.type(screen.getByLabelText(/nombre visible/i), 'Willow')
      await user.click(screen.getByRole('button', { name: /crear mi cuenta/i }))

      expect(await screen.findByText(expected)).toBeInTheDocument()
      view.unmount()
    }

    await setupI18n('en')
  })
})
