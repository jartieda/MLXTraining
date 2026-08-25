/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setupI18n } from '../helpers/render'
import { ExportModel } from '@/features/results/ExportModel'
import type { RunClassMetric } from '@/lib/db'
import type { TrainedModel } from '@/ml/train'

/**
 * T083 / FR-022, Scenario 7.4 — the export states its contents BEFORE producing.
 *
 * The ordering is the whole requirement, so it is asserted as an ordering: the save
 * call must not have happened when the dialogue opens, and must happen only after
 * the confirming click. A test that merely checked the dialogue's wording would pass
 * against a component that downloaded on the first click and explained afterwards.
 *
 * The second thing asserted here is what the statement *says*. A learner has just
 * trained a model on photographs of her own face, and "export the model" sounds like
 * it might carry them. FR-048 and Principle I make it a fact that it does not, and
 * this view is where she finds that out — so the absences are asserted as carefully
 * as the contents.
 */

const CLASSES: readonly RunClassMetric[] = [
  { classId: 'a', className: 'Stripes', sampleCount: 20, accuracy: 0.9 },
  { classId: 'b', className: 'Circles', sampleCount: 20, accuracy: 0.85 },
]

function stubModel(save: ReturnType<typeof vi.fn>): TrainedModel {
  return {
    classCount: 2,
    embeddingSize: 512,
    usedValidationSplit: true,
    head: { pooled: { save }, spatial: { save: vi.fn() }, classCount: 2, embeddingSize: 512 },
  } as unknown as TrainedModel
}

beforeEach(async () => {
  await setupI18n('en')
})

describe('the export dialogue states what the file contains first (FR-022)', () => {
  it('writes nothing when the dialogue opens', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(
      <ExportModel model={stubModel(save)} perClass={CLASSES} projectName="Shapes" />,
    )

    await user.click(screen.getByRole('button', { name: /export the model/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/what you are about to download/i)).toBeInTheDocument()
    // Scenario 7.4: told before it is produced. Nothing has been produced.
    expect(save).not.toHaveBeenCalled()
  })

  it('names the weights, the class names in model order, and the two files', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ExportModel model={stubModel(vi.fn())} perClass={CLASSES} projectName="Shapes" />,
    )
    await user.click(screen.getByRole('button', { name: /export the model/i }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(/numbers the model learned during training/i)).toBeInTheDocument()
    // In model order, because an importer that reorders them gets every label wrong.
    expect(within(dialog).getByText(/2 classes.*Stripes, Circles/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/Shapes-model\.json and Shapes-model\.weights\.bin/i)).toBeInTheDocument()
  })

  it('states the absences, which are what she would otherwise assume', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ExportModel model={stubModel(vi.fn())} perClass={CLASSES} projectName="Shapes" />,
    )
    await user.click(screen.getByRole('button', { name: /export the model/i }))
    const dialog = await screen.findByRole('dialog')

    // Principle I. This is the sentence that makes the export safe to offer at all.
    expect(within(dialog).getByText(/none of your photos/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/not the large pretrained model/i)).toBeInTheDocument()
    // FR-048 requires an action that NAMES the destination.
    expect(within(dialog).getByText(/downloads folder.*nothing is uploaded/i)).toBeInTheDocument()
  })

  it('produces the file only on the confirming click, and only the inference path', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(
      <ExportModel model={stubModel(save)} perClass={CLASSES} projectName="Shapes" />,
    )

    await user.click(screen.getByRole('button', { name: /export the model/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /download it/i }))

    await waitFor(() => {
      // `downloads://` is a browser save, not a network call — which is why this
      // feature coexists with the no-egress gate rather than punching a hole in it.
      expect(save).toHaveBeenCalledWith('downloads://Shapes-model')
    })
    expect(await screen.findByText(/saved as Shapes-model\.json/i)).toBeInTheDocument()
  })

  it('cancelling produces nothing', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(
      <ExportModel model={stubModel(save)} perClass={CLASSES} projectName="Shapes" />,
    )

    await user.click(screen.getByRole('button', { name: /export the model/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }))

    expect(save).not.toHaveBeenCalled()
  })

  it('reports a failure without claiming anything was lost', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockRejectedValue(new Error('no disk'))
    renderWithProviders(
      <ExportModel model={stubModel(save)} perClass={CLASSES} projectName="Shapes" />,
    )

    await user.click(screen.getByRole('button', { name: /export the model/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /download it/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be made/i)
    // The model is still in the browser; only the file was not written.
    expect(screen.getByRole('alert')).toHaveTextContent(/nothing was lost/i)
  })

  it('offers nothing at all without a trained model (FR-050)', () => {
    const { container } = renderWithProviders(
      <ExportModel model={null} perClass={[]} projectName="Shapes" />,
    )
    // An export button that produced an untrained head would hand a learner a file
    // of random numbers and call it her model.
    expect(container).toBeEmptyDOMElement()
  })

  it('is complete in Spanish too (FR-044, SC-005)', async () => {
    await setupI18n('es')
    const user = userEvent.setup()
    renderWithProviders(
      <ExportModel model={stubModel(vi.fn())} perClass={CLASSES} projectName="Formas" />,
    )

    await user.click(screen.getByRole('button', { name: /exportar el modelo/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/lo que estás a punto de descargar/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/ninguna de tus fotos/i)).toBeInTheDocument()

    await setupI18n('en')
  })
})
