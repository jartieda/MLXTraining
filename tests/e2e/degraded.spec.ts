import { test, expect } from '@playwright/test'

/**
 * T120 / SC-012, FR-047, R7 — the WebGL-disabled run.
 *
 * The constitution requires the WASM fallback to be "exercised in testing, not merely
 * configured", and this is that exercise. It runs under the `chromium-nowebgl` project,
 * which launches with `--disable-gpu --disable-webgl --disable-webgl2`.
 *
 * SC-012 allows the degraded path to be **4× slower and no worse**. That budget is
 * measured and reported rather than asserted as a hard ceiling, and the reason is
 * honest: the reference figure it is 4× of is a mid-range laptop with WebGL, and this
 * runner is neither. Asserting a wall-clock number here would produce a test that
 * fails on a busy CI machine and gets disabled — which would cost more than it buys.
 * What it *does* assert is the part that cannot drift with hardware: **the whole
 * journey completes, with no capability removed.**
 *
 * That distinction is Principle IV's, not a convenience: "degrading speed rather than
 * removing capability". A fallback that quietly disabled the comparison view would
 * pass a timing assertion easily.
 */

/** SC-012's multiplier, and R4's accelerated budget, for the report. */
const SC012_MULTIPLIER = 4
const ACCELERATED_OCCLUSION_BUDGET_MS = 5000

test.describe('without WebGL (SC-012, FR-047)', () => {
  // `test.info()` rather than a fixture argument: `test.skip` at describe scope takes
  // a single-argument predicate, so the project name has to come from the runtime.
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== 'chromium-nowebgl',
      'This suite belongs to the chromium-nowebgl project (npm run test:e2e:nowebgl).',
    )
  })

  test('warns that things will be slower, and refuses nothing (FR-047)', async ({ page }) => {
    test.setTimeout(300_000)
    await page.goto('/lab')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    // FR-047 is warn-don't-refuse. The wording matters: a learner told "your device
    // is not supported" stops, and a learner told "this will be slower" carries on.
    await expect(
      page.getByText(/graphics acceleration is not available|no está disponible/i),
    ).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/everything still works|todo sigue funcionando/i)).toBeVisible()
  })

  test('completes the whole journey, with nothing removed', async ({ page }) => {
    test.setTimeout(1_800_000)

    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('No WebGL')
    await page.getByRole('button', { name: /^save$|^guardar$/i }).click()

    for (const [className, files] of [
      ['Stripes', ['class-stripes-h-0.png', 'class-stripes-h-1.png', 'class-stripes-h-2.png']],
      ['Circles', ['class-circle-0.png', 'class-circle-1.png', 'class-circle-2.png']],
    ] as const) {
      await page.getByRole('button', { name: /add a class|añadir una clase/i }).click()
      await page.getByLabel(/class name|nombre de la clase/i).fill(className)
      await page.keyboard.press('Enter')
      await page.getByRole('radio', { name: new RegExp(className, 'i') }).click()
      await expect(page.getByRole('button', { name: /choose photos|elegir fotos/i })).toBeEnabled({
        timeout: 300_000,
      })
      await page
        .locator('#upload-samples-input')
        .setInputFiles(files.map((file) => `tests/fixtures/${file}`))
      await expect(page.getByText(/added 3 photos/i)).toBeVisible({ timeout: 180_000 })
    }

    const trainStarted = Date.now()
    await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 600_000 })
    const trainMs = Date.now() - trainStarted

    // US7's figures still appear — the metrics run on the same backend.
    await expect(page.getByTestId('overall-accuracy')).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()

    // Grad-CAM, which needs gradients — the operation most likely to be missing on a
    // fallback backend.
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByTestId('heatmap-description')).toBeVisible({ timeout: 600_000 })

    // And BOTH methods, which is the capability a timing-only test would let a
    // fallback quietly drop (Principle III requires two).
    const occlusionStarted = Date.now()
    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()
    await expect(page.getByTestId('gradcam-description')).toBeVisible({ timeout: 600_000 })
    await expect(page.getByTestId('occlusion-description')).toBeVisible({ timeout: 900_000 })
    const occlusionMs = Date.now() - occlusionStarted

    await expect(page.getByTestId('agreement')).toBeVisible()

    // T118: the coarse grid should have kicked in, because the backend is not
    // accelerated. This is the adaptive budget doing its job on the exact device it
    // was written for.
    await expect(page.getByTestId('coarse-grid-note')).toBeVisible()

    // Reported, not asserted. See the file docstring: the 4× budget is relative to a
    // reference laptop this runner is not, and a wall-clock assertion here would be
    // a test that gets disabled rather than a target that gets met.
    console.log(
      [
        '',
        'SC-012 / R7 — WASM fallback timings on this runner:',
        `  training:  ${String(trainMs)} ms`,
        `  both maps: ${String(occlusionMs)} ms (accelerated budget ${String(ACCELERATED_OCCLUSION_BUDGET_MS)} ms,`,
        `             so SC-012 allows ${String(ACCELERATED_OCCLUSION_BUDGET_MS * SC012_MULTIPLIER)} ms on the reference Chromebook)`,
        '  T126 is where these are checked against the reference hardware.',
        '',
      ].join('\n'),
    )
  })
})
