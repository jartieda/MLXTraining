import { test, expect } from '@playwright/test'
import { assertNothingEscaped, watchForEscapes } from './helpers/egress'

/**
 * T036 + T137 / SC-010 — the suites that run the egress watcher directly.
 *
 * The watcher itself is in `helpers/egress.ts`, because six other specs share it
 * and Playwright refuses to load a test file that imports another test file.
 */

test.describe('no image or model bytes leave the device', () => {
  test('the landing page and the anonymous routes send nothing', async ({ page }) => {
    const { escapes, requests } = watchForEscapes(page)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.getByRole('link', { name: /my projects|mis proyectos/i }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    assertNothingEscaped(escapes)

    // The floor. Without it, a build that failed to load any JavaScript at all
    // would pass this suite, and a gate that passes on a broken application is
    // worse than no gate.
    expect(
      requests.length,
      'the page made almost no requests, so this run asserted nothing',
    ).toBeGreaterThan(3)
  })

  /**
   * T137 / SC-010 — the complete journey, in one page lifetime.
   *
   * One test rather than several, deliberately. The watcher is per-page, and the
   * failure this exists to catch is a request made *somewhere* in a long session —
   * splitting the journey across pages would give each phase a fresh watcher and lose
   * exactly the cross-phase egress a real lesson would produce.
   *
   * It ends with the model export, which is the one place bytes legitimately leave the
   * browser. `downloads://` is a browser save rather than a network call, and asserting
   * that here is the check that the distinction is real rather than claimed.
   */
  test('the complete journey sends no image and no model (SC-010)', async ({ page }) => {
    test.setTimeout(1_800_000)
    const { escapes, requests } = watchForEscapes(page)

    // ── W1: capture and train, deliberately imbalanced so the figures and the
    // imbalance notice are exercised too.
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Full journey')
    await page.getByRole('button', { name: /^save$|^guardar$/i }).click()

    for (const [className, files] of [
      [
        'Stripes',
        [
          'class-stripes-h-0.png',
          'class-stripes-h-1.png',
          'class-stripes-h-2.png',
          'class-stripes-h-3.png',
        ],
      ],
      ['Circles', ['class-circle-0.png']],
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
      await expect(page.getByText(/added \d+ photos?/i)).toBeVisible({ timeout: 180_000 })
    }

    await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 600_000 })

    // ── W5 / US7: the figures, the confusion matrix and the imbalance notice.
    await expect(page.getByTestId('overall-accuracy')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('imbalance-notice')).toBeVisible({ timeout: 60_000 })

    // ── W2: live prediction against the camera, which is where a frame could most
    // easily be sent somewhere by accident.
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
    await page.getByRole('button', { name: /start guessing|empezar a adivinar/i }).click()
    await expect(page.getByText(/\d+% sure|\d+% de seguridad/i)).toBeVisible({ timeout: 300_000 })
    await page.getByRole('button', { name: /stop guessing|dejar de adivinar/i }).click()

    // ── W3: freeze, explain, and compare both methods.
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await expect(page.getByText(/frame frozen|imagen congelada/i)).toBeVisible()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByTestId('heatmap-description')).toBeVisible({ timeout: 600_000 })
    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()
    await expect(page.getByTestId('occlusion-description')).toBeVisible({ timeout: 900_000 })
    await expect(page.getByTestId('agreement')).toBeVisible()

    // ── The export: the one place bytes leave the browser at all, by a learner's own
    // explicit action to a destination she can see (FR-048). `downloads://` is a
    // browser save rather than a network call, and this is where that distinction is
    // checked rather than claimed.
    //
    // Done here, before leaving the lab, because the export needs the live model
    // handle. Reopening a project restores its figures and its status but not the
    // model itself — FR-031 asks for "trained-model status" and that is what it
    // restores — so the export is offered only in the session that trained it.
    await expect(page.getByRole('button', { name: /export the model/i })).toBeVisible({
      timeout: 60_000,
    })
    await page.getByRole('button', { name: /export the model/i }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('dialog').getByRole('button', { name: /download it/i }).click()
    await download

    // ── The lessons, which are the one place a learner's own words legitimately
    // cross the wire. Anonymous here, so nothing is written — the signed-in case is
    // covered by us5-learning-path.spec.ts, which runs this same watcher.
    await page.goto('/lessons/what-the-model-sees')
    await page.getByRole('textbox').first().fill('It used the background, I think.')
    await expect(page.getByTestId('lessons-anonymous')).toBeVisible()

    // ── The assertion SC-010 rests on, over every request of the whole session.
    assertNothingEscaped(escapes)

    // And a floor, so a run that silently did nothing cannot pass. A journey this
    // long fetches the application, the fonts and 5.4 MB of backbone weights.
    expect(
      requests.length,
      'the journey made too few requests to have actually happened',
    ).toBeGreaterThan(20)

    console.log(
      `\nT137 / SC-010: ${String(requests.length)} requests watched across the complete journey, ` +
        'zero image or model bytes leaving the device.\n',
    )
  })
})
