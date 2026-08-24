/// <reference lib="dom" />
// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrainPanel } from '@/features/training/TrainPanel'
import { useLab, trainReadiness } from '@/features/lab/labStore'
import * as db from '@/lib/db'
import { renderWithProviders, setupI18n, stubEmbedding, stubImageBlob } from '../helpers/render.tsx'

/**
 * T038 / Scenario 1.3, FR-007, FR-008.
 *
 * The assertion this file exists for: **Train refused with an empty class NAMES
 * that class.** Acceptance Scenario 1.3 is explicit about it, and the reason is
 * concrete — a learner with four classes and a message reading "not enough data"
 * has to open each one to find out which. That is the difference between a
 * refusal she can act on and one she reads as the lab being broken.
 *
 * FR-008's "at most three settings" is also asserted, because that limit is a
 * product decision that erodes by accident: every additional knob is individually
 * defensible, and a learner who can change fifteen hyperparameters has been
 * taught that machine learning is a control panel.
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

async function seedClass(name: string, samples: number): Promise<db.ClassRecord> {
  const klass = await db.addClass(projectId, name)
  for (let i = 0; i < samples; i++) {
    await db.addSample({
      projectId,
      classId: klass.id,
      image: stubImageBlob(),
      // A distinct direction per class, so a real training run separates them.
      embedding: stubEmbedding(512, name.length / 20),
      embeddingAlpha: 0.5,
      source: 'camera',
    })
  }
  return klass
}

describe('trainReadiness — the refusal logic (Scenario 1.3)', () => {
  it('refuses one class, because there is nothing to tell it apart from', async () => {
    await seedClass('Apple', 5)
    await useLab.getState().refreshClasses()
    const { classes, sampleCounts } = useLab.getState()

    expect(trainReadiness(classes, sampleCounts)).toMatchObject({
      ready: false,
      reason: 'needTwoClasses',
    })
  })

  it('refuses an empty class and CARRIES ITS NAME', async () => {
    await seedClass('Apple', 5)
    await seedClass('Pear', 0)
    await useLab.getState().refreshClasses()
    const { classes, sampleCounts } = useLab.getState()

    expect(trainReadiness(classes, sampleCounts)).toMatchObject({
      ready: false,
      reason: 'emptyClass',
      emptyNames: ['Pear'],
    })
  })

  it('names every empty class when more than one is empty', async () => {
    await seedClass('Apple', 5)
    await seedClass('Pear', 0)
    await seedClass('Plum', 0)
    await useLab.getState().refreshClasses()
    const { classes, sampleCounts } = useLab.getState()

    expect(trainReadiness(classes, sampleCounts)).toMatchObject({
      reason: 'emptyClasses',
      emptyNames: ['Pear', 'Plum'],
    })
  })

  it('is ready with two non-empty classes', async () => {
    await seedClass('Apple', 3)
    await seedClass('Pear', 3)
    await useLab.getState().refreshClasses()
    const { classes, sampleCounts } = useLab.getState()

    expect(trainReadiness(classes, sampleCounts).ready).toBe(true)
  })

  it('is ready on an IMBALANCED set — imbalance never blocks training (FR-009)', async () => {
    // The fairness module depends on a learner being able to train 40-vs-5 and see
    // what happens (FR-036). A readiness check that refused it would delete a
    // lesson from the curriculum.
    await seedClass('Apple', 40)
    await seedClass('Pear', 5)
    await useLab.getState().refreshClasses()
    const { classes, sampleCounts } = useLab.getState()

    expect(trainReadiness(classes, sampleCounts).ready).toBe(true)
  })
})

describe('TrainPanel — refusals in the interface', () => {
  it('disables Train and names the empty class', async () => {
    await seedClass('Apple', 5)
    await seedClass('Pear', 0)
    await useLab.getState().refreshClasses()

    renderWithProviders(<TrainPanel />)

    expect(screen.getByRole('button', { name: /^train$/i })).toBeDisabled()
    // The name, in the visible message.
    expect(screen.getByText(/"Pear" has no photos yet/i)).toBeInTheDocument()
  })

  it('names all the empty classes when several are empty', async () => {
    await seedClass('Apple', 5)
    await seedClass('Pear', 0)
    await seedClass('Plum', 0)
    await useLab.getState().refreshClasses()

    renderWithProviders(<TrainPanel />)

    const message = screen.getByText(/have no photos yet/i)
    expect(message.textContent).toContain('Pear')
    expect(message.textContent).toContain('Plum')
  })

  it('asks for a second class when there is only one', async () => {
    await seedClass('Apple', 5)
    await useLab.getState().refreshClasses()

    renderWithProviders(<TrainPanel />)

    expect(screen.getByText(/at least two classes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^train$/i })).toBeDisabled()
  })

  it('enables Train when every class has photos', async () => {
    await seedClass('Apple', 3)
    await seedClass('Pear', 3)
    await useLab.getState().refreshClasses()

    renderWithProviders(<TrainPanel />)

    expect(screen.getByRole('button', { name: /^train$/i })).toBeEnabled()
  })
})

describe('TrainPanel — progress and cancellation (FR-007)', () => {
  it('reports epoch progress while training', async () => {
    const user = userEvent.setup()
    await seedClass('Apple', 6)
    await seedClass('Pear', 6)
    await useLab.getState().refreshClasses()
    useLab.getState().updateSettings({ epochs: 8 })

    renderWithProviders(<TrainPanel />)
    await user.click(screen.getByRole('button', { name: /^train$/i }))

    await waitFor(
      () => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )

    await waitFor(
      () => {
        expect(useLab.getState().progress.phase).toBe('done')
      },
      { timeout: 30_000 },
    )
    expect(useLab.getState().model).not.toBeNull()
  }, 60_000)

  it('offers a cancel control while training and honours it', async () => {
    const user = userEvent.setup()
    await seedClass('Apple', 20)
    await seedClass('Pear', 20)
    await useLab.getState().refreshClasses()
    // Enough epochs that there is a window in which to press cancel.
    useLab.getState().updateSettings({ epochs: 400 })

    renderWithProviders(<TrainPanel />)
    await user.click(screen.getByRole('button', { name: /^train$/i }))

    const cancel = await waitFor(() => screen.getByRole('button', { name: /stop training/i }), {
      timeout: 5000,
    })
    await user.click(cancel)

    await waitFor(
      () => {
        expect(useLab.getState().progress.phase).toBe('cancelled')
      },
      { timeout: 30_000 },
    )

    // Cancelling must not cost her any captured photos, which is the only thing
    // she cannot get back.
    expect(await db.listSamples(projectId)).toHaveLength(40)
    expect(useLab.getState().model).toBeNull()
    expect(screen.getByText(/photos are all still here/i)).toBeInTheDocument()
  }, 60_000)

  it('leaves no half-finished model loadable for inference (FR-050, D5)', async () => {
    const user = userEvent.setup()
    await seedClass('Apple', 20)
    await seedClass('Pear', 20)
    await useLab.getState().refreshClasses()
    useLab.getState().updateSettings({ epochs: 400 })

    renderWithProviders(<TrainPanel />)
    await user.click(screen.getByRole('button', { name: /^train$/i }))
    const cancel = await waitFor(() => screen.getByRole('button', { name: /stop training/i }), {
      timeout: 5000,
    })
    await user.click(cancel)

    await waitFor(
      () => {
        expect(useLab.getState().progress.phase).toBe('cancelled')
      },
      { timeout: 30_000 },
    )

    for (const record of await db.db.models.toArray()) {
      // Either it was cleaned up, or it is marked failed. What must never happen is
      // a record left `ready` pointing at weights that never finished.
      expect(record.status).not.toBe('ready')
      await expect(db.loadModelRecord(record.runId)).resolves.toBeUndefined()
    }
  }, 60_000)
})

describe('TrainPanel — settings (FR-008)', () => {
  it('offers AT MOST three settings', async () => {
    const user = userEvent.setup()
    await seedClass('Apple', 3)
    await seedClass('Pear', 3)
    await useLab.getState().refreshClasses()

    renderWithProviders(<TrainPanel />)
    await user.click(screen.getByRole('button', { name: /change the settings/i }))

    const group = screen.getByRole('group', { name: /settings/i })
    const controls = [
      ...group.querySelectorAll('input:not([type="hidden"])'),
      ...group.querySelectorAll('select'),
    ]
    expect(controls.length).toBeLessThanOrEqual(3)
    expect(controls.length).toBeGreaterThan(0)
  })

  it('gives every setting a default and a plain-language explanation', async () => {
    const user = userEvent.setup()
    await seedClass('Apple', 3)
    await seedClass('Pear', 3)
    await useLab.getState().refreshClasses()

    renderWithProviders(<TrainPanel />)
    await user.click(screen.getByRole('button', { name: /change the settings/i }))

    // An unexplained knob is worse than no knob: a learner who changes it and sees
    // a worse result has learned nothing about why.
    expect(screen.getByText(/how many times the computer goes over your photos/i)).toBeInTheDocument()
    expect(screen.getByText(/how many photos it looks at before adjusting/i)).toBeInTheDocument()
    expect(screen.getByText(/looks at more detail/i)).toBeInTheDocument()
  })

  it('starts from the documented defaults', async () => {
    await seedClass('Apple', 3)
    await seedClass('Pear', 3)
    await useLab.getState().refreshClasses()

    expect(useLab.getState().settings).toMatchObject({
      epochs: 20,
      batchSize: 16,
      backboneAlpha: 0.5,
    })
  })

  it('can be put back to the defaults', async () => {
    const user = userEvent.setup()
    await seedClass('Apple', 3)
    await seedClass('Pear', 3)
    await useLab.getState().refreshClasses()
    useLab.getState().updateSettings({ epochs: 100 })

    renderWithProviders(<TrainPanel />)
    await user.click(screen.getByRole('button', { name: /change the settings/i }))
    await user.click(screen.getByRole('button', { name: /back to the defaults/i }))

    expect(useLab.getState().settings.epochs).toBe(20)
  })
})

describe('TrainPanel — interrupted-run recovery (T048, D5, FR-050)', () => {
  it('reports a run left mid-training and offers a restart', async () => {
    await seedClass('Apple', 3)
    await seedClass('Pear', 3)
    await db.saveModel({
      runId: 'interrupted-run',
      projectId,
      artifactKey: 'k',
      classOrder: [],
    })
    await useLab.getState().refreshClasses()

    renderWithProviders(<TrainPanel />)

    await waitFor(() => {
      expect(screen.getByText(/did not finish/i)).toBeInTheDocument()
    })
    // Explains WHY an unfinished model is not simply loaded: it would look
    // confident and be wrong.
    expect(screen.getByText(/look confident and be wrong/i)).toBeInTheDocument()
  })
})
