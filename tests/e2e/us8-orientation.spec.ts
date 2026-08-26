import { test, expect } from '@playwright/test'

/**
 * T112 / US8 — Scenario 8.3. Rotate mid-session; lose nothing.
 *
 * What "rotation" actually is, in a browser, is a viewport resize. React does not
 * remount, so nothing in component state is lost by the rotation itself — which makes
 * this suite less about defending against loss and more about proving the two things
 * that *could* go wrong and would be invisible:
 *
 * 1. **The layout must still fit.** A landscape phone is 740×360, and 360 px of
 *    height with a camera preview in it is the tightest case in the product. The
 *    portrait assertions in `us8-mobile.spec.ts` say nothing about it.
 * 2. **Captured samples live in IndexedDB, not in a component.** So they must survive
 *    not merely a rotation but a full reload, which is the stronger claim and the one
 *    a learner actually relies on when a phone browser discards a backgrounded tab.
 *
 * The second is the reason this file reloads as well as rotates. A test that only
 * resized would pass against an implementation that held every sample in React state,
 * and that implementation would lose a lesson's work the first time iOS reclaimed the
 * tab.
 */

const PORTRAIT = { width: 360, height: 740 }
const LANDSCAPE = { width: 740, height: 360 }

test.describe('rotating mid-session', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) > PORTRAIT.width,
    'Rotation is a phone concern; run under the mobile project.',
  )

  test('samples survive rotation and a reload (Scenario 8.3)', async ({ page }) => {
    test.setTimeout(600_000)

    await page.setViewportSize(PORTRAIT)
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Rotation test')
    await page.getByRole('button', { name: /^save$|^guardar$/i }).click()

    await page.getByRole('button', { name: /add a class|añadir una clase/i }).click()
    await page.getByLabel(/class name|nombre de la clase/i).fill('Stripes')
    await page.keyboard.press('Enter')
    await page.getByRole('radio', { name: /Stripes/i }).click()
    await expect(page.getByRole('button', { name: /choose photos|elegir fotos/i })).toBeEnabled({
      timeout: 120_000,
    })
    await page
      .locator('#upload-samples-input')
      .setInputFiles(
        ['class-stripes-h-0.png', 'class-stripes-h-1.png', 'class-stripes-h-2.png'].map(
          (file) => `tests/fixtures/${file}`,
        ),
      )
    await expect(page.getByText(/added 3 photos/i)).toBeVisible({ timeout: 60_000 })

    const labUrl = page.url()

    // ── Rotate. Nothing should move but the layout.
    await page.setViewportSize(LANDSCAPE)
    await expect(page.getByText(/3 photos|3 fotos/).first()).toBeVisible({ timeout: 30_000 })

    // Landscape at 360 px of height is the tightest case in the product, and it
    // must still not scroll sideways.
    const landscapeOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(landscapeOverflow.scrollWidth).toBeLessThanOrEqual(landscapeOverflow.clientWidth + 1)

    // ── Rotate back, then reload. This is the stronger claim: the samples are in
    // IndexedDB, so they survive the tab being discarded, not just resized.
    await page.setViewportSize(PORTRAIT)
    await page.goto(labUrl)
    await expect(page.getByRole('radio', { name: /Stripes/i })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/3 photos|3 fotos/).first()).toBeVisible({ timeout: 60_000 })
  })

  test('a trained model and its figures survive a rotation', async ({ page }) => {
    test.setTimeout(900_000)

    await page.setViewportSize(PORTRAIT)
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Rotation trained')
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
        timeout: 120_000,
      })
      await page
        .locator('#upload-samples-input')
        .setInputFiles(files.map((file) => `tests/fixtures/${file}`))
      await expect(page.getByText(/added 3 photos/i)).toBeVisible({ timeout: 60_000 })
    }

    await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 300_000 })
    const accuracyBefore = await page.getByTestId('overall-accuracy').innerText()

    await page.setViewportSize(LANDSCAPE)

    // The model handle lives in the lab store, which a resize does not touch. The
    // figures are the visible proof it is still there.
    await expect(page.getByTestId('overall-accuracy')).toHaveText(accuracyBefore, {
      timeout: 30_000,
    })
    // And the export is still offered, which requires a live model handle rather
    // than only the stored metrics (FR-050).
    await expect(page.getByRole('button', { name: /export the model/i })).toBeVisible()
  })

  test('the figures survive a reload even though the model handle does not', async ({ page }) => {
    test.setTimeout(900_000)
    await page.setViewportSize(PORTRAIT)

    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Reload figures')
    await page.getByRole('button', { name: /^save$|^guardar$/i }).click()

    for (const [className, files] of [
      ['Stripes', ['class-stripes-h-0.png', 'class-stripes-h-1.png']],
      ['Circles', ['class-circle-0.png', 'class-circle-1.png']],
    ] as const) {
      await page.getByRole('button', { name: /add a class|añadir una clase/i }).click()
      await page.getByLabel(/class name|nombre de la clase/i).fill(className)
      await page.keyboard.press('Enter')
      await page.getByRole('radio', { name: new RegExp(className, 'i') }).click()
      await expect(page.getByRole('button', { name: /choose photos|elegir fotos/i })).toBeEnabled({
        timeout: 120_000,
      })
      await page
        .locator('#upload-samples-input')
        .setInputFiles(files.map((file) => `tests/fixtures/${file}`))
      await expect(page.getByText(/added 2 photos/i)).toBeVisible({ timeout: 60_000 })
    }

    await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 300_000 })

    const url = page.url()
    await page.goto(url)

    // The US7 fallback: `models.metrics` is in IndexedDB, so the figures come back
    // even though the in-memory model does not. Without it a learner returning to a
    // project would see "trained model ready" on the card and no figures at all.
    await expect(page.getByTestId('overall-accuracy')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('table')).toBeVisible()
  })
})
