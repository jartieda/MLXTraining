import { test, expect, type Page } from '@playwright/test'
import { assertNothingEscaped, watchForEscapes } from './helpers/egress'

/**
 * T082 / US7 — FR-009, FR-010, FR-021, Scenario 7.2 and 7.3.
 *
 * This is the fairness lesson performed end to end, and it is the run that proves
 * FR-009 and FR-021 hold *together*. The pairing is the fragile part: FR-021 wants a
 * warning and FR-009 forbids a block, and the natural way to implement a warning is
 * to make the learner acknowledge it first. That would pass a test asserting the
 * notice exists while destroying the lesson, so the assertions here are deliberately
 * about what the interface still lets her do:
 *
 *   - the imbalance notice appears,
 *   - the model trains anyway,
 *   - it is testable immediately, with no dismissal step in between,
 *   - and the confusion pattern shows the minority class collapsing.
 *
 * Then she rebalances and compares the two runs, which is FR-010 and the whole
 * before-and-after the fairness module argues from.
 *
 * The skew is 8 photos against 2 rather than the spec's 40 against 5. The ratio is
 * what drives the notice (4× against a 2× threshold) and what produces the collapse;
 * 45 uploads through the file input at three fixtures per class would add minutes per
 * browser project for no additional assertion. The ratio is the variable under test,
 * and it is preserved.
 */

const MAJORITY = [
  'class-stripes-h-0.png',
  'class-stripes-h-1.png',
  'class-stripes-h-2.png',
  'class-stripes-h-3.png',
  'class-stripes-h-4.png',
  'class-stripes-h-5.png',
  'class-stripes-h-6.png',
  'class-stripes-h-7.png',
] as const

const MINORITY_FIRST = ['class-circle-0.png', 'class-circle-1.png'] as const
const MINORITY_REST = [
  'class-circle-2.png',
  'class-circle-3.png',
  'class-circle-4.png',
  'class-circle-5.png',
  'class-circle-6.png',
  'class-circle-7.png',
] as const

async function newProject(page: Page, name: string): Promise<void> {
  await page.goto('/projects')
  await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
  await page.getByLabel(/project name|nombre del proyecto/i).fill(name)
  await page.getByRole('button', { name: /^save$|^guardar$/i }).click()
}

async function addClass(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /add a class|añadir una clase/i }).click()
  await page.getByLabel(/class name|nombre de la clase/i).fill(name)
  await page.keyboard.press('Enter')
}

async function uploadInto(page: Page, className: string, files: readonly string[]): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(className, 'i') }).click()
  await expect(page.getByRole('button', { name: /choose photos|elegir fotos/i })).toBeEnabled({
    timeout: 120_000,
  })
  await page.locator('#upload-samples-input').setInputFiles(files.map((f) => `tests/fixtures/${f}`))
  await expect(
    page.getByText(new RegExp(`added ${String(files.length)} photos|se han añadido ${String(files.length)} fotos`, 'i')),
  ).toBeVisible({ timeout: 60_000 })
}

/**
 * Presses Train, whichever of its two labels is showing.
 *
 * The button reads "Train" before the first run and "Train again" after it, so the
 * second call in a rebalance-and-compare test hits the second label. Anchored
 * alternatives rather than a loose `/train/i`, which would also match the "3. Train
 * it" panel heading if that ever became a button.
 */
async function train(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^train$|^train again$|^entrenar$|^entrenar otra vez$/i })
    .click()
  await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 180_000 })
}

test.describe('US7 — judging a model, and judging it fair', () => {
  test('a skewed run warns, trains anyway, and stays testable (FR-009, FR-021)', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    const { escapes } = watchForEscapes(page)

    await newProject(page, 'Fairness skewed')
    await addClass(page, 'Stripes')
    await addClass(page, 'Circles')
    await uploadInto(page, 'Stripes', MAJORITY)
    await uploadInto(page, 'Circles', MINORITY_FIRST)

    // FR-020: the counts are visible BEFORE training, while more photographs are
    // still the obvious fix.
    await expect(page.getByRole('meter', { name: /Stripes/i })).toBeVisible()
    await expect(page.getByText(/10 photos altogether|10 fotos en total/i)).toBeVisible()

    await train(page)

    // ── FR-021: the notice, naming the effect rather than only the ratio.
    const notice = page.getByTestId('imbalance-notice')
    await expect(notice).toBeVisible({ timeout: 60_000 })
    await expect(notice).toContainText(/4\.0 times as many|4,0 veces más/i)
    await expect(notice).toContainText(/safe bet|apuesta segura/i)

    // ── FR-009: and it did not block. The strongest available form of this
    // assertion is that the trained model is usable with no step in between — no
    // "I understand" button, no disabled control, nothing to dismiss.
    await expect(notice.getByRole('button')).toHaveCount(0)
    await expect(page.getByText(/trained and you can test it right now|puedes probarlo ahora/i)).toBeVisible()

    // ── The confusion breakdown exists and is correctly oriented (FR-020).
    //
    // Note what is deliberately NOT asserted: that the minority class collapses.
    // `evaluate` scores the run against the photographs it trained on, and these
    // fixtures are linearly separable in MobileNet's embedding space, so both
    // classes come out at or near 100% however lopsided the counts are — the
    // caveat the panel itself prints. A "collapse" assertion here would either be
    // flaky or, worse, vacuously true: every cell renders an accessible
    // description including the zero ones, so matching "were called Stripes"
    // passes against a count of 0. The imbalance story is told by the counts and
    // the notice above, which is where it is actually visible.
    await expect(page.getByRole('table', { name: '' }).first()).toBeVisible()
    await expect(page.getByText(/rows are the class the photo really belongs to/i)).toBeVisible()
    // The Circles row holds its 2 photos, named as a pairing rather than a bare number.
    await expect(page.getByText(/2 photos, 100% of the Circles photos, were called Circles/i)).toBeVisible()

    // ── And it really is testable: live prediction runs against the skewed model,
    // reached directly from the warned state with nothing dismissed in between.
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
    await page.getByRole('button', { name: /start guessing|empezar a adivinar/i }).click()
    // "<class>, <n>% sure" — a real reading from a real model, not a placeholder.
    await expect(page.getByText(/\d+% sure|\d+% de seguridad/i)).toBeVisible({ timeout: 120_000 })

    assertNothingEscaped(escapes)
  })

  test('rebalancing produces a second run, and the comparison names what changed (FR-010)', async ({
    page,
  }) => {
    test.setTimeout(900_000)
    const { escapes } = watchForEscapes(page)

    await newProject(page, 'Fairness compare')
    await addClass(page, 'Stripes')
    await addClass(page, 'Circles')
    await uploadInto(page, 'Stripes', MAJORITY)
    await uploadInto(page, 'Circles', MINORITY_FIRST)
    await train(page)

    await expect(page.getByTestId('imbalance-notice')).toBeVisible({ timeout: 60_000 })

    // With one run, the comparison says where the second will appear rather than
    // hiding itself — a learner told the lab keeps her runs should see where.
    await expect(page.getByText(/train a second time|entrena una segunda vez/i)).toBeVisible()

    // ── Rebalance: six more Circles, taking it from 2 to 8 against 8.
    await uploadInto(page, 'Circles', MINORITY_REST)
    await train(page)

    // FR-021 again, in the other direction: balanced now, so no notice.
    await expect(page.getByTestId('imbalance-notice')).toHaveCount(0)

    // ── FR-010 / Scenario 7.3: both runs' figures, and which classes changed.
    await expect(page.getByTestId('comparison-overall')).toBeVisible({ timeout: 60_000 })

    // Circles is the class she changed, so it must be named. "Something improved"
    // is exactly the uselessly vague answer the view exists to replace.
    //
    // The change it is named for is the photo count, not the accuracy: on this
    // separable fixture set both runs score ~100% on their own training photos, so
    // an accuracy-only comparison would report "nothing changed" to a learner who
    // had just quadrupled her minority class. That is the finding this test
    // produced, and `countChanged` is what fixed it.
    const summary = page.getByTestId('comparison-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText(/Circles/)
    await expect(page.getByTestId('delta-count-changed').first()).toContainText(
      /from 2 to 8|de 2 a 8/i,
    )

    // The counts are shown beside the accuracies too, which is what makes the
    // change legible as a consequence of what she did rather than as luck.
    await expect(page.getByText(/of 2$|de 2$/).first()).toBeVisible()
    await expect(page.getByText(/of 8$|de 8$/).first()).toBeVisible()

    assertNothingEscaped(escapes)
  })

  test('the export states its contents before producing a file (FR-022, Scenario 7.4)', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    const { escapes, requests } = watchForEscapes(page)

    await newProject(page, 'Export me')
    await addClass(page, 'Stripes')
    await addClass(page, 'Circles')
    await uploadInto(page, 'Stripes', MINORITY_FIRST)
    await uploadInto(page, 'Circles', ['class-circle-2.png', 'class-circle-3.png'])
    await train(page)

    await page.getByRole('button', { name: /export the model|exportar el modelo/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/none of your photos|ninguna de tus fotos/i)
    await expect(dialog).toContainText(/nothing is uploaded|no se sube nada/i)

    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /download it|descargarlo/i }).click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/^Export-me-model\.json$/)

    // The point of running this in a browser rather than only in jsdom: a real
    // `downloads://` save must not put a single byte on the wire. If `tf.io` ever
    // changed to POST the artifact somewhere, this is what would catch it.
    assertNothingEscaped(escapes)
    const uploads = requests.filter(
      (request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method()),
    )
    expect(
      uploads.map((request) => `${request.method()} ${request.url()}`),
      'exporting a model sent something over the network (FR-048, Principle I)',
    ).toEqual([])
  })
})
