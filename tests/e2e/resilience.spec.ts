import { test, expect, type Page } from '@playwright/test'

/**
 * T121, T122 / FR-049, D7, Edge Cases — storage pressure and offline behaviour.
 *
 * Both of these are about the same thing: **the lab holds the only copy of a learner's
 * work.** Nothing is backed up — that is the privacy design, not an omission — so a
 * silent quota failure or a session expiry that locks her out of her own device is
 * unrecoverable in a way almost no other web application's bugs are.
 *
 * The storage thresholds are exercised by overriding `navigator.storage.estimate`,
 * because filling a real origin quota takes minutes and leaves the machine dirty. That
 * is a genuine limitation and worth naming: it tests the interface's *response* to
 * pressure, not the browser's behaviour under it. D7's mid-burst quota error — the part
 * where samples are actually at risk — is exercised against the real IndexedDB in
 * `tests/unit/db.test.ts` instead, which can inject a `QuotaExceededError` at an exact
 * write.
 */

/** FR-049's two thresholds. */
const WARN_RATIO = 0.8
const REFUSE_RATIO = 0.95

/** Replaces `navigator.storage.estimate` before any application code runs. */
async function fakeQuota(page: Page, ratio: number): Promise<void> {
  await page.addInitScript((usedRatio: number) => {
    const quota = 1_000_000_000
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: () => Promise.resolve({ quota, usage: Math.round(quota * usedRatio) }),
        persist: () => Promise.resolve(true),
        persisted: () => Promise.resolve(true),
      },
    })
  }, ratio)
}

/** Removes the API entirely, which is the D6 "unknown" case. */
async function noQuotaApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  })
}

test.describe('storage pressure (T121, FR-049)', () => {
  test('says nothing at all when there is plenty of room', async ({ page }) => {
    await fakeQuota(page, 0.2)
    await page.goto('/projects')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    // The indicator is present but silent. A warning at 20% would teach her to ignore
    // the one at 80%, which is the warning that matters.
    await expect(page.getByText(/delete a project you have finished with/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /new project|nuevo proyecto/i })).toBeEnabled()
  })

  test('warns at 80%, on the page where she can act on it', async ({ page }) => {
    await fakeQuota(page, WARN_RATIO + 0.02)
    await page.goto('/projects')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    await expect(page.getByText(/you have used 82%/i)).toBeVisible({ timeout: 30_000 })
    // Named remedy, not a bare percentage: "delete a project you have finished with"
    // is something a 13-year-old can do, and "82% full" is not.
    await expect(page.getByText(/delete a project you have finished with/i)).toBeVisible()
    // A warning is not a refusal. She can still create and still capture at 82%.
    await expect(page.getByRole('button', { name: /new project|nuevo proyecto/i })).toBeEnabled()
  })

  test('refuses new captures at 95%, and says how to make room', async ({ page }) => {
    await fakeQuota(page, REFUSE_RATIO + 0.01)
    await page.goto('/projects')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    const refusal = page.getByRole('alert').filter({ hasText: /not enough space/i })
    await expect(refusal).toBeVisible({ timeout: 30_000 })
    // Refusing BEFORE she captures forty photos is the whole point: the alternative is
    // a quota error partway through a burst, and the loss is unrecoverable.
    await expect(page.getByRole('button', { name: /new project|nuevo proyecto/i })).toBeDisabled()
  })

  test('says it does not know rather than guessing, where the API is absent (D6)', async ({
    page,
  }) => {
    await noQuotaApi(page)
    await page.goto('/projects')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    // Guessing would either block a learner with plenty of room or teach her to
    // ignore the warning that matters. Neither is acceptable, so it abstains.
    await expect(page.getByText(/will not say how much space is left/i)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('button', { name: /new project|nuevo proyecto/i })).toBeEnabled()
  })
})

test.describe('offline and an expired session (T122, Edge Cases)', () => {
  test('local projects stay fully usable with the network down', async ({ page, context }) => {
    test.setTimeout(900_000)

    // Build something first, while online.
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Offline project')
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
      await expect(page.getByText(/added 3 photos/i)).toBeVisible({ timeout: 120_000 })
    }

    // ── Now cut the network. The backbone is cached and IndexedDB is local, so
    // everything from here should still work. This is the claim the Edge Cases
    // section makes and the one a school's connection tests every lesson.
    await context.setOffline(true)

    await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 600_000 })
    await expect(page.getByTestId('overall-accuracy')).toBeVisible({ timeout: 60_000 })

    // Both explanations too, so the whole of Principle III survives the network
    // going away — nothing in either method touches it.
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByTestId('heatmap-description')).toBeVisible({ timeout: 600_000 })

    // NOT asserted: a reload while offline. That needs a service worker caching the
    // shell and 5.4 MB of backbone weights, which this project does not ship — the
    // Edge Case asks for offline *continuity*, not offline install. A learner who
    // reloads with no connection gets the browser's own error page, and saying so
    // here is more useful than a test that quietly implied otherwise.
    await context.setOffline(false)
  })

  test('shows no sync notice to an anonymous visitor', async ({ page, context }) => {
    await page.goto('/projects')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    await context.setOffline(true)
    // Nothing was going to be saved remotely anyway (FR-023), and she already has the
    // projects banner saying so — a second notice about syncing would be noise about
    // something that does not apply to her.
    await expect(page.getByTestId('offline-notice')).toHaveCount(0)
    // And she is not blocked: the whole journey is local.
    await expect(page.getByRole('button', { name: /new project|nuevo proyecto/i })).toBeEnabled()

    await context.setOffline(false)
  })

  test('an expired session does not lock her out of her own device', async ({ page }) => {
    test.setTimeout(300_000)

    // Build something as an anonymous visitor, then plant a corrupt session token.
    // A learner whose stored token has expired must not lose her local work — and the
    // failure mode this guards against is a bootstrap that throws and takes the whole
    // application down with it.
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Expired session')
    await page.getByRole('button', { name: /^save$|^guardar$/i }).click()
    await expect(page).toHaveURL(/\/lab\//, { timeout: 60_000 })

    await page.evaluate(() => {
      localStorage.setItem(
        'ml4g.auth',
        JSON.stringify({
          access_token: 'expired.and.invalid',
          refresh_token: 'also-invalid',
          expires_at: 1,
          token_type: 'bearer',
          user: { id: '00000000-0000-4000-a000-00000000dead' },
        }),
      )
    })

    await page.goto('/projects')
    // The application still loads, and her local project is still listed. An
    // anonymous-owner project is hers on this device regardless of any token.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Expired session')).toBeVisible({ timeout: 60_000 })

    // And the session resolves to anonymous rather than to a half-open signed-in
    // state, so the "nothing will be saved" banner is honest about where she stands.
    await expect(page.getByRole('heading', { name: /you are not signed in/i })).toBeVisible({
      timeout: 60_000,
    })
  })

  test('a malformed stored session does not take the application down', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      // Not JSON at all. `bootstrapSession` runs before the first paint, so an
      // unhandled throw here would be a blank page for a learner whose storage was
      // corrupted by a crash — with her IndexedDB work sitting intact behind it.
      localStorage.setItem('ml4g.auth', '{{{not json')
    })

    await page.goto('/projects')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: /new project|nuevo proyecto/i })).toBeEnabled()
  })
})
