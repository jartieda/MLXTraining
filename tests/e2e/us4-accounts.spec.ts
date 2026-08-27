import { test, expect, type Page } from '@playwright/test'
import {
  SEED,
  UNAVAILABLE_REASON,
  accountsAvailable,
  clearRateLimit,
  remoteRowTotals,
  removeAccount,
  seedInvitation,
  seedResetCode,
} from './helpers/accounts'
import { assertNothingEscaped, watchForEscapes } from './helpers/egress'

/**
 * T071 / US4 — Scenarios 4.1 to 4.8.
 *
 * Two of these carry more weight than the rest.
 *
 * **Scenario 4.7** is SC-014, and it depends on US1–US3 existing: an anonymous
 * visitor completes the whole capture-train-explain journey and *nothing* is
 * written on her behalf. It is asserted twice over — by counting every remote row
 * before and after, and by watching every request the page made — because the two
 * catch different failures. A row count catches a write; the request watcher
 * catches an attempt that a policy happened to refuse, which is a bug even when
 * the database saves us.
 *
 * **Scenario 4.6** is the one most likely to be "fixed" into a violation. A
 * project restored on a second device has no photos, and the tempting repair is to
 * sync them down. Principle I forbids that absolutely, so the test asserts the
 * explanation and the fresh-copy offer, and asserts that no image bytes crossed
 * the wire while it happened.
 *
 * Serial, and every account is unique per test. `fullyParallel` runs three browser
 * projects at once against one database, and the rate-limit ledger is global — five
 * failed attempts an hour, shared. Parallel refusal tests would exhaust it and the
 * failure would name the wrong cause.
 */

test.describe.configure({ mode: 'serial' })

/** Uniquified per project so the three browser projects cannot collide. */
function accountName(project: string, label: string): string {
  return `e2e-${project}-${label}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 24)
}

async function signIn(page: Page, credential: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/username|nombre de usuaria/i).fill(credential)
  await page.getByLabel(/^password$|^contraseña$/i).fill(password)
  await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
}

/** A minimal project with two classes and a trained model, via the upload path. */
async function trainAProject(page: Page, name: string): Promise<void> {
  await page.goto('/projects')
  await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
  await page.getByLabel(/project name|nombre del proyecto/i).fill(name)
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
    await expect(page.getByText(/added 3 photos|se han añadido 3 fotos/i)).toBeVisible({
      timeout: 60_000,
    })
  }

  await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
  await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 180_000 })
}

// ═════════════════════════════════════════ 4.7 — the anonymous visitor (SC-014)
//
// Runs with or without a database. Without one, the request watcher still holds,
// and that is the assertion FR-023 is really about: nothing is sent.

test.describe('Scenario 4.7 — an anonymous visitor is told nothing is saved', () => {
  test('states plainly that nothing will be saved, with no account anywhere', async ({ page }) => {
    await page.goto('/projects')

    await expect(page.getByRole('heading', { name: /you are not signed in|no has iniciado/i })).toBeVisible()
    await expect(page.getByText(/nothing will be saved|no se guardará nada/i)).toBeVisible()
    // FR-023 means the lab is reachable, not merely mentioned.
    await expect(page.getByRole('button', { name: /new project|nuevo proyecto/i })).toBeEnabled()
  })

  test('completes capture, train and both explanations with zero rows written', async ({ page }) => {
    test.setTimeout(900_000)
    const available = await accountsAvailable()
    const before = available ? await remoteRowTotals() : null

    const { escapes, requests } = watchForEscapes(page)

    await trainAProject(page, 'Anonymous journey')

    // Freeze a frame and run both explanations — the whole of US2 and US3.
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await expect(page.getByText(/frame frozen|imagen congelada/i)).toBeVisible()
    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()
    await expect(page.getByTestId('gradcam-description')).toBeVisible({ timeout: 180_000 })
    await expect(page.getByTestId('occlusion-description')).toBeVisible({ timeout: 400_000 })

    // Principle I, checked on every request the whole journey made.
    assertNothingEscaped(escapes)

    // SC-014's own wording: verified by inspecting stored data afterwards. The
    // request-level check above would miss a write that succeeded; this misses one
    // a policy refused. Both are defects, so both are asserted.
    if (before) {
      expect(await remoteRowTotals()).toEqual(before)
    } else {
      test.info().annotations.push({
        type: 'partial',
        description: `row-count half of SC-014 not asserted. ${UNAVAILABLE_REASON}`,
      })
    }

    // A mutating request to the account service is a finding even if it changed
    // nothing: an anonymous session must have nothing to say to it.
    const writes = requests.filter(
      (request) =>
        /\.supabase\.(co|in)|127\.0\.0\.1:54321|localhost:54321/.test(request.url()) &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method()),
    )
    expect(
      writes.map((request) => `${request.method()} ${request.url()}`),
      'an anonymous session wrote to the account service (FR-023, SC-014)',
    ).toEqual([])
  })
})

// ═════════════════════════════════════════ everything below needs a database

test.describe('accounts, invitations and restoration', () => {
  test.beforeAll(async () => {
    test.skip(!(await accountsAvailable()), UNAVAILABLE_REASON)
  })

  test.beforeEach(async () => {
    await clearRateLimit()
  })

  // ───────────────────────────────────────────────────────────── 4.1 and 4.8

  test('4.1 — redeeming an invitation makes the account usable at once', async ({ page }, info) => {
    const username = accountName(info.project.name, 'redeem')
    await removeAccount(username)
    const invitation = await seedInvitation(username)

    await page.goto('/redeem')
    await page.getByLabel(/username|nombre de usuaria/i).fill(username)
    await page.getByLabel(/invitation code|código de invitación/i).fill(invitation.code)
    await page.getByLabel(/choose a password|elige una contraseña/i).fill('a-good-password')
    await page.getByLabel(/type your password again|escribe otra vez/i).fill('a-good-password')
    await page.getByLabel(/display name|nombre visible/i).fill('Willow')
    await page.getByRole('button', { name: /create my account|crear mi cuenta/i }).click()

    // Scenario 4.1: usable immediately, and an empty project list.
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })
    await expect(page.getByText('Willow')).toBeVisible()
    await expect(page.getByText(/no projects yet|no tienes proyectos/i)).toBeVisible()

    // 4.8 / FR-025: the alias is on screen; the username she just typed is not.
    expect(await page.locator('body').innerText()).not.toContain(username)

    await removeAccount(username)
  })

  test('4.8 — her alias identifies her, and no view shows her username', async ({ page }) => {
    await signIn(page, SEED.learner1Username, SEED.password)
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    for (const route of ['/projects', '/lab', '/lessons', '/']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const text = await page.locator('body').innerText()
      expect(text, `${route} rendered a username (FR-025, SC-016)`).not.toContain(
        SEED.learner1Username,
      )
    }
    // And her alias is what she is called.
    await expect(page.getByText(SEED.learner1Alias).first()).toBeVisible()
  })

  // ─────────────────────────────────────────────────────────────────── 4.2

  test('4.2 — expired, already-redeemed and revoked are three distinguishable refusals', async ({
    page,
  }, info) => {
    const messages: string[] = []

    for (const state of ['expired', 'redeemed', 'revoked'] as const) {
      const username = accountName(info.project.name, `refuse-${state}`)
      await removeAccount(username)
      const invitation = await seedInvitation(username, state)

      await page.goto('/redeem')
      await page.getByLabel(/username|nombre de usuaria/i).fill(username)
      await page.getByLabel(/invitation code|código de invitación/i).fill(invitation.code)
      await page.getByLabel(/choose a password|elige una contraseña/i).fill('a-good-password')
      await page.getByLabel(/type your password again|escribe otra vez/i).fill('a-good-password')
      await page.getByLabel(/display name|nombre visible/i).fill('Willow')
      await page.getByRole('button', { name: /create my account|crear mi cuenta/i }).click()

      const alert = page.getByRole('alert')
      await expect(alert).not.toHaveText('', { timeout: 30_000 })
      messages.push((await alert.innerText()).trim())

      await removeAccount(username)
    }

    // Three different sentences, because the three call for different actions.
    expect(new Set(messages).size, `refusals were not distinguishable: ${messages.join(' | ')}`).toBe(3)
    for (const message of messages) {
      expect(message).toMatch(/ask your educator|pide otro a tu educadora/i)
    }
  })

  test('4.2 — a wrong code reads the same as a username that does not exist (SC-020)', async ({
    page,
  }, info) => {
    const real = accountName(info.project.name, 'oracle')
    await removeAccount(real)
    await seedInvitation(real)

    const messages: string[] = []
    // A real invitation with a wrong code, then a username with no invitation at
    // all. The database returns one constant for both, and the interface must not
    // pull them apart from what it knows about the input.
    for (const [username, code] of [
      [real, 'ZZZZZZ'],
      [accountName(info.project.name, 'ghost'), 'ZZZZZZ'],
    ] as const) {
      await page.goto('/redeem')
      await page.getByLabel(/username|nombre de usuaria/i).fill(username)
      await page.getByLabel(/invitation code|código de invitación/i).fill(code)
      await page.getByLabel(/choose a password|elige una contraseña/i).fill('a-good-password')
      await page.getByLabel(/type your password again|escribe otra vez/i).fill('a-good-password')
      await page.getByLabel(/display name|nombre visible/i).fill('Willow')
      await page.getByRole('button', { name: /create my account|crear mi cuenta/i }).click()

      const alert = page.getByRole('alert')
      await expect(alert).not.toHaveText('', { timeout: 30_000 })
      messages.push((await alert.innerText()).trim())
    }

    expect(messages[0]).toBe(messages[1])
    await removeAccount(real)
  })

  // ─────────────────────────────────────────────────────────────────── 4.3

  test('4.3 — a reset code restores access, and no email is sent to anyone', async ({
    page,
  }, info) => {
    const username = accountName(info.project.name, 'reset')
    await removeAccount(username)
    const invitation = await seedInvitation(username)

    // Redeem, so there is an account to reset.
    await page.goto('/redeem')
    await page.getByLabel(/username|nombre de usuaria/i).fill(username)
    await page.getByLabel(/invitation code|código de invitación/i).fill(invitation.code)
    await page.getByLabel(/choose a password|elige una contraseña/i).fill('first-password')
    await page.getByLabel(/type your password again|escribe otra vez/i).fill('first-password')
    await page.getByLabel(/display name|nombre visible/i).fill('Willow')
    await page.getByRole('button', { name: /create my account|crear mi cuenta/i }).click()
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })
    await page.getByRole('button', { name: /sign out|cerrar sesión/i }).click()

    const reset = await seedResetCode(username)
    const { escapes, requests } = watchForEscapes(page)

    await page.goto('/reset')
    // FR-030 / R16: the page says who can issue a code, and offers no mail form.
    await expect(page.getByText(/only your educator|solo tu educadora/i)).toBeVisible()
    await expect(page.getByLabel(/email|correo/i)).toHaveCount(0)

    await page.getByLabel(/username|nombre de usuaria/i).fill(username)
    await page.getByLabel(/reset code|código de restablecimiento/i).fill(reset.code)
    await page.getByLabel(/choose a password|elige una contraseña/i).fill('second-password')
    await page.getByLabel(/type your password again|escribe otra vez/i).fill('second-password')
    await page.getByRole('button', { name: /set my new password|poner mi contraseña/i }).click()

    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })
    assertNothingEscaped(escapes)

    // "No email is sent to anyone" is a claim about a channel that must not exist.
    // The only outbound destination in the whole exchange is the account service.
    const foreign = requests.filter((request) => {
      const url = new URL(request.url())
      const home = new URL(page.url())
      return url.origin !== home.origin && !/54321|\.supabase\.(co|in)/.test(url.host)
    })
    expect(foreign.map((request) => request.url())).toEqual([])

    // The old password is dead, the new one works.
    await page.getByRole('button', { name: /sign out|cerrar sesión/i }).click()
    await signIn(page, username, 'first-password')
    await expect(page.getByRole('alert')).not.toHaveText('', { timeout: 30_000 })
    await signIn(page, username, 'second-password')
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    await removeAccount(username)
  })

  // ─────────────────────────────────────────────────────────────────── 4.4

  test('4.4 — her password is nowhere in any view or export', async ({ page }, info) => {
    const username = accountName(info.project.name, 'secret')
    await removeAccount(username)
    const invitation = await seedInvitation(username)
    const password = 'quite-a-secret-password'

    await page.goto('/redeem')
    await page.getByLabel(/username|nombre de usuaria/i).fill(username)
    await page.getByLabel(/invitation code|código de invitación/i).fill(invitation.code)
    await page.getByLabel(/choose a password|elige una contraseña/i).fill(password)
    await page.getByLabel(/type your password again|escribe otra vez/i).fill(password)
    await page.getByLabel(/display name|nombre visible/i).fill('Willow')
    await page.getByRole('button', { name: /create my account|crear mi cuenta/i }).click()
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // Not in the rendered page, and not left in web storage where a shared
    // Chromebook's next user could read it.
    expect(await page.locator('body').innerText()).not.toContain(password)
    const stored = await page.evaluate(() => {
      const dump: string[] = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key) dump.push(`${key}=${localStorage.getItem(key) ?? ''}`)
      }
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index)
        if (key) dump.push(`${key}=${sessionStorage.getItem(key) ?? ''}`)
      }
      return dump.join('\n')
    })
    expect(stored, 'her password was left in web storage').not.toContain(password)

    await removeAccount(username)
  })

  // ─────────────────────────────────────────────────────────────── 4.5, 4.6

  test('4.5 — a returning learner finds her projects, classes, counts and model', async ({
    page,
  }) => {
    test.setTimeout(900_000)
    await signIn(page, SEED.learner1Username, SEED.password)
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    await trainAProject(page, 'Returning learner')

    await page.goto('/projects')
    await page.getByRole('button', { name: /sign out|cerrar sesión/i }).click()
    await expect(page.getByRole('link', { name: /^sign in$|^iniciar sesión$/i })).toBeVisible()

    await signIn(page, SEED.learner1Username, SEED.password)
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // FR-031 names four things and all four are asserted. Three are on the card.
    const card = page.getByRole('listitem').filter({ hasText: 'Returning learner' })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText(/2 classes|2 clases/)
    await expect(card).toContainText(/6 photos|6 fotos/)
    await expect(card).toContainText(/trained model ready|modelo entrenado y listo/i)

    // The fourth is the class NAMES, and a count is not a substitute: a
    // reconciliation that rebuilt the project from the remote row would restore
    // "2 classes" perfectly and lose "Stripes" and "Circles" entirely, because the
    // remote row holds no names. Only the lab can show they survived.
    await card.getByRole('link', { name: /open in the lab|abrir en el laboratorio/i }).click()
    await expect(page).toHaveURL(/\/lab\//, { timeout: 30_000 })
    await expect(page.getByText('Stripes')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Circles')).toBeVisible()
  })

  test('4.6 — on another device the lab explains why the photos are absent', async ({
    browser,
  }, info) => {
    test.setTimeout(900_000)
    const name = `Second device ${info.project.name}`

    // Device one: capture and train, which registers the remote metadata row.
    const first = await browser.newContext()
    const firstPage = await first.newPage()
    await signIn(firstPage, SEED.learner1Username, SEED.password)
    await expect(firstPage).toHaveURL(/\/projects$/, { timeout: 30_000 })
    await trainAProject(firstPage, name)
    await firstPage.goto('/projects')
    await expect(firstPage.getByText(name)).toBeVisible()
    await first.close()

    // Device two: a fresh context, so a fresh IndexedDB. Same account.
    const second = await browser.newContext()
    const secondPage = await second.newPage()
    const { escapes } = watchForEscapes(secondPage)

    await signIn(secondPage, SEED.learner1Username, SEED.password)
    await expect(secondPage).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // FR-032: an explanation, not an empty project presented as corrupted.
    const elsewhere = secondPage
      .getByRole('listitem')
      .filter({ hasText: name })
      .filter({ hasText: /stay on the device|se quedan en el dispositivo/i })
    await expect(elsewhere).toBeVisible({ timeout: 60_000 })
    await expect(elsewhere).toContainText(/2 classes and 6 photos|2 clases y 6 fotos/i)

    // Scenario 4.6: and an offer, which is the whole of what it can honestly do.
    await elsewhere.getByRole('button', { name: /fresh copy|copia nueva/i }).click()
    await expect(secondPage).toHaveURL(/\/lab\//, { timeout: 30_000 })

    // The photos did NOT follow the account, and nothing tried to fetch them.
    assertNothingEscaped(escapes)
    await second.close()
  })
})
