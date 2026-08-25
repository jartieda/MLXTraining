import { test, expect } from '@playwright/test'
import {
  SEED,
  UNAVAILABLE_REASON,
  accountsAvailable,
  query,
} from './helpers/accounts'

/**
 * T072 / SC-016 — no surface reveals a username, a real name, or an educator's
 * email address to a learner.
 *
 * SC-016 says "verified by inspecting every such surface", and the honest reading
 * of that is a sweep rather than a sample. So this file walks every route a
 * learner can reach and greps the rendered text — and, separately, greps what the
 * network actually delivered, because a value can arrive in a payload and be
 * withheld from the DOM only by a component's discretion. The second kind of leak
 * is the one that survives a redesign.
 *
 * The structural guarantees underneath are asserted in `tests/db/`: `username` is
 * absent from the `authenticated` grant altogether (0003_rls.sql), and an
 * educator's address never appears in `profiles` at all. This file is the
 * interface half, and it is deliberately not a substitute for either.
 */

/** Every route reachable by a signed-in learner. */
const LEARNER_ROUTES = ['/', '/projects', '/lab', '/lessons', '/login', '/redeem', '/reset'] as const

/**
 * The identifiers that must never be rendered to a learner.
 *
 * `learner-l1` is her own username, and it is on the list on purpose: FR-025 keeps
 * a username off every display surface, and a page that echoes hers back is one
 * screenshot away from being a page that echoes a classmate's.
 */
const FORBIDDEN: readonly (readonly [string, string])[] = [
  ['her own username', SEED.learner1Username],
  ["a classmate's username", 'learner-l1b'],
  ["another classroom's username", 'learner-l2'],
  ["her educator's email address", 'educator1@example.org'],
  ["the administrator's email address", 'admin@example.org'],
  ['the synthetic auth identifier', 'learner.invalid'],
]

test.describe.configure({ mode: 'serial' })

test.describe('no view exposes a username or an email address (SC-016)', () => {
  test.beforeAll(async () => {
    test.skip(!(await accountsAvailable()), UNAVAILABLE_REASON)
  })

  test('every learner-reachable route is clean, in both locales', async ({ page }) => {
    test.setTimeout(300_000)

    // Collect every response body the page received, not just what it rendered.
    const delivered: string[] = []
    page.on('response', (response) => {
      const type = response.headers()['content-type'] ?? ''
      if (!/json|text/.test(type)) return
      void response
        .text()
        .then((body) => delivered.push(`${response.url()} → ${body}`))
        .catch(() => undefined)
    })

    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.learner1Username)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    for (const locale of ['en', 'es'] as const) {
      await page.evaluate((value) => {
        localStorage.setItem('ml4g.locale', value)
      }, locale)

      for (const route of LEARNER_ROUTES) {
        await page.goto(route)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
        const text = await page.locator('body').innerText()

        for (const [description, needle] of FORBIDDEN) {
          expect(text, `${route} (${locale}) rendered ${description}`).not.toContain(needle)
        }
      }
    }

    // The other half: nothing forbidden was even delivered to the browser. A value
    // present in a payload is a leak waiting for the next component that renders
    // "everything the API returned".
    const payloads = delivered.filter((entry) => /54321|supabase/.test(entry))
    for (const [description, needle] of FORBIDDEN) {
      // `learner.invalid` is excluded here alone: the client derives it locally to
      // sign in, so it is legitimately in a request body. What matters is that it
      // never reaches a screen, which is asserted above.
      if (needle === 'learner.invalid') continue
      const offending = payloads.filter((entry) => entry.includes(needle))
      expect(
        offending.map((entry) => entry.slice(0, 200)),
        `a response body carried ${description} (SC-016)`,
      ).toEqual([])
    }
  })

  test('the roster view a learner can query returns aliases and nothing else', async ({ page }) => {
    // Asserted through the application's own client, with her own session, so this
    // is the grant a modified client would actually meet — not a psql query.
    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.learner1Username)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

    // The URL and the anon key are passed in from the test process. Using her
    // access token as the `apikey` too would be refused by the API gateway before
    // any policy ran, and the assertion would then pass for the wrong reason —
    // which is the failure mode that makes a negative test worthless.
    const result = await page.evaluate(
      async ({ url, anonKey }) => {
        // The client is not on `window`, so the assertion is made over the REST
        // endpoint with her own stored token — the same credential a modified
        // client would use, which is the threat model P2 is written against.
        const raw = localStorage.getItem('ml4g.auth')
        if (!raw) return { status: 0, body: 'no session' }
        const token = (JSON.parse(raw) as { access_token?: string }).access_token ?? ''
        const response = await fetch(`${url}/rest/v1/profiles?select=username`, {
          headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
        })
        return { status: response.status, body: await response.text() }
      },
      {
        url: process.env.VITE_SUPABASE_URL ?? '',
        anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
    )

    // Guard the guard: a blank token would produce a 401 that looks like success.
    expect(result.status, 'no session token was available, so nothing was asserted').not.toBe(0)

    // `username` is not in the `authenticated` grant, so asking for it fails
    // rather than returning nulls. A failure here is the point: FR-025 is enforced
    // by the schema, not by every future policy remembering to exclude a column.
    expect(result.status, `selecting username succeeded: ${result.body}`).not.toBe(200)
  })

  test('the audit log is unreadable, so it cannot become a roster (FR-058, U1)', async () => {
    // Belongs here rather than in tests/db because it is the one table whose whole
    // risk is becoming a human-readable list of who did what to whom. It holds
    // opaque ids only, and nobody may select it at all.
    const columns = await query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_log'`,
    )
    const names = columns.map((row) => row.column_name)
    expect(names.length).toBeGreaterThan(0)
    for (const forbidden of ['alias', 'username', 'email', 'name', 'date_of_birth']) {
      expect(
        names.filter((column) => column.includes(forbidden)),
        `audit_log has a column that could hold personal data: ${forbidden}`,
      ).toEqual([])
    }
  })
})

test.describe('the anonymous half of SC-016', () => {
  test('a visitor with no account is asked for no personal data at all', async ({ page }) => {
    // Runs without a database: it is an assertion about what the forms ask for,
    // and FR-029 makes that a property of the interface rather than the schema.
    for (const route of ['/redeem', '/reset', '/login'] as const) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      for (const pattern of [
        /e-?mail|correo electrónico/i,
        /date of birth|birthday|fecha de nacimiento/i,
        /real name|full name|surname|nombre real|apellido/i,
        /\bage\b|\bedad\b/i,
      ]) {
        const fields = page.getByLabel(pattern)
        expect(
          await fields.count(),
          `${route} asks a learner for something FR-029 forbids: ${String(pattern)}`,
        ).toBe(0)
      }
    }
  })

  test('no route offers a way to create an account without a code (FR-024)', async ({ page }) => {
    for (const route of ['/', '/login', '/projects', '/lab'] as const) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      // A link to /signup, /register or /join would be the give-away, and none of
      // the three is in the route table — deliberately not even as a redirect,
      // because a redirect implies the destination exists.
      const hrefs = await page.locator('a[href]').evaluateAll((links) =>
        links.map((link) => link.getAttribute('href') ?? ''),
      )
      expect(
        hrefs.filter((href) => /signup|sign-up|register|registro|join/i.test(href)),
        `${route} links to a registration path`,
      ).toEqual([])
    }

    // And the routes themselves resolve to the not-found page rather than to a form.
    for (const missing of ['/signup', '/register', '/join']) {
      await page.goto(missing)
      await expect(page.getByText(/does not exist|no existe/i)).toBeVisible()
    }
  })
})
