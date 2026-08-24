/// <reference lib="dom" />
// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClassList } from '@/features/capture/ClassList'
import { SampleGrid } from '@/features/capture/SampleGrid'
import { useLab } from '@/features/lab/labStore'
import * as db from '@/lib/db'
import { renderWithProviders, setupI18n, stubEmbedding, stubImageBlob } from '../helpers/render.tsx'

/**
 * T037 / FR-001, FR-004 — the class list and the sample grid.
 *
 * The assertion worth defending here is the duplicate-name refusal, and
 * specifically that it is **case-insensitive**. "Apple" and "apple" are the same
 * class to a learner, so allowing both produces two identically-labelled
 * confidence bars and a model that has been taught to split one concept in half —
 * a result that is confusing to debug and impossible to see from the interface.
 */

let projectId = ''

beforeEach(async () => {
  await setupI18n('en')
  await db.db.delete()
  await db.db.open()

  const project = await db.createProject('Fruit', null)
  projectId = project.id
  await useLab.getState().openProject(projectId)
})

afterEach(() => {
  cleanup()
  useLab.getState().closeProject()
})

async function addSample(classId: string, source: db.SampleSource = 'camera') {
  return db.addSample({
    projectId,
    classId,
    image: stubImageBlob(),
    embedding: stubEmbedding(),
    embeddingAlpha: 0.5,
    source,
  })
}

describe('ClassList — creating', () => {
  it('creates a class and shows it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ClassList />)

    await user.click(screen.getByRole('button', { name: /add a class/i }))
    await user.type(screen.getByLabelText(/class name/i), 'Apple')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Apple')).toBeInTheDocument()
    })
    expect(await db.listClasses(projectId)).toHaveLength(1)
  })

  it('refuses a duplicate name case-insensitively and says so (FR-001)', async () => {
    const user = userEvent.setup()
    await db.addClass(projectId, 'Apple')
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)

    await user.click(screen.getByRole('button', { name: /add a class/i }))
    await user.type(screen.getByLabelText(/class name/i), 'apple')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      // The message names the class, and says explicitly that capitalisation does
      // not make it different — otherwise a learner retries with "APPLE".
      expect(screen.getByText(/already have a class called/i)).toBeInTheDocument()
    })
    expect(await db.listClasses(projectId)).toHaveLength(1)
  })

  it('refuses a blank name', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ClassList />)

    await user.click(screen.getByRole('button', { name: /add a class/i }))
    await user.type(screen.getByLabelText(/class name/i), '   ')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText(/give the class a name/i)).toBeInTheDocument()
    })
    expect(await db.listClasses(projectId)).toHaveLength(0)
  })

  it('prompts for a second class, because one cannot be told apart from anything', async () => {
    await db.addClass(projectId, 'Apple')
    await useLab.getState().refreshClasses()
    renderWithProviders(<ClassList />)

    expect(screen.getByText(/add one more class/i)).toBeInTheDocument()
  })
})

describe('ClassList — renaming', () => {
  it('renames a class in place', async () => {
    const user = userEvent.setup()
    const klass = await db.addClass(projectId, 'Apple')
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)

    await user.click(screen.getByRole('button', { name: /rename apple/i }))
    const field = screen.getByLabelText(/class name/i)
    await user.clear(field)
    await user.type(field, 'Green apple')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Green apple')).toBeInTheDocument()
    })
    expect((await db.db.classes.get(klass.id))?.name).toBe('Green apple')
  })

  it('keeps a renamed class attached to its samples (D2)', async () => {
    const user = userEvent.setup()
    const klass = await db.addClass(projectId, 'Apple')
    const sample = await addSample(klass.id)
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)
    await user.click(screen.getByRole('button', { name: /rename apple/i }))
    const field = screen.getByLabelText(/class name/i)
    await user.clear(field)
    await user.type(field, 'Pear')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Pear')).toBeInTheDocument()
    })
    // The id never changes, which is why a training run recorded before the rename
    // still attributes its figures to the right class.
    expect((await db.db.samples.get(sample.id))?.classId).toBe(klass.id)
  })

  it('refuses a rename that collides with a sibling', async () => {
    const user = userEvent.setup()
    await db.addClass(projectId, 'Apple')
    await db.addClass(projectId, 'Pear')
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)

    await user.click(screen.getByRole('button', { name: /rename pear/i }))
    const field = screen.getByLabelText(/class name/i)
    await user.clear(field)
    await user.type(field, 'APPLE')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText(/already have a class called/i)).toBeInTheDocument()
    })
  })
})

describe('ClassList — reordering', () => {
  it('moves a class up and down', async () => {
    const user = userEvent.setup()
    await db.addClass(projectId, 'One')
    await db.addClass(projectId, 'Two')
    await db.addClass(projectId, 'Three')
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)

    await user.click(screen.getByRole('button', { name: /move three up/i }))
    await waitFor(async () => {
      expect((await db.listClasses(projectId)).map((k) => k.name)).toEqual(['One', 'Three', 'Two'])
    })

    await user.click(screen.getByRole('button', { name: /move one down/i }))
    await waitFor(async () => {
      expect((await db.listClasses(projectId)).map((k) => k.name)).toEqual(['Three', 'One', 'Two'])
    })
  })

  it('offers no move-up on the first class or move-down on the last', async () => {
    await db.addClass(projectId, 'One')
    await db.addClass(projectId, 'Two')
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)

    expect(screen.queryByRole('button', { name: /move one up/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /move two down/i })).not.toBeInTheDocument()
  })

  it('uses buttons rather than drag-and-drop, so it is keyboard-operable (FR-046)', async () => {
    // Drag-and-drop reordering is unusable with a keyboard and awkward on a
    // touchscreen, both of which SC-009 and SC-004 make first-class.
    await db.addClass(projectId, 'One')
    await db.addClass(projectId, 'Two')
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)
    expect(screen.getByRole('button', { name: /move two up/i })).toBeInTheDocument()
  })
})

describe('ClassList — deleting', () => {
  it('deletes a class and its samples after confirming', async () => {
    const user = userEvent.setup()
    const klass = await db.addClass(projectId, 'Apple')
    await db.addClass(projectId, 'Pear')
    await addSample(klass.id)
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)

    await user.click(screen.getByRole('button', { name: /delete apple/i }))
    // Confirmed, not immediate: deleting a class destroys captured photos that
    // exist nowhere else.
    await user.click(screen.getByRole('button', { name: /delete for good|delete$/i }))

    await waitFor(async () => {
      expect((await db.listClasses(projectId)).map((k) => k.name)).toEqual(['Pear'])
    })
    expect(await db.db.samples.where('classId').equals(klass.id).count()).toBe(0)
  })

  it('names the photo count in the confirmation, so the cost is visible', async () => {
    const user = userEvent.setup()
    const klass = await db.addClass(projectId, 'Apple')
    for (let i = 0; i < 3; i++) await addSample(klass.id)
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)
    await user.click(screen.getByRole('button', { name: /delete apple/i }))

    await waitFor(() => {
      expect(screen.getByText(/3 photos go too/i)).toBeInTheDocument()
    })
  })
})

describe('ClassList — live counts', () => {
  it('shows a live per-class photo count', async () => {
    const apple = await db.addClass(projectId, 'Apple')
    const pear = await db.addClass(projectId, 'Pear')
    for (let i = 0; i < 4; i++) await addSample(apple.id)
    await addSample(pear.id)
    await useLab.getState().refreshClasses()

    renderWithProviders(<ClassList />)

    expect(screen.getByText('4 photos')).toBeInTheDocument()
    expect(screen.getByText('1 photos')).toBeInTheDocument()
  })

  it('updates the count when a sample is added', async () => {
    const apple = await db.addClass(projectId, 'Apple')
    await useLab.getState().refreshClasses()
    renderWithProviders(<ClassList />)

    expect(screen.getByText(/no photos yet/i)).toBeInTheDocument()

    await addSample(apple.id)
    await useLab.getState().refreshClasses()

    await waitFor(() => {
      expect(screen.getByText('1 photos')).toBeInTheDocument()
    })
  })

  it('marks the selected class, so capture never goes to a surprise class', async () => {
    const apple = await db.addClass(projectId, 'Apple')
    await db.addClass(projectId, 'Pear')
    await useLab.getState().refreshClasses()
    useLab.getState().selectClass(apple.id)

    renderWithProviders(<ClassList />)

    const selected = screen.getByRole('radio', { name: /apple/i })
    expect(selected).toBeChecked()
  })

  it('lets a learner change the class being captured into', async () => {
    const user = userEvent.setup()
    const apple = await db.addClass(projectId, 'Apple')
    const pear = await db.addClass(projectId, 'Pear')
    await useLab.getState().refreshClasses()
    useLab.getState().selectClass(apple.id)

    renderWithProviders(<ClassList />)
    await user.click(screen.getByRole('radio', { name: /pear/i }))

    expect(useLab.getState().selectedClassId).toBe(pear.id)
  })
})

describe('SampleGrid — reviewing and deleting (FR-004)', () => {
  it('shows one thumbnail per sample', async () => {
    const klass = await db.addClass(projectId, 'Apple')
    for (let i = 0; i < 3; i++) await addSample(klass.id)
    await useLab.getState().refreshClasses()
    useLab.getState().selectClass(klass.id)

    renderWithProviders(<SampleGrid />)

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })
  })

  it('deletes a single sample, leaving the others (FR-004)', async () => {
    const user = userEvent.setup()
    const klass = await db.addClass(projectId, 'Apple')
    for (let i = 0; i < 3; i++) await addSample(klass.id)
    await useLab.getState().refreshClasses()
    useLab.getState().selectClass(klass.id)

    renderWithProviders(<SampleGrid />)

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })
    await user.click(screen.getAllByRole('button', { name: /delete photo/i })[0]!)

    await waitFor(async () => {
      expect(await db.listSamples(projectId, klass.id)).toHaveLength(2)
    })
  })

  it('says so when a class has no photos', async () => {
    const klass = await db.addClass(projectId, 'Apple')
    await useLab.getState().refreshClasses()
    useLab.getState().selectClass(klass.id)

    renderWithProviders(<SampleGrid />)

    await waitFor(() => {
      expect(screen.getByText(/no photos in this class yet/i)).toBeInTheDocument()
    })
  })

  it('gives every thumbnail a text alternative naming its class (SC-009)', async () => {
    const klass = await db.addClass(projectId, 'Apple')
    await addSample(klass.id)
    await useLab.getState().refreshClasses()
    useLab.getState().selectClass(klass.id)

    renderWithProviders(<SampleGrid />)

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /photo 1 in apple/i })).toBeInTheDocument()
    })
  })
})
