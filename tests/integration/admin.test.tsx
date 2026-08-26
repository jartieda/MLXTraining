/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setupI18n } from '../helpers/render'
import { clientOf, createFakeSupabase, type FakeSupabase } from '../helpers/supabase'

/**
 * T128 / US9 — FR-053, FR-054, FR-056, FR-057.
 *
 * Two properties carry this file.
 *
 * **The lab sends no email** (FR-053). The handover is a `mailto:` opening the
 * administrator's own client, and the test asserts both halves: the link is built
 * correctly, and there is no control anywhere that would make the application send
 * something itself. That absence is what lets this project hold no mail credentials.
 *
 * **The last-administrator refusal comes from the database** (FR-056). The button is
 * offered, the attempt is made, and the refusal is surfaced — rather than being
 * pre-empted by a disabled control. A client-side guard would be removable, and the
 * cost of getting it wrong is a program locked out of its own administration with no
 * remedy but a migration.
 */

let fake: FakeSupabase

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>()
  return { ...actual, getSupabase: () => clientOf(fake), isSupabaseConfigured: () => true }
})

const { useSession } = await import('@/features/auth/session')
const { AdminPage } = await import('@/features/admin/AdminPage')
const { invitationState, handoverMailto } = await import('@/features/admin/api')

const ADMIN = {
  id: 'admin-1',
  alias: 'A1',
  role: 'administrator' as const,
  displayName: 'Program office',
  classroomId: null,
}

const IN_72_HOURS = new Date(Date.now() + 72 * 3600_000).toISOString()

function educatorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'educator-1',
    alias: 'Ms Ruiz',
    role: 'educator' as const,
    display_name: 'Ms Ruiz',
    is_active: true,
    locale: 'en' as const,
    classroom_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(async () => {
  await setupI18n('en')
  fake = createFakeSupabase()
  useSession.setState({ status: 'signed-in', account: ADMIN })
})

afterEach(() => {
  vi.clearAllMocks()
})

async function settled() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
}

describe('inviting an educator (FR-053)', () => {
  it('shows the code once and offers a mailto plus a copy fallback', async () => {
    const user = userEvent.setup()
    fake.rpc.mockResolvedValueOnce({ data: 'SEEDA2', error: null })
    renderWithProviders(<AdminPage />)
    await settled()

    await user.type(await screen.findByLabelText(/educator's email/i), 'new@school.example')
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))

    const issued = await screen.findByTestId('educator-invitation-issued')
    expect(within(issued).getByTestId('educator-code')).toHaveTextContent('SEEDA2')
    expect(issued).toHaveTextContent(/only time you will see the code/i)

    expect(fake.rpc).toHaveBeenCalledWith('issue_educator_invitation', {
      email: 'new@school.example',
    })

    // The primary handover, and the fallback beside it rather than behind a failure:
    // a school Chromebook often has no mail client and `mailto:` then does nothing
    // at all, silently.
    const mail = within(issued).getByTestId('handover-mailto')
    expect(mail).toHaveAttribute('href', expect.stringContaining('mailto:new%40school.example'))
    expect(mail.getAttribute('href')).toContain('SEEDA2')
    expect(within(issued).getByRole('button', { name: /copy the message/i })).toBeInTheDocument()
  })

  it('says the lab itself sends nothing', async () => {
    const user = userEvent.setup()
    fake.rpc.mockResolvedValueOnce({ data: 'SEEDA2', error: null })
    renderWithProviders(<AdminPage />)
    await settled()

    await user.type(await screen.findByLabelText(/educator's email/i), 'new@school.example')
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))

    const issued = await screen.findByTestId('educator-invitation-issued')
    // "Open my mail app" reads to most people as "the app is emailing her". It is
    // not, and the difference is why this project holds no mail credentials.
    expect(issued).toHaveTextContent(/lab sends no email itself/i)
    expect(issued).toHaveTextContent(/you press send, from your own address/i)
    // And the explicit fallback advice, because a silent no-op is the failure mode.
    expect(issued).toHaveTextContent(/if nothing opens/i)
  })

  it('has no control that would make the application send the mail', async () => {
    const user = userEvent.setup()
    fake.rpc.mockResolvedValueOnce({ data: 'SEEDA2', error: null })
    renderWithProviders(<AdminPage />)
    await settled()

    await user.type(await screen.findByLabelText(/educator's email/i), 'new@school.example')
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))
    await screen.findByTestId('educator-invitation-issued')

    // A "Send invitation" button is the obvious helpful addition, and it would
    // require SMTP credentials, a queue and bounce handling — a permanent
    // operational obligation this design exists to avoid.
    const sendish = screen
      .queryAllByRole('button')
      .filter((element) => /^send|send it|send invitation/i.test(element.textContent ?? ''))
    expect(sendish).toEqual([])
  })

  it('refuses a malformed address with the database’s own reason', async () => {
    const user = userEvent.setup()
    fake.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'That does not look like an email address.', code: '22023' },
    })
    renderWithProviders(<AdminPage />)
    await settled()

    await user.type(await screen.findByLabelText(/educator's email/i), 'not@anaddress')
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))

    expect(await screen.findByText(/does not look like an email address/i)).toBeInTheDocument()
  })

  it('builds a mailto that encodes the subject and body', () => {
    const url = handoverMailto('a b@school.example', 'Sub ject', 'Line one\nLine two')
    expect(url.startsWith('mailto:a%20b%40school.example?')).toBe(true)
    expect(url).toContain('subject=Sub%20ject')
    // A raw newline in a mailto body is what breaks the link in several clients.
    expect(url).toContain('Line%20one%0ALine%20two')
  })
})

describe('the educator list and invitation states (FR-054)', () => {
  it('lists educators with their active state, by display name', async () => {
    fake.tables.profiles = [
      educatorRow(),
      educatorRow({ id: 'educator-2', display_name: 'Mr Adeyemi', is_active: false }),
    ]
    renderWithProviders(<AdminPage />)
    await settled()

    expect(await screen.findByTestId('educator-educator-1')).toHaveTextContent(/Ms Ruiz/)
    expect(screen.getByTestId('educator-educator-1')).toHaveTextContent(/Active/i)
    expect(screen.getByTestId('educator-educator-2')).toHaveTextContent(/Switched off/i)
    // An inactive account offers no action: the lab has no reactivation path.
    expect(
      within(screen.getByTestId('educator-educator-2')).queryByRole('button'),
    ).toBeNull()
  })

  it('shows an email address only against an invitation, never on the educator list', async () => {
    fake.tables.profiles = [educatorRow()]
    fake.tables.invitations = [
      {
        id: 'inv-1',
        issuer_id: 'admin-1',
        classroom_id: null,
        target: 'ruiz@school.example',
        purpose: 'initial',
        expires_at: IN_72_HOURS,
        redeemed_at: '2026-01-02T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    renderWithProviders(<AdminPage />)
    await settled()

    // The address is the one personal datum this system holds. It identifies the
    // invitation, so it belongs there — and a roster she screen-shares is not the
    // place for it.
    const list = await screen.findByTestId('educator-educator-1')
    expect(list).not.toHaveTextContent(/ruiz@school.example/)
    expect(screen.getByTestId('admin-invitation-inv-1')).toHaveTextContent('ruiz@school.example')
  })

  it('offers revoke only for a live invitation', async () => {
    fake.tables.invitations = [
      {
        id: 'inv-live',
        issuer_id: 'admin-1',
        classroom_id: null,
        target: 'live@school.example',
        purpose: 'initial',
        expires_at: IN_72_HOURS,
        redeemed_at: null,
        revoked_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'inv-used',
        issuer_id: 'admin-1',
        classroom_id: null,
        target: 'used@school.example',
        purpose: 'initial',
        expires_at: IN_72_HOURS,
        redeemed_at: '2026-01-02T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    renderWithProviders(<AdminPage />)
    await settled()

    expect(await screen.findByTestId('admin-invitation-state-inv-live')).toHaveTextContent(
      /waiting to be used/i,
    )
    expect(
      within(screen.getByTestId('admin-invitation-inv-live')).getByRole('button', {
        name: /cancel it/i,
      }),
    ).toBeInTheDocument()
    // An account that exists cannot be un-created, and `revoke_invitation` refuses
    // it — so offering the button would be offering a failure.
    expect(
      within(screen.getByTestId('admin-invitation-inv-used')).queryByRole('button', {
        name: /cancel it/i,
      }),
    ).toBeNull()
  })

  it('revokes through the RPC', async () => {
    const user = userEvent.setup()
    fake.tables.invitations = [
      {
        id: 'inv-live',
        issuer_id: 'admin-1',
        classroom_id: null,
        target: 'live@school.example',
        purpose: 'initial',
        expires_at: IN_72_HOURS,
        redeemed_at: null,
        revoked_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    renderWithProviders(<AdminPage />)
    await settled()

    await user.click(await screen.findByRole('button', { name: /cancel it/i }))
    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalledWith('revoke_invitation', { id: 'inv-live' })
    })
  })

  it('treats redemption as winning over expiry', () => {
    const base = {
      id: 'i',
      target: 'a@b.example',
      purpose: 'initial' as const,
      createdAt: '',
      expiresAt: '2020-01-01T00:00:00.000Z',
      redeemedAt: '2019-12-31T00:00:00.000Z',
      revokedAt: null,
    }
    // Telling her "expired" would send her to reissue an invitation for an educator
    // who already has an account.
    expect(invitationState(base)).toBe('redeemed')
  })
})

describe('deactivation, and the last-administrator refusal (FR-054, FR-056)', () => {
  it('states that her classrooms and her learners’ work survive', async () => {
    const user = userEvent.setup()
    fake.tables.profiles = [educatorRow()]
    renderWithProviders(<AdminPage />)
    await settled()

    await user.click(await screen.findByRole('button', { name: /^switch off$/i }))

    const dialog = await screen.findByRole('dialog')
    // Without this an administrator reasonably fears she is deleting a term's work.
    expect(dialog).toHaveTextContent(/classrooms and everything her learners have made stay/i)
    // And the consequence she must act on: move the classrooms first, or the group
    // has no adult who can see their progress.
    expect(dialog).toHaveTextContent(/move her classrooms to another educator first/i)
  })

  it('surfaces the database’s refusal rather than pre-empting it', async () => {
    const user = userEvent.setup()
    fake.tables.profiles = [
      educatorRow({ id: 'admin-1', display_name: 'Program office', role: 'administrator' }),
    ]
    renderWithProviders(<AdminPage />)
    await settled()

    // The control is offered even for her own account: the refusal is the database's
    // and a client-side guard would be removable. Being told the rule is also how an
    // administrator learns it exists.
    await user.click(await screen.findByRole('button', { name: /switch off my own account/i }))

    fake.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Cannot deactivate the last remaining active administrator.',
        code: '23514',
      },
    })
    await user.click(screen.getByRole('button', { name: /^switch it off$/i }))

    const failure = await screen.findByTestId('deactivate-failure')
    expect(failure).toHaveTextContent(/you are the last administrator/i)
    expect(failure).toHaveTextContent(/nobody left to run it/i)
    expect(fake.rpc).toHaveBeenCalledWith('deactivate_educator', { id: 'admin-1' })
  })

  it('calls the RPC and reloads on success', async () => {
    const user = userEvent.setup()
    fake.tables.profiles = [educatorRow()]
    renderWithProviders(<AdminPage />)
    await settled()

    await user.click(await screen.findByRole('button', { name: /^switch off$/i }))
    fake.rpc.mockResolvedValueOnce({ data: null, error: null })
    await user.click(screen.getByRole('button', { name: /^switch it off$/i }))

    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalledWith('deactivate_educator', { id: 'educator-1' })
    })
  })
})

describe('reassigning a classroom (FR-057, K6)', () => {
  beforeEach(() => {
    fake.tables.profiles = [
      educatorRow(),
      educatorRow({ id: 'educator-2', display_name: 'Mr Adeyemi' }),
      educatorRow({ id: 'educator-3', display_name: 'Off', is_active: false }),
    ]
    fake.tables.admin_classrooms = [
      { id: 'classroom-1', name: 'Year 9 — Wednesday', educator_id: 'educator-1' },
    ]
  })

  it('shows a name and an owner, and nothing about any learner', async () => {
    renderWithProviders(<AdminPage />)
    await settled()

    const card = await screen.findByTestId('admin-classroom-classroom-1')
    expect(card).toHaveTextContent('Year 9 — Wednesday')
    expect(card).toHaveTextContent(/currently with Ms Ruiz/i)
    // Not even a learner count: a count is a fact about learners, and the least she
    // needs for this job is which classroom and whose (FR-055).
    expect(card).not.toHaveTextContent(/\d+ learners?|\d+ alumnas?/i)
  })

  it('offers no rename, archive or delete (K6)', async () => {
    renderWithProviders(<AdminPage />)
    await settled()

    const card = await screen.findByTestId('admin-classroom-classroom-1')
    const controls = [
      ...within(card).queryAllByRole('button'),
      ...within(card).queryAllByRole('link'),
    ]
    expect(
      controls.filter((element) =>
        /rename|archive|delete|open|renombrar|archivar|borrar|abrir/i.test(element.textContent ?? ''),
      ),
    ).toEqual([])
  })

  it('says plainly that she cannot open a classroom (FR-055)', async () => {
    renderWithProviders(<AdminPage />)
    await settled()
    // An administrator looking at a list of classrooms will reasonably wonder why she
    // cannot open one; telling her it is deliberate is what stops it being filed as a
    // bug and "fixed".
    expect(await screen.findByTestId('admin-cannot-open')).toHaveTextContent(
      /cannot open a classroom/i,
    )
  })

  it('offers only active educators, and not the current owner', async () => {
    renderWithProviders(<AdminPage />)
    await settled()

    const select = await screen.findByLabelText(/move it to/i)
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).toContain('Mr Adeyemi')
    // `reassign_classroom` refuses an inactive account and refuses a no-op move, so
    // offering either would be offering a failure.
    expect(options).not.toContain('Off')
    expect(options).not.toContain('Ms Ruiz')
  })

  it('moves it through the RPC', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminPage />)
    await settled()

    await user.selectOptions(await screen.findByLabelText(/move it to/i), 'educator-2')
    fake.rpc.mockResolvedValueOnce({ data: null, error: null })
    await user.click(screen.getByRole('button', { name: /^move it$/i }))

    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalledWith('reassign_classroom', {
        classroom: 'classroom-1',
        to_educator: 'educator-2',
      })
    })
  })
})

describe('the page states its own limits (FR-055, FR-056, SC-018)', () => {
  it('says what it cannot reach, and that no administrator can be created', async () => {
    renderWithProviders(<AdminPage />)
    await settled()

    const note = await screen.findByTestId('admin-scope-note')
    expect(note).toHaveTextContent(/no learner account, project, figure, answer or photo/i)
    // The reason matters as much as the fact: not hidden, but ungranted.
    expect(note).toHaveTextContent(/the database grants you no access/i)
    expect(note).toHaveTextContent(/no way to create another administrator/i)
  })

  it('offers no search, no learner list and no export', async () => {
    fake.tables.profiles = [educatorRow()]
    renderWithProviders(<AdminPage />)
    await settled()

    // The three shapes a route into classroom content would take.
    expect(screen.queryByRole('searchbox')).toBeNull()
    const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]
    expect(
      controls.filter((element) =>
        /export|learner|reflection|progress|exportar|alumna/i.test(element.textContent ?? ''),
      ),
    ).toEqual([])
  })

  it('refuses the page to an educator', async () => {
    useSession.setState({
      status: 'signed-in',
      account: { ...ADMIN, role: 'educator', id: 'educator-1' },
    })
    renderWithProviders(<AdminPage />)
    expect(await screen.findByText(/not for your account/i)).toBeInTheDocument()
  })
})
