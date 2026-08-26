import { test, expect, type Page } from '@playwright/test'
import { SEED, UNAVAILABLE_REASON, accountsAvailable, query } from './helpers/accounts'

/**
 * T129 / US9 — Scenarios 9.1 to 9.7, FR-053 to FR-057.
 *
 * The one that carries the file is **FR-056: the last administrator cannot deactivate
 * herself.** Everything else here is a feature; that is a lockout. Get it wrong and
 * the program has nobody who can invite an educator, with no path back except someone
 * with database credentials writing a migration — which for a volunteer-run program
 * may mean weeks.
 *
 * It is asserted through the interface rather than only in `tests/db/`, because the
 * refusal has to *reach her*. A constraint that fires and produces a generic "that did
 * not work" leaves her retrying, and eventually reaching for the database.
 */

test.describe.configure({ mode: 'serial' })

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.adminEmail)
  await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
  await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
}

/** Removes an educator account created by a test, so a re-run starts clean. */
async function removeEducator(email: string): Promise<void> {
  await query(
    `do $$
     declare victim uuid;
     begin
       select id into victim from auth.users where lower(email) = lower($1);
       if victim is not null then
         update public.classrooms set educator_id = $2 where educator_id = victim;
         delete from public.invitations where issuer_id = victim;
         delete from public.profiles where id = victim;
         delete from auth.users where id = victim;
       end if;
       delete from public.invitations where lower(target) = lower($1);
     end $$;`,
    [email, SEED.educator1],
  )
}

function educatorEmail(project: string, label: string): string {
  return `e2e9-${project}-${label}@school.example`.toLowerCase().replace(/[^a-z0-9.@-]/g, '-')
}

test.describe('administering the program', () => {
  test.beforeAll(async () => {
    test.skip(!(await accountsAvailable()), UNAVAILABLE_REASON)
  })

  // ─────────────────────────────────────────────────────────── 9.1 and 9.2

  test('9.1 / 9.2 — invites an educator, shows the code once, and hands it over', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const email = educatorEmail(info.project.name, 'invited')
    await removeEducator(email)

    await signInAsAdmin(page)
    await page.getByLabel(/educator's email/i).fill(email)
    await page.getByRole('button', { name: /make an invitation/i }).click()

    const issued = page.getByTestId('educator-invitation-issued')
    await expect(issued).toBeVisible({ timeout: 30_000 })

    const code = (await page.getByTestId('educator-code').innerText()).trim()
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)

    // FR-053: the handover is her own mail client, prefilled. The application sends
    // nothing, which is why this project holds no mail credentials at all.
    const mailto = await page.getByTestId('handover-mailto').getAttribute('href')
    expect(mailto).toContain('mailto:')
    expect(decodeURIComponent(mailto ?? '')).toContain(code)
    expect(decodeURIComponent(mailto ?? '')).toContain(email)

    // Stored as a hash only (I2): the plaintext exists nowhere after this screen.
    const stored = await query<{ has_plaintext: boolean }>(
      `select exists (
         select 1 from public.invitations
         where lower(target) = lower($1) and code_hash = $2
       ) as has_plaintext`,
      [email, code],
    )
    expect(stored[0]?.has_plaintext, 'the plaintext code was stored').toBe(false)

    // The invitation appears with its state (FR-054).
    await page.getByRole('button', { name: /invite someone else/i }).click()
    await expect(page.getByText(email, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/waiting to be used/i).first()).toBeVisible()

    await removeEducator(email)
  })

  test('9.2 — an educator redeems it and can then run a classroom', async ({ browser }, info) => {
    test.setTimeout(600_000)
    const email = educatorEmail(info.project.name, 'redeemer')
    await removeEducator(email)

    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    await signInAsAdmin(adminPage)
    await adminPage.getByLabel(/educator's email/i).fill(email)
    await adminPage.getByRole('button', { name: /make an invitation/i }).click()
    const code = (await adminPage.getByTestId('educator-code').innerText()).trim()

    const educatorContext = await browser.newContext()
    const educatorPage = await educatorContext.newPage()
    await educatorPage.goto('/redeem')
    // An educator redeems with her email address; the `@` is the whole discriminator
    // between her and a learner's username (R16).
    await educatorPage.getByLabel(/username|nombre de usuaria/i).fill(email)
    await educatorPage.getByLabel(/invitation code/i).fill(code)
    await educatorPage.getByLabel(/choose a password/i).fill('a-good-password')
    await educatorPage.getByLabel(/type your password again/i).fill('a-good-password')
    await educatorPage.getByLabel(/display name/i).fill('New Educator')
    await educatorPage.getByRole('button', { name: /create my account/i }).click()
    await expect(educatorPage).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // She gets the educator role, so the classroom screen is hers.
    await educatorPage.goto('/classroom')
    await expect(
      educatorPage.getByRole('heading', { level: 1, name: /my classroom|mi clase/i }),
    ).toBeVisible({ timeout: 30_000 })

    const role = await query<{ role: string }>(
      `select p.role from public.profiles p join auth.users u on u.id = p.id
       where lower(u.email) = lower($1)`,
      [email],
    )
    expect(role[0]?.role).toBe('educator')

    // And the administrator's list now shows her as used.
    await adminPage.goto('/admin')
    await expect(adminPage.getByText(/^used$/i).first()).toBeVisible({ timeout: 30_000 })

    await educatorContext.close()
    await adminContext.close()
    await removeEducator(email)
  })

  // ─────────────────────────────────────────────────────────────────── 9.3

  test('9.3 — revokes an unredeemed invitation', async ({ page }, info) => {
    test.setTimeout(300_000)
    const email = educatorEmail(info.project.name, 'revoked')
    await removeEducator(email)

    await signInAsAdmin(page)
    await page.getByLabel(/educator's email/i).fill(email)
    await page.getByRole('button', { name: /make an invitation/i }).click()
    const code = (await page.getByTestId('educator-code').innerText()).trim()
    await page.getByRole('button', { name: /invite someone else/i }).click()

    const row = page.getByRole('row').filter({ hasText: email })
    await row.getByRole('button', { name: /cancel it/i }).click()
    await expect(row).toContainText(/cancelled/i, { timeout: 30_000 })

    // And the code no longer works, with the refusal naming which of the three
    // terminal states applies (FR-028).
    await page.goto('/redeem')
    await page.getByLabel(/username|nombre de usuaria/i).fill(email)
    await page.getByLabel(/invitation code/i).fill(code)
    await page.getByLabel(/choose a password/i).fill('a-good-password')
    await page.getByLabel(/type your password again/i).fill('a-good-password')
    await page.getByLabel(/display name/i).fill('Should Not Exist')
    await page.getByRole('button', { name: /create my account/i }).click()
    await expect(page.getByRole('alert')).toContainText(/cancelled/i, { timeout: 30_000 })

    await removeEducator(email)
  })

  // ─────────────────────────────────────────────────────────────────── 9.4

  test('9.4 — reassigns a classroom, and the new owner can read it', async ({
    browser,
  }, info) => {
    test.setTimeout(600_000)
    const email = educatorEmail(info.project.name, 'receiver')
    await removeEducator(email)

    // Create a second educator to receive the classroom.
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    await signInAsAdmin(adminPage)
    await adminPage.getByLabel(/educator's email/i).fill(email)
    await adminPage.getByRole('button', { name: /make an invitation/i }).click()
    const code = (await adminPage.getByTestId('educator-code').innerText()).trim()

    const educatorContext = await browser.newContext()
    const educatorPage = await educatorContext.newPage()
    await educatorPage.goto('/redeem')
    await educatorPage.getByLabel(/username|nombre de usuaria/i).fill(email)
    await educatorPage.getByLabel(/invitation code/i).fill(code)
    await educatorPage.getByLabel(/choose a password/i).fill('a-good-password')
    await educatorPage.getByLabel(/type your password again/i).fill('a-good-password')
    await educatorPage.getByLabel(/display name/i).fill('Receiving Educator')
    await educatorPage.getByRole('button', { name: /create my account/i }).click()
    await expect(educatorPage).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // Before: she owns nothing.
    await educatorPage.goto('/classroom')
    await expect(educatorPage.getByLabel(/^classroom name$/i).first()).toBeVisible({
      timeout: 30_000,
    })

    // Reassign K1 to her.
    await adminPage.goto('/admin')
    const card = adminPage.getByTestId(`admin-classroom-${SEED.classroom1}`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.getByLabel(/move it to/i).selectOption({ label: 'Receiving Educator' })
    await card.getByRole('button', { name: /^move it$/i }).click()
    await expect(adminPage.getByText(/has a new educator/i)).toBeVisible({ timeout: 30_000 })

    // After: FR-057's promise — she gains the same access she would have over a
    // classroom she created herself, including the roster.
    await educatorPage.goto('/classroom')
    await expect(educatorPage.getByText(SEED.learner1Alias)).toBeVisible({ timeout: 30_000 })

    // Put it back, so a re-run and the other suites are unaffected.
    await query(`update public.classrooms set educator_id = $1 where id = $2`, [
      SEED.educator1,
      SEED.classroom1,
    ])

    await educatorContext.close()
    await adminContext.close()
    await removeEducator(email)
  })

  // ─────────────────────────────────────────────────────────── 9.5 and 9.6

  test('9.5 — deactivating an educator leaves her learners’ work untouched', async ({
    page,
  }, info) => {
    test.setTimeout(600_000)
    const email = educatorEmail(info.project.name, 'deactivated')
    await removeEducator(email)

    await signInAsAdmin(page)
    await page.getByLabel(/educator's email/i).fill(email)
    await page.getByRole('button', { name: /make an invitation/i }).click()
    const code = (await page.getByTestId('educator-code').innerText()).trim()

    // Redeem in the same context is enough — we only need the account to exist.
    const before = await query<{ total: string }>(
      `select (select count(*) from public.reflections)::text as total`,
    )

    await page.goto('/redeem')
    await page.getByLabel(/username|nombre de usuaria/i).fill(email)
    await page.getByLabel(/invitation code/i).fill(code)
    await page.getByLabel(/choose a password/i).fill('a-good-password')
    await page.getByLabel(/type your password again/i).fill('a-good-password')
    await page.getByLabel(/display name/i).fill('Leaving Educator')
    await page.getByRole('button', { name: /create my account/i }).click()
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    await signInAsAdmin(page)
    const row = page.getByRole('listitem').filter({ hasText: 'Leaving Educator' })
    await row.getByRole('button', { name: /^switch off$/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(/learners have made stay/i)
    await dialog.getByRole('button', { name: /^switch it off$/i }).click()

    await expect(
      page.getByRole('listitem').filter({ hasText: 'Leaving Educator' }),
    ).toContainText(/switched off/i, { timeout: 30_000 })

    // FR-054: no learner work was touched, and exactly one audit row was written.
    const after = await query<{ total: string }>(
      `select (select count(*) from public.reflections)::text as total`,
    )
    expect(after[0]?.total).toBe(before[0]?.total)

    const audit = await query<{ action: string }>(
      `select a.action from public.audit_log a
       join auth.users u on u.id = a.subject_id
       where lower(u.email) = lower($1)`,
      [email],
    )
    expect(audit.map((entry) => entry.action)).toEqual(['educator_deactivated'])

    // And she can no longer sign in.
    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(email)
    await page.getByLabel(/^password$|^contraseña$/i).fill('a-good-password')
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await expect(page.getByRole('alert')).toContainText(/switched off/i, { timeout: 30_000 })

    await removeEducator(email)
  })

  // ─────────────────────────────────────────────────────────────────── 9.7

  test('9.7 / FR-056 — the last administrator cannot switch herself off', async ({ page }) => {
    test.setTimeout(300_000)

    // The seed has exactly one administrator, which is the state a real deployment
    // starts in and the state where this failure is fatal.
    const admins = await query<{ count: string }>(
      `select count(*) from public.profiles where role = 'administrator' and is_active`,
    )
    expect(Number(admins[0]?.count ?? 0), 'this test needs exactly one active administrator').toBe(1)

    await signInAsAdmin(page)

    const own = page.getByRole('listitem').filter({ hasText: SEED.adminDisplayName })
    await own.getByRole('button', { name: /switch off my own account/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^switch it off$/i }).click()

    // The refusal must REACH her, in words she can act on. A generic "that did not
    // work" leaves her retrying and eventually reaching for the database.
    const failure = page.getByTestId('deactivate-failure')
    await expect(failure).toBeVisible({ timeout: 30_000 })
    await expect(failure).toContainText(/last administrator/i)
    await expect(failure).toContainText(/nobody left to run it/i)

    // And she is still active, so the program is not locked out.
    const after = await query<{ count: string }>(
      `select count(*) from public.profiles where role = 'administrator' and is_active`,
    )
    expect(after[0]?.count).toBe('1')

    // No audit row either: nothing irreversible happened (FR-058).
    const audit = await query<{ count: string }>(
      `select count(*) from public.audit_log
       where action = 'educator_deactivated' and subject_id = $1`,
      [SEED.admin],
    )
    expect(audit[0]?.count).toBe('0')
  })

  test('FR-056 — there is no path to create an administrator', async ({ page }) => {
    await signInAsAdmin(page)

    // The invitation form issues educators only; `issue_educator_invitation` hard-codes
    // `kind = 'educator'` and `redeem_invitation` derives the role from it. So there is
    // no argument to tamper with and no control to find.
    const text = await page.locator('main').innerText()
    expect(text).toMatch(/no way to create another administrator/i)

    const controls = [
      ...(await page.getByRole('button').all()),
      ...(await page.getByRole('link').all()),
    ]
    const names = await Promise.all(controls.map((control) => control.innerText()))
    expect(
      names.filter((name) => /invite an administrator|new administrator|add administrator/i.test(name)),
    ).toEqual([])

    // And a redeemed educator invitation can only produce an educator.
    const roles = await query<{ role: string }>(
      `select distinct kind::text as role from public.invitations`,
    )
    expect(roles.map((entry) => entry.role).sort()).not.toContain('administrator')
  })
})
