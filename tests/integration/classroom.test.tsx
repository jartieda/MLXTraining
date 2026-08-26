/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setupI18n } from '../helpers/render'
import { clientOf, createFakeSupabase, type FakeSupabase } from '../helpers/supabase'

/**
 * T102 / US6 — FR-026, FR-038, FR-039, FR-052, K4, Scenario 6.1–6.7.
 *
 * Four properties, and they are not equally important.
 *
 * The one that matters most is that **removing a learner and deleting her account are
 * visibly different actions**. An educator tidying a roster at the end of term is one
 * mis-click from destroying a term's work, and the only defence is that the two say
 * different things and that the destructive one names what it destroys.
 *
 * Then: **the invitation code is shown once and cannot be shown again** (FR-026,
 * R15) — asserted as the absence of any affordance to re-display it, because the
 * tempting "helpful" addition is a "show code" button on the pending list, and only
 * the hash exists to show.
 *
 * Then **no username on the enrolled roster** (FR-025), and **no email option
 * anywhere** (FR-026, R16).
 */

let fake: FakeSupabase

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>()
  return { ...actual, getSupabase: () => clientOf(fake), isSupabaseConfigured: () => true }
})

const { useSession } = await import('@/features/auth/session')
const { ClassroomPage } = await import('@/features/classroom/ClassroomPage')
const { invitationState } = await import('@/features/classroom/api')
const { loadLessonNamespace } = await import('@/lib/i18n')

const EDUCATOR = {
  id: 'educator-1',
  alias: 'Ms Ruiz',
  role: 'educator' as const,
  displayName: 'Ms Ruiz',
  classroomId: null,
}

const CLASSROOM = {
  id: 'classroom-1',
  name: 'Tuesday club',
  educator_id: 'educator-1',
  archived_at: null,
  created_at: '2026-01-01T09:00:00.000Z',
}

const IN_72_HOURS = new Date(Date.now() + 72 * 3600_000).toISOString()

beforeEach(async () => {
  await setupI18n('en')
  await loadLessonNamespace()
  fake = createFakeSupabase()
  useSession.setState({ status: 'signed-in', account: EDUCATOR })
})

afterEach(() => {
  vi.clearAllMocks()
})

/** Waits past the first render's reads so assertions do not race the fetches. */
async function settled() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
}

describe('creating, renaming and archiving a classroom (FR-038, Scenario 6.1)', () => {
  it('offers the name field first on an empty account (SC-013)', async () => {
    renderWithProviders(<ClassroomPage />)
    await settled()

    // SC-013 budgets three minutes from nothing to a usable classroom with its first
    // invitation. There is no wizard and no settings route: this is step one of two.
    expect(await screen.findByLabelText(/classroom name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create the classroom/i })).toBeInTheDocument()
  })

  it('creates one and then immediately offers the invitation panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ClassroomPage />)
    await settled()

    await user.type(await screen.findByLabelText(/classroom name/i), 'Tuesday club')
    // The id is generated on the client (so the row can be selected before the read
    // round-trips), so it is pinned here and the fake's table seeded to match — the
    // alternative is a fake that reimplements INSERT defaults.
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(CLASSROOM.id as `${string}-${string}-${string}-${string}-${string}`)
    fake.tables.classrooms = [CLASSROOM]
    await user.click(screen.getByRole('button', { name: /create the classroom/i }))

    // Step two, on the same screen. This adjacency is the whole of SC-013.
    expect(await screen.findByRole('heading', { name: /invite a learner/i })).toBeInTheDocument()
    const written = (fake.upserted.classrooms ?? [])[0] as Record<string, unknown>
    expect(written).toMatchObject({ name: 'Tuesday club', educator_id: 'educator-1' })
  })

  it('renames it', async () => {
    const user = userEvent.setup()
    fake.tables.classrooms = [CLASSROOM]
    renderWithProviders(<ClassroomPage />)
    await settled()

    await user.click(await screen.findByRole('button', { name: /^rename$/i }))
    const field = screen.getByLabelText(/new name/i)
    await user.clear(field)
    await user.type(field, 'Wednesday club')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(fake.updated.classrooms?.at(-1)).toMatchObject({ name: 'Wednesday club' })
    })
  })

  it('archives it, and says archiving costs a learner nothing', async () => {
    const user = userEvent.setup()
    fake.tables.classrooms = [CLASSROOM]
    renderWithProviders(<ClassroomPage />)
    await settled()

    await user.click(await screen.findByRole('button', { name: /^archive$/i }))
    await waitFor(() => {
      // The timestamp itself is the client's `now()`, so only its presence and type
      // are asserted — the value is not the property under test.
      const written = fake.updated.classrooms?.at(-1) as { archived_at?: unknown } | undefined
      expect(typeof written?.archived_at).toBe('string')
    })
  })

  it('an archived classroom issues no invitations, rather than offering and refusing', async () => {
    fake.tables.classrooms = [{ ...CLASSROOM, archived_at: '2026-02-01T00:00:00.000Z' }]
    renderWithProviders(<ClassroomPage />)
    await settled()

    // `issue_learner_invitation` requires `archived_at is null`, so the panel is
    // hidden rather than shown and then rejected.
    expect(await screen.findByTestId('archived-badge')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /invite a learner/i })).toBeNull()
    expect(screen.getByText(/out of the way, not gone/i)).toBeInTheDocument()
  })

  it('refuses the page to an account that is not an educator (K4)', async () => {
    useSession.setState({
      status: 'signed-in',
      account: { ...EDUCATOR, role: 'learner', displayName: null },
    })
    renderWithProviders(<ClassroomPage />)
    // Not a redirect: a learner who followed a link deserves an answer rather than
    // being bounced somewhere she did not ask to go.
    expect(await screen.findByText(/not for your account/i)).toBeInTheDocument()
  })
})

describe('issuing an invitation (FR-026, FR-028, Scenario 6.2)', () => {
  beforeEach(() => {
    fake.tables.classrooms = [CLASSROOM]
  })

  it('shows the username and the code together, and says it is the only time', async () => {
    const user = userEvent.setup()
    fake.rpc.mockResolvedValueOnce({ data: 'SEEDB3', error: null })
    renderWithProviders(<ClassroomPage />)
    await settled()

    await user.type(await screen.findByLabelText(/^username$/i), 'zz-issued-username')
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))

    const issued = await screen.findByTestId('invitation-issued')
    expect(within(issued).getByTestId('issued-username')).toHaveTextContent('zz-issued-username')
    expect(within(issued).getByTestId('issued-code')).toHaveTextContent('SEEDB3')
    // Said before the code, because afterwards is where she has stopped reading.
    expect(issued).toHaveTextContent(/only time you will see the code/i)
    expect(issued).toHaveTextContent(/cannot be looked up again/i)

    expect(fake.rpc).toHaveBeenCalledWith('issue_learner_invitation', {
      classroom: 'classroom-1',
      username: 'zz-issued-username',
    })
  })

  it('offers no way to email it, and no way to see it again (FR-026, R16)', async () => {
    const user = userEvent.setup()
    fake.rpc.mockResolvedValueOnce({ data: 'SEEDB3', error: null })
    renderWithProviders(<ClassroomPage />)
    await settled()

    await user.type(await screen.findByLabelText(/^username$/i), 'zz-issued-username')
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))
    await screen.findByTestId('invitation-issued')

    // The tempting additions this guards against: a "send it" button, which implies
    // a channel that does not exist, and a "show code" button, for which only a hash
    // exists.
    const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]
    expect(
      controls.filter((element) => /email|e-mail|send|correo|enviar/i.test(element.textContent ?? '')),
    ).toEqual([])
    expect(
      controls.filter((element) => /show.*code|reveal|ver.*código/i.test(element.textContent ?? '')),
    ).toEqual([])
    expect(screen.getByText(/hand it over in person/i)).toBeInTheDocument()
  })

  it('distinguishes a taken username from an unredeemed invitation for it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ClassroomPage />)
    await settled()

    // Two refusals with different remedies: pick another name, versus revoke the one
    // you already made. Collapsing them sends her to the wrong action half the time.
    fake.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'That username is already taken. Choose another.', code: '23505' },
    })
    await user.type(await screen.findByLabelText(/^username$/i), 'zz-issued-username')
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))
    expect(await screen.findByText(/already belongs to an account/i)).toBeInTheDocument()

    fake.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'An unredeemed invitation for that username already exists. Revoke it first.',
        code: '23505',
      },
    })
    await user.click(screen.getByRole('button', { name: /make an invitation/i }))
    expect(await screen.findByText(/already an unused invitation/i)).toBeInTheDocument()
  })

  it('lists a pending invitation with its state, and offers to revoke only a live one', async () => {
    fake.tables.invitations = [
      {
        id: 'inv-live',
        issuer_id: 'educator-1',
        classroom_id: 'classroom-1',
        target: 'zz-issued-username',
        purpose: 'initial',
        expires_at: IN_72_HOURS,
        redeemed_at: null,
        revoked_at: null,
        created_at: '2026-01-01T10:00:00.000Z',
      },
      {
        id: 'inv-used',
        issuer_id: 'educator-1',
        classroom_id: 'classroom-1',
        target: 'ana-b2',
        purpose: 'initial',
        expires_at: IN_72_HOURS,
        redeemed_at: '2026-01-02T10:00:00.000Z',
        revoked_at: null,
        created_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    renderWithProviders(<ClassroomPage />)
    await settled()

    expect(await screen.findByTestId('invitation-state-inv-live')).toHaveTextContent(
      /waiting to be used/i,
    )
    expect(screen.getByTestId('invitation-state-inv-used')).toHaveTextContent(/used/i)

    // `revoke_invitation` refuses an already-redeemed one — the account exists and
    // cannot be un-created — so offering the button would be offering a failure.
    expect(
      within(screen.getByTestId('invitation-inv-live')).getByRole('button', { name: /cancel it/i }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('invitation-inv-used')).queryByRole('button', { name: /cancel it/i }),
    ).toBeNull()
  })

  it('revokes a live invitation through the RPC', async () => {
    const user = userEvent.setup()
    fake.tables.invitations = [
      {
        id: 'inv-live',
        issuer_id: 'educator-1',
        classroom_id: 'classroom-1',
        target: 'zz-issued-username',
        purpose: 'initial',
        expires_at: IN_72_HOURS,
        redeemed_at: null,
        revoked_at: null,
        created_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    renderWithProviders(<ClassroomPage />)
    await settled()

    await user.click(await screen.findByRole('button', { name: /cancel it/i }))
    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalledWith('revoke_invitation', { id: 'inv-live' })
    })
  })

  it('derives the four states rather than storing them', () => {
    const base = {
      id: 'i',
      target: 'u',
      purpose: 'initial' as const,
      createdAt: '',
      expiresAt: IN_72_HOURS,
      redeemedAt: null,
      revokedAt: null,
    }
    expect(invitationState(base)).toBe('live')
    expect(invitationState({ ...base, redeemedAt: '2026-01-01T00:00:00.000Z' })).toBe('redeemed')
    expect(invitationState({ ...base, revokedAt: '2026-01-01T00:00:00.000Z' })).toBe('revoked')
    expect(invitationState({ ...base, expiresAt: '2020-01-01T00:00:00.000Z' })).toBe('expired')
    // Redemption wins over expiry: an account that exists is not "expired".
    expect(
      invitationState({
        ...base,
        expiresAt: '2020-01-01T00:00:00.000Z',
        redeemedAt: '2019-12-31T00:00:00.000Z',
      }),
    ).toBe('redeemed')
  })
})

describe('the roster shows aliases, never usernames (FR-025, FR-040)', () => {
  beforeEach(() => {
    fake.tables.classrooms = [CLASSROOM]
    fake.tables.educator_roster = [
      {
        id: 'learner-1',
        username: 'zz-issued-username',
        alias: 'Comet',
        role: 'learner',
        is_active: true,
        classroom_id: 'classroom-1',
      },
    ]
  })

  it('renders the alias and not the username, even though the view exposes both', async () => {
    renderWithProviders(<ClassroomPage />)
    await settled()

    expect(await screen.findByText('Comet')).toBeInTheDocument()
    // `educator_roster` is the one relation through which a username is readable
    // (P3), and `listRoster` deliberately does not select the column. FR-025's rule
    // is easiest to keep when it is never asked for.
    //
    // The fixture username is deliberately unlike anything in the interface's own
    // copy: an earlier version used "maria-t9", which is the example in the username
    // hint, so the assertion matched our own help text instead of a leak.
    expect(document.body.textContent).not.toContain('zz-issued-username')
  })

  it('shows module completion and the accuracy figures FR-040 requires', async () => {
    const user = userEvent.setup()
    fake.tables.lesson_progress = [
      {
        learner_id: 'learner-1',
        module_id: 'what-the-model-sees',
        state: 'completed',
        completed_steps: ['read-the-goal'],
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    fake.tables.projects = [
      {
        id: 'p1',
        owner_id: 'learner-1',
        name: 'Shapes',
        class_count: 2,
        sample_count: 20,
        created_at: '2026-01-01T09:00:00.000Z',
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    fake.tables.training_runs = [
      {
        id: 'r1',
        project_id: 'p1',
        finished_at: '2026-01-01T10:00:00.000Z',
        per_class: [],
        confusion: [],
        overall_accuracy: 0.91,
        imbalance_ratio: 1,
        backbone_alpha: 0.5,
        epochs: 20,
      },
    ]
    fake.tables.reflections = [
      {
        id: 'x1',
        learner_id: 'learner-1',
        module_id: 'what-the-model-sees',
        question_id: 'what-it-used',
        answer: 'It used the background.',
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ]

    renderWithProviders(<ClassroomPage />)
    await settled()

    expect(await screen.findByText(/1 of 7 modules finished/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^open$/i }))

    const detail = await screen.findByTestId('learner-detail-learner-1')
    expect(detail).toHaveTextContent(/best so far: 91%/i)
    expect(detail).toHaveTextContent(/It used the background\./)
    expect(within(detail).getByText(/what do you think it was actually using/i)).toBeInTheDocument()
  })

  it('states that her photos are not reachable (FR-041)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ClassroomPage />)
    await settled()
    await user.click(await screen.findByRole('button', { name: /^open$/i }))

    // An educator wondering whether she can see a learner's photographs deserves an
    // answer rather than an absence she has to interpret.
    expect(await screen.findByTestId('no-images-note')).toHaveTextContent(
      /stay in the browser on her own device/i,
    )
    expect(screen.queryAllByRole('img')).toEqual([])
  })
})

describe('membership and lifecycle (FR-030, FR-039, FR-052)', () => {
  beforeEach(() => {
    fake.tables.classrooms = [CLASSROOM]
    fake.tables.educator_roster = [
      {
        id: 'learner-1',
        username: 'zz-issued-username',
        alias: 'Comet',
        role: 'learner',
        is_active: true,
        classroom_id: 'classroom-1',
      },
    ]
  })

  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<ClassroomPage />)
    await settled()
    await user.click(await screen.findByRole('button', { name: /^open$/i }))
    return screen.findByTestId('learner-detail-learner-1')
  }

  it('issues a password reset code, once, with no email exchange (FR-030)', async () => {
    const user = userEvent.setup()
    const detail = await openDetail(user)

    fake.rpc.mockResolvedValueOnce({ data: 'SEEDC4', error: null })
    await user.click(within(detail).getByRole('button', { name: /new password code/i }))

    expect(await screen.findByTestId('reset-code')).toHaveTextContent('SEEDC4')
    expect(fake.rpc).toHaveBeenCalledWith('issue_password_reset', { learner: 'learner-1' })
    // Same once-only rule as an invitation, because it is the same mechanism.
    expect(screen.getByText(/only time you will see the code/i)).toBeInTheDocument()
  })

  it('removing from the classroom deletes one row and says her work survives', async () => {
    const user = userEvent.setup()
    const detail = await openDetail(user)

    await user.click(within(detail).getByRole('button', { name: /remove from classroom/i }))

    const dialog = await screen.findByRole('dialog')
    // Scenario 6.6 in words: what ends is the educator's visibility, nothing else.
    expect(dialog).toHaveTextContent(/she keeps her account, her projects/i)
    expect(dialog).toHaveTextContent(/only ends your view of her/i)

    await user.click(within(dialog).getByRole('button', { name: /remove her/i }))

    await waitFor(() => {
      expect(fake.deleted.enrolments).toBeDefined()
    })
    // One row: the enrolment. Not the profile, not the projects.
    expect(fake.rpc).not.toHaveBeenCalledWith('delete_learner', expect.anything())
  })

  it('deleting the account names what it destroys and what it cannot reach', async () => {
    const user = userEvent.setup()
    const detail = await openDetail(user)

    await user.click(within(detail).getByRole('button', { name: /delete account/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/cannot be undone/i)
    // Scenario 6.7. An educator who believed the deletion reached the device would
    // tell a learner her photographs were gone when they are not.
    expect(dialog).toHaveTextContent(/does not touch the photos and trained models/i)
    expect(dialog).toHaveTextContent(/still hers to keep or delete/i)

    await user.click(within(dialog).getByRole('button', { name: /delete it for good/i }))
    await waitFor(() => {
      expect(fake.rpc).toHaveBeenCalledWith('delete_learner', { id: 'learner-1' })
    })
  })

  it('keeps the two destructive actions visibly different', async () => {
    const user = userEvent.setup()
    const detail = await openDetail(user)

    const remove = within(detail).getByRole('button', { name: /remove from classroom/i })
    const destroy = within(detail).getByRole('button', { name: /delete account/i })

    // The property that matters: an educator tidying a roster at the end of term is
    // one mis-click from destroying a term's work, and the labels must not be
    // interchangeable. Only the irreversible one is styled as dangerous.
    expect(remove.className).not.toEqual(destroy.className)
    expect(remove.textContent).not.toEqual(destroy.textContent)
  })
})

describe('cross-classroom isolation (SC-011, FR-042, Scenario 6.4)', () => {
  it('treats a classroom that returns no rows as not hers, not as empty', async () => {
    // The policies refuse a cross-classroom read by returning nothing rather than by
    // erroring. An interface that rendered an empty roster would confirm the
    // classroom exists — a worse answer than a refusal.
    fake.tables.classrooms = []
    renderWithProviders(<ClassroomPage />)
    await settled()

    expect(await screen.findByLabelText(/classroom name/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /learners/i })).toBeNull()
  })

  it('asks only for its own classrooms, never for every educator\'s', async () => {
    fake.tables.classrooms = [CLASSROOM]
    renderWithProviders(<ClassroomPage />)
    await settled()

    // Belt as well as braces: the policy is the enforcement, but a query that asked
    // for everything and filtered client-side would be one policy change away from
    // leaking, and would look correct in every test that did not check this.
    await waitFor(() => {
      expect(fake.filters.classrooms).toContainEqual(['educator_id', 'educator-1'])
    })
  })
})
