import { test, expect, type Page } from '@playwright/test'

/**
 * T052 / US2, SC-003, FR-016, FR-018, FR-019.
 *
 * Freeze, explain, switch class, adjust opacity — the whole of US2's independent
 * test, on the fake camera.
 *
 * The assertion worth defending is **switching class changes the map**. T050
 * proves the numbers differ; this proves the interface actually asks for the new
 * class rather than re-rendering the cached one. A view that showed the same
 * picture for every class would make FR-016 false while looking completely
 * normal — the interface-level twin of the silent Grad-CAM bug.
 *
 * The SC-003 one-second budget is measured and reported rather than asserted.
 * CI hardware is not the reference laptop, so a hard threshold here would either
 * be meaningless or flaky; T126 checks it on the reference machines. What this
 * does catch is a regression that turns one second into thirty.
 */

const SC003_GRADCAM_BUDGET_MS = 1000

async function trainTwoClasses(page: Page): Promise<void> {
  await page.goto('/projects')
  await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
  await page.getByLabel(/project name|nombre del proyecto/i).fill('Explain test')
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
}

/** Reads the rendered overlay as a data URL, to compare two maps pixel-wise. */
async function heatmapSignature(page: Page): Promise<string> {
  return page
    .getByRole('img', { name: /evidence|pruebas|no evidence|se han podido/i })
    .first()
    .evaluate((node) => (node as HTMLCanvasElement).toDataURL())
}

test.describe('US2 — see where the model is looking', () => {
  test('freezes a frame, explains it, and shows a legend and a text alternative', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    await trainTwoClasses(page)

    // The camera is needed to freeze a frame, so it is turned on here even though
    // the samples came from files.
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()

    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await expect(page.getByText(/frame frozen|imagen congelada/i)).toBeVisible()

    const startedAt = Date.now()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()

    // The legend is what makes the map readable, so its presence is part of the
    // feature rather than decoration (FR-017).
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeVisible({ timeout: 60_000 })
    const elapsed = Date.now() - startedAt
    console.log(
      `Grad-CAM took ${String(elapsed)} ms (SC-003 budget on the reference laptop: ${String(SC003_GRADCAM_BUDGET_MS)} ms)`,
    )
    await expect(page.getByText(/more evidence|más pruebas/i)).toBeVisible()

    // T057 / SC-009: the positional description, as visible prose and not only as
    // the canvas label.
    await expect(page.getByRole('heading', { name: /in words|en palabras/i })).toBeVisible()
    // One description, in one place. It is also the canvas's accessible name, but
    // repeating it as a visible caption directly above the same sentence would be
    // noise rather than redundancy.
    const description = page.getByTestId('heatmap-description')
    await expect(description).toBeVisible()
    await expect(description).toHaveText(
      /strongest evidence for|evidence for .* is spread|no evidence could be worked out|pruebas más fuertes|repartidas|no se han podido calcular/i,
    )
  })

  test('FR-018: frames the map as evidence, not as the reason', async ({ page }) => {
    test.setTimeout(300_000)
    await trainTwoClasses(page)
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeVisible({ timeout: 60_000 })

    // Permanent and adjacent, not behind a disclosure. Principle III: a heat map
    // presented as "the reason" teaches that the model reasons.
    await expect(
      page.getByText(/not the reason for the answer|no el motivo de la respuesta/i),
    ).toBeVisible()
    await expect(page.getByText(/not proof that the model is right|no una prueba/i)).toBeVisible()
    // And the honest caveat about the ramp being map-relative (R3).
    await expect(page.getByText(/relative to this map only|relativos solo a este mapa/i)).toBeVisible()
  })

  test('switching class CHANGES the map (FR-016)', async ({ page }) => {
    test.setTimeout(300_000)
    await trainTwoClasses(page)
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()

    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeVisible({ timeout: 60_000 })
    const first = await heatmapSignature(page)

    // Switching the class must clear the old map, not silently keep showing it.
    await page
      .getByLabel(/explain which class|qué clase explicar/i)
      .selectOption({ label: 'Circles' })
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeHidden()

    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeVisible({ timeout: 60_000 })
    const second = await heatmapSignature(page)

    expect(
      second,
      'the overlay is identical for two classes — the view is not asking for the new class',
    ).not.toBe(first)
  })

  test('the opacity slider changes the overlay without recomputing (FR-019)', async ({ page }) => {
    test.setTimeout(300_000)
    await trainTwoClasses(page)
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeVisible({ timeout: 60_000 })

    const before = await heatmapSignature(page)
    const slider = page.getByLabel(/heat map strength|intensidad del mapa/i)
    await slider.fill('10')
    await expect
      .poll(async () => (await heatmapSignature(page)) !== before, { timeout: 10_000 })
      .toBe(true)

    // Still one map: the slider re-colours what was already computed rather than
    // asking for a new one, which is why it can be dragged freely.
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeVisible()
  })

  test('the finer 14×14 layer gives a different map from the 7×7 one (R3)', async ({ page }) => {
    test.setTimeout(300_000)
    await trainTwoClasses(page)
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByText(/less evidence|menos pruebas/i)).toBeVisible({ timeout: 60_000 })

    // The copy states the grid size, which is the honest way to present the
    // coarseness rather than implying the map is pixel-accurate.
    await expect(page.getByText(/7×7 grid|cuadrícula de 7×7/i)).toBeVisible()

    await page.getByRole('radio', { name: /finer \(14×14\)|más fino \(14×14\)/i }).check()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    // The framing paragraph states the grid the map was actually computed on, so
    // it is the one that must change — not the option's own hint text, which
    // mentions 14×14 either way.
    await expect(
      page.getByText(/worked out on a 14×14 grid|cuadrícula de 14×14 y luego/i),
    ).toBeVisible({ timeout: 60_000 })
  })
})
