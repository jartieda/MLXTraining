/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setupI18n } from '../helpers/render'
import { clientOf, createFakeSupabase, type FakeSupabase } from '../helpers/supabase'

/**
 * T091 / US5 — FR-035, FR-037, L4, Scenario 5.2, 5.3, 5.4.
 *
 * Three properties, and the first two are about the absence of a button:
 *
 * 1. **Ticking a step saves it, with no save action** (FR-035, Scenario 5.2). A
 *    learner in a classroom will close the tab; a save button she did not press is
 *    lost work, and the loss is silent.
 * 2. **A reflection is revisable in place** (FR-035, L4, Scenario 5.3). One field
 *    holding the current answer, and revising replaces rather than appends — which is
 *    what the unique constraint enforces underneath, and what the upsert here must
 *    actually ask for.
 * 3. **An unavailable challenge names the earlier step** (FR-037, Scenario 5.4). Not
 *    "you need a trained model" — the step, as a link. This is the assertion that
 *    fails if the prerequisite graph ever points at a slug that no longer exists.
 */

let fake: FakeSupabase

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>()
  return { ...actual, getSupabase: () => clientOf(fake), isSupabaseConfigured: () => true }
})

const { useSession } = await import('@/features/auth/session')
const { ModuleView } = await import('@/features/lessons/ModuleView')
const { LearningPath } = await import('@/features/lessons/LearningPath')
const { loadLessonNamespace } = await import('@/lib/i18n')
const db = await import('@/lib/db')

const LEARNER = {
  id: 'learner-1',
  alias: 'Comet',
  role: 'learner' as const,
  displayName: null,
  classroomId: 'classroom-1',
}

function signIn() {
  useSession.setState({ status: 'signed-in', account: LEARNER })
}

function signOut() {
  useSession.setState({ status: 'anonymous', account: null })
}

/** A project with two classes, ten photos each, and one finished run. */
async function seedTrainedProject(): Promise<void> {
  const project = await db.createProject('Shapes', LEARNER.id)
  const a = await db.addClass(project.id, 'Stripes')
  const b = await db.addClass(project.id, 'Circles')

  for (const klass of [a, b]) {
    for (let index = 0; index < 10; index += 1) {
      await db.addSample({
        projectId: project.id,
        classId: klass.id,
        image: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
        embedding: new Float32Array(4).fill(0.5),
        embeddingAlpha: 0.5,
        source: 'upload',
      })
    }
  }

  await db.saveModel({
    runId: 'run-1',
    projectId: project.id,
    artifactKey: 'run-1',
    classOrder: [a.id, b.id],
  })
  await db.markModelReady('run-1', {
    perClass: [
      { classId: a.id, className: 'Stripes', sampleCount: 10, accuracy: 1 },
      { classId: b.id, className: 'Circles', sampleCount: 10, accuracy: 1 },
    ],
    confusion: [
      [10, 0],
      [0, 10],
    ],
    overallAccuracy: 1,
    imbalanceRatio: 1,
    backboneAlpha: 0.5,
    epochs: 20,
    finishedAt: '2026-01-01T10:00:00.000Z',
  })
}

beforeEach(async () => {
  await setupI18n('en')
  await loadLessonNamespace()
  fake = createFakeSupabase()
  signIn()

  await db.db.delete()
  await db.db.open()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('step completion autosaves (FR-035, Scenario 5.2)', () => {
  it('writes progress on the tick, with no save button anywhere', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    const step = await screen.findByRole('checkbox', { name: /read what you are about to do/i })
    await user.click(step)

    expect(step).toBeChecked()
    await waitFor(() => {
      expect(fake.upserted.lesson_progress).toBeDefined()
    })

    const written = fake.upserted.lesson_progress?.[0] as Record<string, unknown>
    expect(written).toMatchObject({
      learner_id: 'learner-1',
      module_id: 'what-the-model-sees',
      completed_steps: ['read-the-goal'],
      // One of six ticked, so in progress rather than complete.
      state: 'in_progress',
    })

    // FR-035 says automatically. A save control anywhere in the module would mean
    // the autosave is a convenience rather than the mechanism.
    const saveControls = screen
      .queryAllByRole('button')
      .filter((element) => /save|guardar/i.test(element.textContent ?? ''))
    expect(saveControls).toEqual([])
  })

  it('marks the module completed only when every step is ticked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModuleView moduleId="fooling-the-model" />)

    // This module has four steps, which is why it is the one used here.
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes).toHaveLength(4)

    for (const box of boxes) await user.click(box)

    await waitFor(() => {
      const writes = fake.upserted.lesson_progress ?? []
      expect(writes.length).toBeGreaterThanOrEqual(4)
    })

    const writes = (fake.upserted.lesson_progress ?? []) as Record<string, unknown>[]
    // Derived from the step list, never supplied by the caller — so "completed"
    // cannot mean anything other than "all of them".
    expect(writes[writes.length - 1]).toMatchObject({ state: 'completed' })
    expect(writes.slice(0, -1).every((write) => write.state === 'in_progress')).toBe(true)
  })

  it('un-ticking a step takes it back out of the list', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    const step = await screen.findByRole('checkbox', { name: /read what you are about to do/i })
    await user.click(step)
    await user.click(step)

    await waitFor(() => {
      const writes = (fake.upserted.lesson_progress ?? []) as Record<string, unknown>[]
      expect(writes[writes.length - 1]).toMatchObject({
        completed_steps: [],
        state: 'not_started',
      })
    })
  })

  it('restores the ticks she already made', async () => {
    fake.tables.lesson_progress = [
      {
        learner_id: 'learner-1',
        module_id: 'what-the-model-sees',
        state: 'in_progress',
        completed_steps: ['read-the-goal', 'make-a-project'],
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /read what you are about to do/i })).toBeChecked()
    })
    expect(screen.getByRole('checkbox', { name: /make a project/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /train it/i })).not.toBeChecked()
  })
})

describe('reflections are revisable in place (FR-035, L4, Scenario 5.3)', () => {
  it('autosaves the answer, and says so', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    const field = await screen.findByLabelText(/what do you think it was actually using/i)
    await user.type(field, 'The colour, I think.')

    // Announced. Autosave with no feedback is indistinguishable from data loss to
    // a learner who has just written three sentences about bias.
    await waitFor(
      () => {
        expect(screen.getByTestId('reflection-status-what-it-used')).toHaveTextContent(/saved/i)
      },
      { timeout: 3000 },
    )

    const written = (fake.upserted.reflections ?? []) as Record<string, unknown>[]
    expect(written[written.length - 1]).toMatchObject({
      learner_id: 'learner-1',
      module_id: 'what-the-model-sees',
      question_id: 'what-it-used',
      answer: 'The colour, I think.',
    })
  })

  it('debounces, so a sentence is one write rather than one per keystroke', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    const field = await screen.findByLabelText(/what do you think it was actually using/i)
    await user.type(field, 'the background')

    await waitFor(
      () => {
        expect(screen.getByTestId('reflection-status-what-it-used')).toHaveTextContent(/saved/i)
      },
      { timeout: 3000 },
    )

    // Fourteen characters, one write. A classroom of thirty typing paragraphs would
    // otherwise be a write per keystroke per learner.
    expect((fake.upserted.reflections ?? []).length).toBe(1)
  })

  it('shows the stored answer in an editable field, not as read-only text', async () => {
    fake.tables.reflections = [
      {
        id: 'r1',
        learner_id: 'learner-1',
        module_id: 'what-the-model-sees',
        question_id: 'what-it-used',
        answer: 'It used the background.',
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    const field = await screen.findByLabelText(/what do you think it was actually using/i)
    // "Revise in place" means one field holding the current answer — not an answer
    // plus a separate edit form.
    await waitFor(() => {
      expect(field).toHaveValue('It used the background.')
    })
    expect(field).not.toHaveAttribute('readonly')
    expect(field).not.toBeDisabled()
  })

  it('a revision replaces rather than appends (L4)', async () => {
    const user = userEvent.setup()
    fake.tables.reflections = [
      {
        id: 'r1',
        learner_id: 'learner-1',
        module_id: 'what-the-model-sees',
        question_id: 'what-it-used',
        answer: 'The colour.',
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    const field = await screen.findByLabelText(/what do you think it was actually using/i)
    await waitFor(() => {
      expect(field).toHaveValue('The colour.')
    })

    await user.clear(field)
    await user.type(field, 'Actually the background.')

    await waitFor(
      () => {
        expect(screen.getByTestId('reflection-status-what-it-used')).toHaveTextContent(/saved/i)
      },
      { timeout: 3000 },
    )

    const written = (fake.upserted.reflections ?? []) as Record<string, unknown>[]
    expect(written[written.length - 1]).toMatchObject({ answer: 'Actually the background.' })
    // The conflict target must be named, or a repeat answer inserts a second row
    // and the unique constraint turns a revision into an error she cannot act on.
    expect(fake.upsertOptions.reflections?.at(-1)).toMatchObject({
      onConflict: 'learner_id,module_id,question_id',
    })
  })

  it('renders every reflection question the module declares (FR-034)', async () => {
    renderWithProviders(<ModuleView moduleId="imbalance-experiment" />)
    // This module has three, and the third — "what would you check" — is the one
    // that carries the lesson out of the lab.
    await waitFor(() => {
      expect(screen.getAllByRole('textbox')).toHaveLength(3)
    })
    expect(screen.getByLabelText(/what would you now want to check/i)).toBeInTheDocument()
  })
})

describe('an unavailable challenge names the earlier step (FR-037, Scenario 5.4)', () => {
  it('names the step and links to its module, rather than stating a bare requirement', async () => {
    renderWithProviders(<ModuleView moduleId="reading-a-heat-map" />)

    const blocked = await screen.findByTestId('challenge-blocked')
    expect(blocked).toHaveTextContent(/you need a trained model/i)

    // The whole of FR-037: which earlier step, by name, as a link.
    const link = within(blocked).getAllByTestId('prerequisite-link')[0]
    expect(link).toHaveTextContent(/go to "train it" in what the model sees/i)
    expect(link).toHaveAttribute('href', '/lessons/what-the-model-sees')
  })

  it('lists every missing prerequisite, in the order they are produced', async () => {
    renderWithProviders(<ModuleView moduleId="final-presentation" />)

    const blocked = await screen.findByTestId('challenge-blocked')
    const items = within(blocked).getAllByRole('listitem')
    // Trained model, then both explanations, then two runs — the sequence in which
    // she would actually acquire them. Sorting would break that.
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent(/trained model/i)
    expect(items[1]).toHaveTextContent(/both explanations/i)
    expect(items[2]).toHaveTextContent(/trained the same project twice/i)
  })

  it('says she is ready once the lab actually contains what the challenge needs', async () => {
    await seedTrainedProject()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    // Read from IndexedDB across all her projects, not from the lab store — which
    // is empty on this route and would report "no trained model" to a learner who
    // has one.
    expect(await screen.findByTestId('challenge-ready')).toBeInTheDocument()
    expect(screen.queryByTestId('challenge-blocked')).toBeNull()
  })

  it('does not flash a refusal while the capability read is still running', async () => {
    await seedTrainedProject()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    // The loading state renders instead of the refusal. Without it a slow
    // IndexedDB shows "you need a trained model" to someone who has three.
    expect(screen.queryByTestId('challenge-blocked')).toBeNull()
    await screen.findByTestId('challenge-ready')
  })
})

describe('the fairness module embeds the run comparison (FR-036, T100)', () => {
  it('renders the comparison section, using the same component the lab does', async () => {
    await seedTrainedProject()
    renderWithProviders(<ModuleView moduleId="imbalance-experiment" />)

    expect(
      await screen.findByRole('heading', { name: /your two runs, side by side/i }),
    ).toBeInTheDocument()
    // One run so far, so the comparison explains where the second will appear
    // rather than hiding — the same behaviour as in the lab.
    expect(await screen.findByText(/train a second time/i)).toBeInTheDocument()
  })

  it('is the only module that embeds it', async () => {
    renderWithProviders(<ModuleView moduleId="comparing-explanations" />)
    await screen.findByTestId('challenge-blocked')
    expect(screen.queryByRole('heading', { name: /side by side/i })).toBeNull()
  })
})

describe('the learning path lists modules with their state (Scenario 5.1)', () => {
  it('shows all seven with completion state', async () => {
    fake.tables.lesson_progress = [
      {
        learner_id: 'learner-1',
        module_id: 'what-the-model-sees',
        state: 'completed',
        completed_steps: ['read-the-goal', 'make-a-project'],
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ]
    renderWithProviders(<LearningPath />)

    await waitFor(() => {
      expect(screen.getByTestId('module-state-what-the-model-sees')).toHaveTextContent(/finished/i)
    })
    expect(screen.getByTestId('module-state-final-presentation')).toHaveTextContent(/not started/i)
    expect(screen.getByRole('meter', { name: /modules finished/i })).toHaveAttribute(
      'aria-valuenow',
      // One of seven.
      '14',
    )
  })

  it('locks nothing, because FR-037 explains rather than refuses', async () => {
    renderWithProviders(<LearningPath />)
    // Every module is openable. The real constraint is checked against her lab at
    // the challenge, which is both more accurate and more useful than a padlock.
    const links = await screen.findAllByRole('link', { name: /^start$|^carry on$/i })
    expect(links).toHaveLength(7)
  })
})

describe('an anonymous visitor can read but is told nothing is saved (FR-023)', () => {
  beforeEach(() => {
    signOut()
  })

  it('says so on the path and on a module', async () => {
    renderWithProviders(<LearningPath />)
    expect(await screen.findByTestId('path-anonymous')).toHaveTextContent(/will not be saved/i)
  })

  it('lets her write, and does not pretend to save it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    expect(await screen.findByTestId('lessons-anonymous')).toBeInTheDocument()

    const field = await screen.findByLabelText(/what do you think it was actually using/i)
    await user.type(field, 'Something I noticed.')

    // Writable — refusing input would be a worse lie than not saving it — and
    // honest about where it goes.
    expect(field).toHaveValue('Something I noticed.')
    expect(screen.getByTestId('reflection-status-what-it-used')).toHaveTextContent(
      /not being saved/i,
    )
    expect(fake.upserted.reflections).toBeUndefined()
  })

  it('writes no progress when she ticks a step', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModuleView moduleId="what-the-model-sees" />)

    const step = await screen.findByRole('checkbox', { name: /read what you are about to do/i })
    await user.click(step)

    // Ticked locally so the module is still usable as a checklist in the session.
    expect(step).toBeChecked()
    expect(fake.upserted.lesson_progress).toBeUndefined()
  })
})

describe('an unknown module slug', () => {
  it('says not found rather than silently redirecting', async () => {
    // A broken link in an educator's worksheet must be visible to her, not
    // swallowed into the path where she would never learn it was wrong.
    renderWithProviders(<ModuleView moduleId={'no-such-module' as never} />)
    expect(await screen.findByRole('heading', { name: /does not exist/i })).toBeInTheDocument()
  })
})
