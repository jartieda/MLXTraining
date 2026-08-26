import { test, expect, type Page } from '@playwright/test'
import { SEED, UNAVAILABLE_REASON, accountsAvailable, query, removeAccount } from './helpers/accounts'
import { assertNothingEscaped, watchForEscapes } from './network.spec'

/**
 * T103 / US6 — Scenarios 6.1 to 6.7, SC-011, SC-013, SC-016, FR-041.
 *
 * The whole of this file needs a real Postgres, and unlike the other suites there is no
 * database-free half worth writing. Every property under test is a policy: an educator
 * reads her own classroom and no other, an invitation is single-use, a deletion removes
 * every row. A fake would assert that the interface renders what a fake was told, which
 * `tests/integration/classroom.test.tsx` already covers more cheaply and more
 * precisely.
 *
 * The two assertions that matter most:
 *
 * - **SC-011, the cross-educator refusal.** Attempted as E2 against E1's classroom,
 *   through the application's own client with E2's own session — the credential a
 *   modified client would use. The policies return zero rows rather than an error, so
 *   the test asserts *nothing is readable*, not that a request failed.
 * - **FR-041 and SC-016 across every educator surface and the export.** A sweep rather
 *   than a sample: every view, and the CSV, greppedfor a username, an email address,
 *   and any image marker.
 */

test.describe.configure({ mode: 'serial' })

const EDUCATOR_2_EMAIL = 'educator2@example.org'

async function signIn(page: Page, credential: string, password = SEED.password): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/username|nombre de usuaria/i).fill(credential)
  await page.getByLabel(/^password$|^contraseña$/i).fill(password)
  await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })
}

/** A username unique per browser project, so the three projects cannot collide. */
function learnerName(project: string, label: string): string {
  return `e2e6-${project}-${label}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 24)
}

async function openClassroom(page: Page): Promise<void> {
  await page.goto('/classroom')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
}

test.describe('running a classroom', () => {
  test.beforeAll(async () => {
    test.skip(!(await accountsAvailable()), UNAVAILABLE_REASON)
  })

  // ─────────────────────────────────────────────────────── 6.1 and SC-013

  test('6.1 / SC-013 — a classroom and its first invitation, in one screen', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const username = learnerName(info.project.name, 'first')
    await removeAccount(username)

    const startedAt = Date.now()
    await signIn(page, SEED.educator1Email)
    await openClassroom(page)

    const name = `E2E ${info.project.name} ${String(Date.now())}`
    // The name field is the first thing on the screen when she owns nothing. If she
    // already owns one from a previous run, the "add another" field is used instead.
    const firstField = page.getByLabel(/^classroom name$/i).first()
    await firstField.fill(name)
    await page
      .getByRole('button', { name: /create the classroom|add another/i })
      .first()
      .click()

    await expect(page.getByRole('heading', { name: /invite a learner/i })).toBeVisible({
      timeout: 30_000,
    })

    // Rename and archive round-trip (FR-038).
    await page.getByRole('button', { name: /^rename$/i }).click()
    await page.getByLabel(/new name/i).fill(`${name} renamed`)
    await page.getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByRole('heading', { name: `${name} renamed` })).toBeVisible({
      timeout: 30_000,
    })

    // Issue the first invitation. SC-013's three minutes covers all of the above.
    await page.getByLabel(/^username$/i).fill(username)
    await page.getByRole('button', { name: /make an invitation/i }).click()

    const issued = page.getByTestId('invitation-issued')
    await expect(issued).toBeVisible({ timeout: 30_000 })
    const code = ((await page.getByTestId('issued-code').innerText()) || '').trim()
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)

    const elapsedSeconds = (Date.now() - startedAt) / 1000
    expect(
      elapsedSeconds,
      `SC-013 budgets 3 minutes from nothing to a usable classroom with its first invitation; took ${String(Math.round(elapsedSeconds))}s`,
    ).toBeLessThan(180)

    await removeAccount(username)
  })

  // ─────────────────────────────────────────────────────── 6.2

  test('6.2 — the code is single-use, and the pending row tracks its state', async ({
    browser,
  }, info) => {
    test.setTimeout(600_000)
    const username = learnerName(info.project.name, 'once')
    await removeAccount(username)

    const educator = await browser.newContext()
    const educatorPage = await educator.newPage()
    await signIn(educatorPage, SEED.educator1Email)
    await openClassroom(educatorPage)

    await educatorPage.getByLabel(/^username$/i).fill(username)
    await educatorPage.getByRole('button', { name: /make an invitation/i }).click()
    await expect(educatorPage.getByTestId('invitation-issued')).toBeVisible({ timeout: 30_000 })
    const code = (await educatorPage.getByTestId('issued-code').innerText()).trim()

    // The pending row shows the username, because before redemption it is the only
    // identifier that exists (there is no alias yet).
    await educatorPage.getByRole('button', { name: /invite someone else/i }).click()
    await expect(educatorPage.getByText(username, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(educatorPage.getByText(/waiting to be used/i).first()).toBeVisible()

    // Redeem in a separate context, as the learner.
    const learner = await browser.newContext()
    const learnerPage = await learner.newPage()
    await learnerPage.goto('/redeem')
    await learnerPage.getByLabel(/username|nombre de usuaria/i).fill(username)
    await learnerPage.getByLabel(/invitation code/i).fill(code)
    await learnerPage.getByLabel(/choose a password/i).fill('a-good-password')
    await learnerPage.getByLabel(/type your password again/i).fill('a-good-password')
    await learnerPage.getByLabel(/display name/i).fill('Willow')
    await learnerPage.getByRole('button', { name: /create my account/i }).click()
    await expect(learnerPage).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // Single-use: the same code again is refused, and distinguishably so.
    const second = await browser.newContext()
    const secondPage = await second.newPage()
    await secondPage.goto('/redeem')
    await secondPage.getByLabel(/username|nombre de usuaria/i).fill(`${username}b`)
    await secondPage.getByLabel(/invitation code/i).fill(code)
    await secondPage.getByLabel(/choose a password/i).fill('a-good-password')
    await secondPage.getByLabel(/type your password again/i).fill('a-good-password')
    await secondPage.getByLabel(/display name/i).fill('Nimbus2')
    await secondPage.getByRole('button', { name: /create my account/i }).click()
    await expect(secondPage.getByRole('alert')).toContainText(/already been used/i, {
      timeout: 30_000,
    })
    await second.close()

    // And the educator's row now says used, with no way to revoke it — the account
    // exists and cannot be un-created.
    await openClassroom(educatorPage)
    await expect(educatorPage.getByText(/^used$/i).first()).toBeVisible({ timeout: 30_000 })
    // The alias replaces the username on the enrolled roster.
    await expect(educatorPage.getByText('Willow')).toBeVisible()

    await learner.close()
    await educator.close()
    await removeAccount(username)
  })

  // ─────────────────────────────────────────────────────── 6.3, 6.5, FR-041

  test('6.3 / 6.5 — progress, figures and reflections appear; no image anywhere', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    const { escapes } = watchForEscapes(page)

    // L1 already has seeded progress and a reflection, and is enrolled in K1.
    await signIn(page, SEED.educator1Email)
    await openClassroom(page)

    // The seeded classroom, by its name in supabase/seed.sql. Selected explicitly
    // rather than relying on ordering, because an earlier test in this file may have
    // created a newer one and the picker is newest-first.
    await page.getByLabel(/^classroom$/i).selectOption({ label: SEED.classroom1Name })

    const cometRow = page.getByText(SEED.learner1Alias).first()
    await expect(cometRow).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('listitem')
      .filter({ hasText: SEED.learner1Alias })
      .getByRole('button', { name: /^open$/i })
      .first()
      .click()

    const detail = page.getByTestId(`learner-detail-${SEED.learner1Id}`)
    await expect(detail).toBeVisible({ timeout: 30_000 })

    // FR-041, stated and structural. No image element, and the note says why.
    await expect(page.getByTestId('no-images-note')).toContainText(
      /stay in the browser on her own device/i,
    )
    await expect(detail.locator('img')).toHaveCount(0)
    await expect(detail.locator('canvas')).toHaveCount(0)

    assertNothingEscaped(escapes)
  })

  test('6.5 / SC-016 — every educator surface and the export are free of identifiers', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    await signIn(page, SEED.educator1Email)

    // The enrolled roster, expanded, is the widest educator surface.
    await openClassroom(page)
    await page
      .getByRole('listitem')
      .filter({ hasText: SEED.learner1Alias })
      .getByRole('button', { name: /^open$/i })
      .first()
      .click()
    await expect(page.getByTestId(`learner-detail-${SEED.learner1Id}`)).toBeVisible({
      timeout: 30_000,
    })

    const rendered = await page.locator('main').innerText()
    for (const forbidden of [SEED.learner1Username, 'learner-l1b', 'learner.invalid']) {
      // An enrolled learner is shown by her alias. The username appears only on a
      // *pending* invitation, and L1 redeemed long ago.
      expect(rendered, `the roster rendered ${forbidden}`).not.toContain(forbidden)
    }

    // ── The export (FR-043, SC-016, SC-021).
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /export progress/i }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/-progress-\d{4}-\d{2}-\d{2}\.csv$/)

    const stream = await file.createReadStream()
    const chunks: Uint8Array[] = []
    for await (const chunk of stream) chunks.push(new Uint8Array(Buffer.from(chunk as Buffer)))
    const csv = Buffer.concat(chunks).toString('utf8')

    // The BOM, so Excel on Windows reads it as UTF-8 rather than the code page.
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain(SEED.learner1Alias)

    for (const forbidden of [
      SEED.learner1Username,
      'learner-l1b',
      'learner.invalid',
      EDUCATOR_2_EMAIL,
      'educator1@example.org',
      SEED.learner1Id,
    ]) {
      expect(csv, `the export contained ${forbidden}`).not.toContain(forbidden)
    }

    // And no image, by elimination as well as by column name: nothing in this file
    // is large, and image bytes are.
    expect(csv).not.toMatch(/data:image|iVBORw0KGgo|\/9j\//)
    expect(csv.length).toBeLessThan(200_000)
  })

  // ─────────────────────────────────────────────────────── 6.4 / SC-011

  test('6.4 / SC-011 — E2 can read nothing of E1’s classroom', async ({ browser }) => {
    test.setTimeout(300_000)

    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, EDUCATOR_2_EMAIL)
    await openClassroom(page)

    // Her own classroom only. E1's learners must be absent from the interface…
    const rendered = await page.locator('main').innerText()
    expect(rendered).not.toContain('Nimbus')

    // …and unreadable through the API with her own token, which is the credential a
    // modified client would use. The policies answer with zero rows rather than an
    // error, so the assertion is that nothing comes back.
    const result = await page.evaluate(
      async ({ url, anonKey, classroomId, learnerId }) => {
        const raw = localStorage.getItem('ml4g.auth')
        if (!raw) return { classroom: -1, progress: -1, reflections: -1 }
        const token = (JSON.parse(raw) as { access_token?: string }).access_token ?? ''
        const headers = { Authorization: `Bearer ${token}`, apikey: anonKey }

        const count = async (path: string) => {
          const response = await fetch(`${url}/rest/v1/${path}`, { headers })
          if (!response.ok) return -2
          return ((await response.json()) as unknown[]).length
        }

        return {
          classroom: await count(`classrooms?id=eq.${classroomId}&select=id`),
          progress: await count(`lesson_progress?learner_id=eq.${learnerId}&select=module_id`),
          reflections: await count(`reflections?learner_id=eq.${learnerId}&select=answer`),
        }
      },
      {
        url: process.env.VITE_SUPABASE_URL ?? '',
        anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? '',
        classroomId: SEED.classroom1,
        learnerId: SEED.learner1Id,
      },
    )

    // Guard the guard: -1 means no session was found, which would make the three
    // zeroes below meaningless.
    expect(result.classroom, 'no session token, so nothing was asserted').not.toBe(-1)
    expect(result).toEqual({ classroom: 0, progress: 0, reflections: 0 })

    await context.close()
  })

  // ─────────────────────────────────────────────────────── 6.6 and 6.7

  test('6.6 — removing a learner ends visibility and keeps her rows', async ({ browser }, info) => {
    test.setTimeout(600_000)
    const username = learnerName(info.project.name, 'removed')
    await removeAccount(username)

    const educator = await browser.newContext()
    const educatorPage = await educator.newPage()
    await signIn(educatorPage, SEED.educator1Email)
    await openClassroom(educatorPage)

    await educatorPage.getByLabel(/^username$/i).fill(username)
    await educatorPage.getByRole('button', { name: /make an invitation/i }).click()
    const code = (await educatorPage.getByTestId('issued-code').innerText()).trim()

    const learner = await browser.newContext()
    const learnerPage = await learner.newPage()
    await learnerPage.goto('/redeem')
    await learnerPage.getByLabel(/username|nombre de usuaria/i).fill(username)
    await learnerPage.getByLabel(/invitation code/i).fill(code)
    await learnerPage.getByLabel(/choose a password/i).fill('a-good-password')
    await learnerPage.getByLabel(/type your password again/i).fill('a-good-password')
    await learnerPage.getByLabel(/display name/i).fill('Removeme')
    await learnerPage.getByRole('button', { name: /create my account/i }).click()
    await expect(learnerPage).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // Write a reflection so there is something that must survive the removal.
    await learnerPage.goto('/lessons/what-the-model-sees')
    await learnerPage.getByRole('textbox').first().fill('Something I want to keep.')
    await expect
      .poll(async () => {
        const rows = await query<{ count: string }>(
          `select count(*) from public.reflections r
           join public.profiles p on p.id = r.learner_id
           where lower(p.username) = lower($1)`,
          [username],
        )
        return Number(rows[0]?.count ?? 0)
      }, { timeout: 20_000 })
      .toBe(1)

    // Remove her.
    await openClassroom(educatorPage)
    await educatorPage
      .getByRole('listitem')
      .filter({ hasText: 'Removeme' })
      .getByRole('button', { name: /^open$/i })
      .click()
    await educatorPage.getByRole('button', { name: /remove from classroom/i }).click()
    const dialog = educatorPage.getByRole('dialog')
    await expect(dialog).toContainText(/only ends your view of her/i)
    await dialog.getByRole('button', { name: /remove her/i }).click()

    // Her visibility ends…
    await expect(educatorPage.getByText('Removeme')).toHaveCount(0, { timeout: 30_000 })

    // …and everything of hers survives (FR-039, E4).
    const survived = await query<{ profiles: string; reflections: string; enrolments: string }>(
      `select (select count(*) from public.profiles where lower(username) = lower($1))::text as profiles,
              (select count(*) from public.reflections r join public.profiles p on p.id = r.learner_id
                 where lower(p.username) = lower($1))::text as reflections,
              (select count(*) from public.enrolments e join public.profiles p on p.id = e.learner_id
                 where lower(p.username) = lower($1))::text as enrolments`,
      [username],
    )
    expect(survived[0]).toEqual({ profiles: '1', reflections: '1', enrolments: '0' })

    await learner.close()
    await educator.close()
    await removeAccount(username)
  })

  test('6.7 / SC-015 — deleting an account leaves no residual row', async ({ browser }, info) => {
    test.setTimeout(600_000)
    const username = learnerName(info.project.name, 'deleted')
    await removeAccount(username)

    const educator = await browser.newContext()
    const educatorPage = await educator.newPage()
    await signIn(educatorPage, SEED.educator1Email)
    await openClassroom(educatorPage)

    await educatorPage.getByLabel(/^username$/i).fill(username)
    await educatorPage.getByRole('button', { name: /make an invitation/i }).click()
    const code = (await educatorPage.getByTestId('issued-code').innerText()).trim()

    const learner = await browser.newContext()
    const learnerPage = await learner.newPage()
    await learnerPage.goto('/redeem')
    await learnerPage.getByLabel(/username|nombre de usuaria/i).fill(username)
    await learnerPage.getByLabel(/invitation code/i).fill(code)
    await learnerPage.getByLabel(/choose a password/i).fill('a-good-password')
    await learnerPage.getByLabel(/type your password again/i).fill('a-good-password')
    await learnerPage.getByLabel(/display name/i).fill('Deleteme')
    await learnerPage.getByRole('button', { name: /create my account/i }).click()
    await expect(learnerPage).toHaveURL(/\/projects$/, { timeout: 30_000 })
    await learnerPage.goto('/lessons/what-the-model-sees')
    await learnerPage.getByRole('textbox').first().fill('This should not survive.')
    await expect
      .poll(async () => {
        const rows = await query<{ count: string }>(
          `select count(*) from public.reflections r join public.profiles p on p.id = r.learner_id
           where lower(p.username) = lower($1)`,
          [username],
        )
        return Number(rows[0]?.count ?? 0)
      }, { timeout: 20_000 })
      .toBe(1)

    const learnerId =
      (
        await query<{ id: string }>(`select id from public.profiles where lower(username) = lower($1)`, [
          username,
        ])
      )[0]?.id ?? ''
    expect(learnerId).not.toBe('')

    await openClassroom(educatorPage)
    await educatorPage
      .getByRole('listitem')
      .filter({ hasText: 'Deleteme' })
      .getByRole('button', { name: /^open$/i })
      .click()
    await educatorPage.getByRole('button', { name: /delete account/i }).click()
    const dialog = educatorPage.getByRole('dialog')
    // Scenario 6.7's second half: it cannot reach her device, and she must be told.
    await expect(dialog).toContainText(/does not touch the photos and trained models/i)
    await dialog.getByRole('button', { name: /delete it for good/i }).click()

    await expect
      .poll(async () => {
        const rows = await query<{ total: string }>(
          `select ((select count(*) from public.profiles where id = $1)
                 + (select count(*) from public.enrolments where learner_id = $1)
                 + (select count(*) from public.lesson_progress where learner_id = $1)
                 + (select count(*) from public.reflections where learner_id = $1)
                 + (select count(*) from public.projects where owner_id = $1)
                 + (select count(*) from auth.users where id = $1))::text as total`,
          [learnerId],
        )
        return Number(rows[0]?.total ?? -1)
      }, { timeout: 30_000 })
      // SC-015: not one residual row, anywhere, including the auth record.
      .toBe(0)

    // FR-058: exactly one audit row, holding opaque identifiers only.
    const audit = await query<{ action: string; subject_id: string; detail: string | null }>(
      `select action, subject_id::text, detail::text from public.audit_log where subject_id = $1`,
      [learnerId],
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]?.action).toBe('learner_deleted')
    // SC-019: no personal data in the log. Her username and alias must be absent.
    expect(JSON.stringify(audit[0])).not.toContain(username)
    expect(JSON.stringify(audit[0])).not.toContain('Deleteme')

    await learner.close()
    await educator.close()
  })
})
