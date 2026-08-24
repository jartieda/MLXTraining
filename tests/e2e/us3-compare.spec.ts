import { test, expect, type Page } from '@playwright/test'

/**
 * T063 / US3, FR-014, FR-015, FR-018, SC-003.
 *
 * Both methods on one frozen frame, an agreement figure, and a cancellable
 * occlusion pass.
 *
 * The assertion that matters most is the last one: **the two maps are never
 * blended, and a disagreement is stated rather than smoothed over** (FR-018).
 * Averaging two maps is the obvious thing to build — it produces a single prettier
 * picture — and it destroys the only finding that matters, because when two
 * independent methods disagree the disagreement IS the result.
 *
 * SC-003's five-second occlusion budget is measured and reported, not asserted:
 * headless Chromium here has no GPU, and R4's budget assumes WebGL. What this run
 * catches is a regression from seconds to minutes.
 */

const SC003_OCCLUSION_BUDGET_MS = 5000

async function trainAndFreeze(page: Page): Promise<void> {
  await page.goto('/projects')
  await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
  await page.getByLabel(/project name|nombre del proyecto/i).fill('Compare test')
  await page.getByRole('button', { name: /^save$|^guardar$/i }).click()

  for (const [name, files] of [
    ['Stripes', ['class-stripes-h-0.png', 'class-stripes-h-1.png', 'class-stripes-h-2.png']],
    ['Circles', ['class-circle-0.png', 'class-circle-1.png', 'class-circle-2.png']],
  ] as const) {
    await page.getByRole('button', { name: /add a class|añadir una clase/i }).click()
    await page.getByLabel(/class name|nombre de la clase/i).fill(name)
    await page.keyboard.press('Enter')
    await page.getByRole('radio', { name: new RegExp(name, 'i') }).click()
    await expect(page.getByRole('button', { name: /choose photos|elegir fotos/i })).toBeEnabled({
      timeout: 120_000,
    })
    await page
      .locator('#upload-samples-input')
      .setInputFiles(files.map((file) => `tests/fixtures/${file}`))
    await expect(page.getByText(/added 3 photos|se han añadido 3 fotos/i)).toBeVisible({
      timeout: 60_000,
    })
  }

  await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
  await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 120_000 })

  await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
  await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
  await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
  await expect(page.getByText(/frame frozen|imagen congelada/i)).toBeVisible()
}

test.describe('US3 — compare two explanations', () => {
  test('renders BOTH maps and an agreement figure for the same frame', async ({ page }) => {
    test.setTimeout(600_000)
    await trainAndFreeze(page)

    const startedAt = Date.now()
    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()

    // Grad-CAM lands first and is shown immediately, rather than the view waiting
    // for the slow method before rendering anything.
    await expect(page.getByTestId('gradcam-description')).toBeVisible({ timeout: 120_000 })

    await expect(page.getByTestId('occlusion-description')).toBeVisible({ timeout: 300_000 })
    const elapsed = Date.now() - startedAt
    console.log(
      `both methods took ${String(elapsed)} ms (SC-003 budgets occlusion at ${String(SC003_OCCLUSION_BUDGET_MS)} ms on the reference laptop, with WebGL)`,
    )

    // Two maps, separately. Not one blended picture.
    await expect(page.getByTestId('agreement')).toBeVisible()
    await expect(page.getByTestId('agreement-band')).toBeVisible()

    // And the honest note about why they are side by side (FR-018).
    await expect(
      page.getByText(/shown separately, side by side, on purpose|por separado, uno al lado del otro/i),
    ).toBeVisible()
  })

  test('states a disagreement explicitly rather than picking a winner (FR-018)', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    await trainAndFreeze(page)
    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()
    await expect(page.getByTestId('agreement-band')).toBeVisible({ timeout: 300_000 })

    const band = await page.getByTestId('agreement-band').textContent()

    // Whichever band this frame produces, the RULE is what is asserted: a
    // disagreement carries the explicit "neither is guaranteed right" statement,
    // and the other bands do not claim one map is correct either.
    if (/disagree|no coinciden/i.test(band ?? '')) {
      const warning = page.getByTestId('disagreement-warning')
      await expect(warning).toBeVisible()
      await expect(warning).toHaveText(
        /NEITHER of them is guaranteed to be right|NINGUNO de los dos tiene garantizado/i,
      )
      // And it explicitly refuses to choose or average.
      await expect(warning).toHaveText(
        /not going to pick one for you or average them|no va a elegir uno por ti ni a promediarlos/i,
      )
    } else {
      // Agreement is never presented as proof.
      await expect(page.getByTestId('disagreement-warning')).toBeHidden()
      expect(band).toMatch(/mostly agree|partly agree|coinciden/i)
    }

    // In every case, exactly two canvases — never a third, blended one.
    const canvases = page.locator('canvas[role="img"]')
    await expect(canvases).toHaveCount(3) // the frozen frame + one map per method
  })

  test('occlusion reports progress and can be cancelled (Scenario 3.3)', async ({ page }) => {
    test.setTimeout(600_000)
    await trainAndFreeze(page)

    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()

    // 144 forward passes is long enough that progress is the only thing standing
    // between a learner and the belief that the lab has hung.
    const bar = page.getByRole('progressbar')
    await expect(bar).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText(/covering square \d+ of 144|tapando el cuadrado \d+ de 144/i)).toBeVisible({
      timeout: 120_000,
    })

    await page.getByRole('button', { name: /^stop$|^detener$/i }).click()
    await expect(page.getByText(/stopped\. nothing was lost|detenido\. no se ha perdido nada/i)).toBeVisible({
      timeout: 60_000,
    })

    // Cancelling costs nothing: the Grad-CAM map that already landed is still there.
    await expect(page.getByTestId('gradcam-description')).toBeVisible()
  })

  test('the second run is served from the cache, so switching back is instant (D8)', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    await trainAndFreeze(page)

    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()
    await expect(page.getByTestId('occlusion-description')).toBeVisible({ timeout: 300_000 })

    // A learner in this view switches class and method repeatedly on one frozen
    // frame. Recomputing a 144-pass sweep each time would make it feel broken,
    // which is what the D8 cache exists to prevent.
    const startedAt = Date.now()
    await page.getByRole('button', { name: /work them out again|calcularlos otra vez/i }).click()
    await expect(page.getByTestId('occlusion-description')).toBeVisible({ timeout: 120_000 })
    const cachedMs = Date.now() - startedAt

    console.log(`cached re-run took ${String(cachedMs)} ms`)
    expect(cachedMs, 'a cached re-run should not repeat 144 forward passes').toBeLessThan(15_000)
  })
})
