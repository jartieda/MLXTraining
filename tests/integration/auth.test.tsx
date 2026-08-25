/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setupI18n } from '../helpers/render'
import { clientOf, createFakeSupabase, learnerProfile, type FakeSupabase } from '../helpers/supabase'

/**
 * T069 / US4 — FR-024, FR-025, FR-027.
 *
 * Three properties, in descending order of how badly a regression would hurt:
 *
 * 1. **No registration form is reachable without a code** (FR-024). This is the
 *    constitutional one. Principle I forbids an account nobody authorised, and the
 *    failure mode is not a bug that looks like a bug — a helpful "Create account"
 *    link added by a contributor who assumed the omission was an oversight looks
 *    like an improvement. So this is asserted as an absence across every route a
 *    visitor can reach, not just on the login page.
 * 2. **A username is never rendered to another learner** (FR-025). Enforced
 *    structurally too: `username` is absent from the `authenticated` grant, so a
 *    query for it fails. This test covers the other half — that the interface does
 *    not display one it happens to hold, such as the credential she just typed.
 * 3. **Redemption sets her own password and alias** (FR-027) and signs her in.
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
const { LoginPage } = await import('@/features/auth/LoginPage')
const { RedeemPage } = await import('@/features/auth/RedeemPage')

/** Every phrasing a self-service sign-up would plausibly use, in both locales. */
const SIGN_UP_WORDING =
  /sign\s?up|create (an )?account|register|join now|crear (una )?cuenta|registrar|reg[íi]strate|darse de alta/i

beforeEach(async () => {
  await setupI18n('en')
  fake = createFakeSupabase({ profiles: [learnerProfile({ id: 'learner-1', alias: 'Comet' })] })
  useSession.setState({ status: 'anonymous', account: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('sign-in (FR-024, R16)', () => {
  it('signs a learner in with her username, mapped to the synthetic identifier', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'learner-1')
    await user.type(screen.getByLabelText(/^password$/i), 'a-good-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(fake.signInWithPassword).toHaveBeenCalledWith({
        // R16: the reserved, permanently non-resolvable domain. If this ever
        // becomes a real domain, mail could be delivered to a child's namespace.
        email: 'learner-1@learner.invalid',
        password: 'a-good-password',
      })
    })

    await waitFor(() => {
      expect(useSession.getState().account?.alias).toBe('Comet')
    })
  })

  it('passes an educator email through unchanged, because a username has no @', async () => {
    const user = userEvent.setup()
    fake.tables.profiles.push(
      learnerProfile({ id: 'educator-1', alias: 'Ms Ruiz', role: 'educator', display_name: 'Ms Ruiz' }),
    )
    renderWithProviders(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'educator-1@school.example')
    await user.type(screen.getByLabelText(/^password$/i), 'a-good-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(fake.signInWithPassword).toHaveBeenCalledWith({
        email: 'educator-1@school.example',
        password: 'a-good-password',
      })
    })
  })

  it('gives one refusal for a wrong password and for a username that does not exist', async () => {
    const user = userEvent.setup()
    const refusals: string[] = []

    for (const credential of ['learner-1', 'no-such-learner']) {
      const view = renderWithProviders(<LoginPage />)
      fake.refuseSignIn(400)

      await user.type(screen.getByLabelText(/username/i), credential)
      await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      const alert = await screen.findByRole('alert')
      await waitFor(() => {
        expect(alert.textContent).not.toBe('')
      })
      refusals.push(alert.textContent ?? '')
      view.unmount()
    }

    // SC-020: an educator assigns usernames, so they are guessable by design. A
    // distinguishable "no such user" would turn that into an enumeration oracle.
    expect(refusals[0]).toBe(refusals[1])
    expect(refusals[0]).toMatch(/do not go together/i)
  })

  it('names a deactivated account rather than blaming her password (FR-054)', async () => {
    const user = userEvent.setup()
    fake.tables.profiles = [learnerProfile({ id: 'learner-1', is_active: false })]
    renderWithProviders(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'learner-1')
    await user.type(screen.getByLabelText(/^password$/i), 'a-good-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/switched off/i)).toBeInTheDocument()
    // And the session she briefly held is given back, not left half-open.
    await waitFor(() => {
      expect(fake.signOut).toHaveBeenCalled()
    })
    expect(useSession.getState().account).toBeNull()
  })

  it('tells a learner on a dropped connection that her local work is unaffected', async () => {
    const user = userEvent.setup()
    // A fetch that never arrived carries no HTTP status. Reporting it as a wrong
    // password sends her hunting for a mistake she did not make.
    fake.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Failed to fetch', name: 'AuthRetryableFetchError' },
    })
    renderWithProviders(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'learner-1')
    await user.type(screen.getByLabelText(/^password$/i), 'a-good-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/could not reach the account service/i)).toBeInTheDocument()
  })
})

describe('there is no registration path (FR-024)', () => {
  it('offers no sign-up anywhere on the login page, in either locale', async () => {
    for (const locale of ['en', 'es'] as const) {
      await setupI18n(locale)
      const view = renderWithProviders(<LoginPage />)

      // Read the whole rendered text, not just the links: a heading, a paragraph
      // or a button would each be just as much of a route in.
      const body = document.body.textContent ?? ''
      const offers = body
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => SIGN_UP_WORDING.test(sentence))
        // The page says in words that there IS no sign-up, and that sentence
        // necessarily contains the phrase. Excluding it by its negation keeps the
        // assertion about affordances rather than about vocabulary.
        .filter((sentence) => !/cannot|no sign-up|there is no|no puedes|aquí no hay/i.test(sentence))

      expect(offers, `an apparent sign-up affordance in ${locale}`).toEqual([])

      // Nor an interactive one, which is what a contributor would actually add.
      const controls = [
        ...screen.queryAllByRole('button'),
        ...screen.queryAllByRole('link'),
        ...screen.queryAllByRole('textbox'),
      ]
      expect(
        controls.filter((element) => SIGN_UP_WORDING.test(element.textContent ?? '')),
      ).toEqual([])

      view.unmount()
    }
    await setupI18n('en')
  })

  it('states plainly that an account starts with an invitation, and links to redemption', () => {
    renderWithProviders(<LoginPage />)

    expect(screen.getByText(/there is no sign-up here/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /invitation code/i })).toHaveAttribute('href', '/redeem')
  })

  it('the redemption screen cannot be completed without a code', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RedeemPage />)

    await user.type(screen.getByLabelText(/username/i), 'learner-new')
    await user.type(screen.getByLabelText(/choose a password/i), 'a-good-password')
    await user.type(screen.getByLabelText(/type your password again/i), 'a-good-password')
    await user.type(screen.getByLabelText(/display name/i), 'Willow')

    // Everything but the code. The account-creating call must be unreachable.
    expect(screen.getByRole('button', { name: /create my account/i })).toBeDisabled()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('a five-character code is not enough, so a partial guess cannot submit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RedeemPage />)

    await user.type(screen.getByLabelText(/username/i), 'learner-new')
    await user.type(screen.getByLabelText(/invitation code/i), 'SEEDB')
    await user.type(screen.getByLabelText(/choose a password/i), 'a-good-password')
    await user.type(screen.getByLabelText(/type your password again/i), 'a-good-password')
    await user.type(screen.getByLabelText(/display name/i), 'Willow')

    expect(screen.getByRole('button', { name: /create my account/i })).toBeDisabled()
  })
})

describe('redemption sets her own password and alias (FR-027)', () => {
  async function fillRedemption(user: ReturnType<typeof userEvent.setup>, code = 'SEEDB3') {
    await user.type(screen.getByLabelText(/username/i), 'learner-new')
    await user.type(screen.getByLabelText(/invitation code/i), code)
    await user.type(screen.getByLabelText(/choose a password/i), 'a-good-password')
    await user.type(screen.getByLabelText(/type your password again/i), 'a-good-password')
    await user.type(screen.getByLabelText(/display name/i), 'Willow')
  }

  it('calls redeem_invitation with the code, her password and her alias, then signs her in', async () => {
    const user = userEvent.setup()
    fake.tables.profiles.push(learnerProfile({ id: 'learner-new', alias: 'Willow' }))
    fake.acceptRpc('learner-new')

    renderWithProviders(<RedeemPage />)
    await fillRedemption(user)
    await user.click(screen.getByRole('button', { name: /create my account/i }))

    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalledWith('redeem_invitation', {
        code: 'SEEDB3',
        password: 'a-good-password',
        alias: 'Willow',
      })
    })

    // Scenario 4.1: usable immediately, which means signed in — and signed in by
    // the same password she just chose, never one an educator handed over.
    await waitFor(() => {
      expect(fake.signInWithPassword).toHaveBeenCalledWith({
        email: 'learner-new@learner.invalid',
        password: 'a-good-password',
      })
    })
    await waitFor(() => {
      expect(useSession.getState().account?.alias).toBe('Willow')
    })
  })

  it('never sends the username to the database, because the code identifies the account', async () => {
    const user = userEvent.setup()
    fake.tables.profiles.push(learnerProfile({ id: 'learner-new', alias: 'Willow' }))
    fake.acceptRpc('learner-new')

    renderWithProviders(<RedeemPage />)
    await fillRedemption(user)
    await user.click(screen.getByRole('button', { name: /create my account/i }))

    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalled()
    })
    // `redeem_invitation` treats its caller as hostile and re-derives everything
    // from the invitation the code names. A username argument would be a claim the
    // client could lie about.
    const args = fake.rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(Object.keys(args).sort()).toEqual(['alias', 'code', 'password'])
  })

  it('rejects a mistyped confirmation locally, without spending a rate-limited attempt', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RedeemPage />)

    await user.type(screen.getByLabelText(/username/i), 'learner-new')
    await user.type(screen.getByLabelText(/invitation code/i), 'SEEDB3')
    await user.type(screen.getByLabelText(/choose a password/i), 'a-good-password')
    await user.type(screen.getByLabelText(/type your password again/i), 'a-good-passwerd')
    await user.type(screen.getByLabelText(/display name/i), 'Willow')
    await user.click(screen.getByRole('button', { name: /create my account/i }))

    expect(await screen.findByText(/not the same/i)).toBeInTheDocument()
    // SC-020 gives her five attempts an hour. A typing slip must not cost one.
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('says the account exists when only the follow-up sign-in fails', async () => {
    const user = userEvent.setup()
    // Redemption succeeds; she mistyped the username, so the derived identifier
    // matches nothing. The code is single-use, so "try again" would strand her.
    fake.acceptRpc('learner-new')

    renderWithProviders(<RedeemPage />)
    await fillRedemption(user)
    await user.click(screen.getByRole('button', { name: /create my account/i }))

    expect(await screen.findByText(/your account is ready, but/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
  })
})

describe('a username is never rendered to another learner (FR-025)', () => {
  it('shows the alias, and no username, once she is signed in', async () => {
    const { AppShell } = await import('@/routes/AppShell')
    useSession.setState({
      status: 'signed-in',
      account: {
        id: 'learner-1',
        alias: 'Comet',
        role: 'learner',
        displayName: null,
        classroomId: 'classroom-1',
      },
    })

    renderWithProviders(<AppShell />)

    expect(screen.getByText('Comet')).toBeInTheDocument()
    // `Account` has no `username` field at all, and `fetchOwnProfile` does not ask
    // for the column — it is absent from the `authenticated` grant, so the query
    // would fail. This asserts the interface half: nothing leaks the credential
    // she typed either.
    expect(document.body.textContent).not.toMatch(/learner-1/)
  })

  it('offers a sign-out that clears the account rather than only the local view', async () => {
    const user = userEvent.setup()
    const { AppShell } = await import('@/routes/AppShell')
    useSession.setState({
      status: 'signed-in',
      account: {
        id: 'learner-1',
        alias: 'Comet',
        role: 'learner',
        displayName: null,
        classroomId: 'classroom-1',
      },
    })

    renderWithProviders(<AppShell />)
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => {
      expect(fake.signOut).toHaveBeenCalled()
    })
    expect(useSession.getState().status).toBe('anonymous')
  })
})
