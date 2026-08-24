import { test, expect, type Page } from '@playwright/test'

/**
 * T039 / Acceptance Scenario 1.1, SC-002, SC-004.
 *
 * The complete US1 journey against the fake camera: two classes, photos in each,
 * Train, then a live prediction with per-class confidences.
 *
 * The assertion this exists for is **the confidences sum to 100%**. Scenario 1.1
 * requires it, and it is not cosmetic: rounding each probability independently
 * gives 33/33/33 or 34/34/33, and a learner who notices that the numbers do not
 * add up has been handed a reason to distrust every other figure the lab shows
 * her. `toWholePercentages` is what makes it true; this is what keeps it true.
 *
 * Runs at both viewports through the Playwright project matrix, so SC-004's
 * 360 px floor is covered by the same journey rather than by a separate mobile
 * test that drifts out of step with it (T111 adds the mobile-specific
 * assertions).
 *
 * The fake camera is fed a committed Y4M fixture (R13), so a run captures
 * deterministic frames rather than a black rectangle — without it, every accuracy
 * assertion here would be meaningless.
 */

const TRAIN_TIMEOUT_MS = 120_000

async function createProject(page: Page, name: string): Promise<void> {
  await page.goto('/projects')
  await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
  await page.getByLabel(/project name|nombre del proyecto/i).fill(name)
  await page.getByRole('button', { name: /^save$|^guardar$/i }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

async function addClass(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /add a class|añadir una clase/i }).click()
  await page.getByLabel(/class name|nombre de la clase/i).fill(name)
  await page.keyboard.press('Enter')
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

async function capture(page: Page, className: string, count: number): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(className, 'i') }).click()

  const one = page.getByRole('button', { name: /take one photo|hacer una foto/i })
  await expect(one).toBeEnabled({ timeout: 60_000 })

  for (let i = 0; i < count; i++) {
    await one.click()
    // Each click runs a backbone pass and an IndexedDB write. Waiting for the
    // announced count rather than sleeping keeps the test honest about what
    // actually completed.
    await expect(page.getByText(new RegExp(`saved \\d+ photos to ${className}|se han guardado`, 'i'))).toBeVisible({
      timeout: 30_000,
    })
  }
}

/**
 * Uploads through the file input after waiting for the control to be usable.
 *
 * The wait is not incidental: `Choose photos` is disabled until the backbone has
 * loaded, because every sample's embedding is computed at capture time (D4). A
 * learner cannot click a disabled button, so a test that sets the input directly
 * without waiting is testing something she could never do — and it was hiding a
 * genuine "why did nothing happen" question behind an assertion failure.
 */
async function upload(page: Page, className: string, files: readonly string[]): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(className, 'i') }).click()
  await expect(page.getByRole('button', { name: /choose photos|elegir fotos/i })).toBeEnabled({
    timeout: 120_000,
  })
  await page.locator('#upload-samples-input').setInputFiles([...files])
  await expect(
    page.getByText(new RegExp(`added ${String(files.length)} photos|se han a\u00f1adido ${String(files.length)} fotos`, 'i')),
  ).toBeVisible({ timeout: 60_000 })
}

test.describe('US1 — teach a model and watch it work', () => {
  test('captures into two classes, trains, and predicts with confidences summing to 100%', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    await createProject(page, 'Fruit test')

    // The lab, reached with NO ACCOUNT at all (FR-023). Nothing in this journey
    // signs in, which is itself part of what US1 claims.
    await addClass(page, 'Apple')
    await addClass(page, 'Pear')

    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()

    await capture(page, 'Apple', 5)
    await capture(page, 'Pear', 5)

    // Both classes have photos, so Train is available. Before this point it is
    // disabled with a message naming what is missing (Scenario 1.3, T038).
    const train = page.getByRole('button', { name: /^train$|^entrenar$/i })
    await expect(train).toBeEnabled()

    const startedAt = Date.now()
    await train.click()

    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: TRAIN_TIMEOUT_MS })
    const trainingMs = Date.now() - startedAt

    // SC-002 gives 30 s on a reference laptop for 3 classes x 30 samples. This is
    // 2 x 5 on CI hardware, so the budget is not asserted here — T126 measures it
    // on the reference machines. Reported so a regression that made training take
    // minutes is visible in the run output rather than only in a timeout.
    console.log(`training took ${String(trainingMs)} ms for 2 classes x 5 samples`)

    await page.getByRole('button', { name: /start guessing|empezar a adivinar/i }).click()

    // Every class has a meter, always — including one at 0% (FR-011).
    const meters = page.getByRole('meter')
    await expect(meters).toHaveCount(2)

    // Scenario 1.1: THE SUM. Read from the accessible value text, which is the
    // same string a learner sees next to each bar.
    await expect
      .poll(
        async () => {
          const texts = await meters.evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('aria-valuenow')),
          )
          return texts.reduce((total, value) => total + Number(value ?? 0), 0)
        },
        { timeout: 30_000, message: 'per-class confidences must sum to exactly 100%' },
      )
      .toBe(100)

    // And the leading class is NAMED, with its figure, in the live region — the
    // only route to the result for a learner who cannot see the bars (SC-009).
    await expect(
      page.getByText(/^(Apple|Pear), \d+% sure$|^(Apple|Pear), \d+% de seguridad$/),
    ).toBeVisible()
  })

  test('refuses to train with an empty class, and NAMES that class (Scenario 1.3)', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    await createProject(page, 'Refusal test')
    await addClass(page, 'Apple')
    await addClass(page, 'Pear')

    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await capture(page, 'Apple', 2)

    // "Pear" is empty. The message must say so by name — a learner facing four
    // classes and the words "not enough data" has to open each one to find out
    // which, and that is the difference between a refusal she can act on and one
    // she reads as the lab being broken.
    await expect(page.getByText(/"Pear"|«Pear»/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^train$|^entrenar$/i })).toBeDisabled()
  })

  test('works without a camera at all, through the upload path (FR-003)', async ({ page }) => {
    test.setTimeout(180_000)

    await createProject(page, 'Upload test')
    await addClass(page, 'Stripes')
    await addClass(page, 'Circles')

    // Never turns the camera on. FR-003 makes upload a first-class source, not a
    // fallback, and a learner on a school desktop with no webcam depends on it.
    await upload(page, 'Stripes', [
      'tests/fixtures/class-stripes-h-0.png',
      'tests/fixtures/class-stripes-h-1.png',
      'tests/fixtures/class-stripes-h-2.png',
    ])

    await upload(page, 'Circles', [
      'tests/fixtures/class-circle-0.png',
      'tests/fixtures/class-circle-1.png',
      'tests/fixtures/class-circle-2.png',
    ])

    const train = page.getByRole('button', { name: /^train$|^entrenar$/i })
    await expect(train).toBeEnabled()
    await train.click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: TRAIN_TIMEOUT_MS })
  })

  test('deletes a single photo without disturbing the others (FR-004)', async ({ page }) => {
    test.setTimeout(180_000)

    await createProject(page, 'Prune test')
    await addClass(page, 'Apple')
    await upload(page, 'Apple', [
      'tests/fixtures/class-circle-0.png',
      'tests/fixtures/class-circle-1.png',
      'tests/fixtures/class-circle-2.png',
    ])

    // The individual delete is what lets a learner remove the two burst frames
    // that caught her hand reaching in — the difference between fixing a shortcut
    // and recapturing the class.
    await expect(page.getByRole('img')).toHaveCount(3)
    await page.getByRole('button', { name: /delete photo 1|eliminar la foto 1/i }).click()
    await expect(page.getByRole('img')).toHaveCount(2)
    await expect(page.getByText(/2 photos|2 fotos/)).toBeVisible()
  })
})
