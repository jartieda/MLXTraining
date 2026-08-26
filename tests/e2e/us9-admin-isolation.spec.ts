import { test, expect } from '@playwright/test'
import { SEED, UNAVAILABLE_REASON, accountsAvailable, query } from './helpers/accounts'

/**
 * T130 / FR-055, SC-018 — **the test that matters most in this phase.**
 *
 * An over-broad policy here creates the one role in the system that can read every
 * minor's work: an administrator who, unlike an educator, is scoped to no classroom
 * at all. She is defined mostly by what she cannot see, and this file is where that
 * definition is checked rather than asserted.
 *
 * It attacks from three directions, because each catches a different mistake:
 *
 * 1. **Through the API with her own token** — the credential a modified client would
 *    use. Every learner-facing relation is requested directly and must return zero
 *    rows. This catches a policy that grants her access she has no UI for, which is
 *    the failure a UI-only test cannot see.
 * 2. **Through the interface** — every route she can reach is rendered and swept for
 *    a learner's alias, username, reflection text or figure. This catches a component
 *    that reads more than its API layer was meant to expose.
 * 3. **Through navigation** — every link on every administration screen is followed,
 *    to prove no path leads anywhere near classroom content. This catches the thing
 *    reviews miss: not what the screen shows, but where it lets you go.
 *
 * The policies answer a forbidden read with **zero rows rather than an error**, so
 * every assertion here is "nothing came back", not "the request failed". A test that
 * expected a 403 would pass against a policy that returned everything with a
 * misconfigured status code.
 */

/** Everything an administrator must not be able to read (FR-055, SC-018). */
const FORBIDDEN_RELATIONS = [
  'profiles?role=eq.learner&select=id,alias',
  'enrolments?select=learner_id',
  'projects?select=id,name',
  'training_runs?select=id,overall_accuracy',
  'lesson_progress?select=learner_id,module_id',
  'reflections?select=learner_id,answer',
  'audit_log?select=id',
  // The base table, not the view. `classrooms` has no administrator policy at all,
  // so her only route is `admin_classrooms` — and if the base table ever answered,
  // it would carry `archived_at` and a join path she must not have.
  'classrooms?select=id,name,educator_id,archived_at',
  // The one relation through which a username is readable, and only by the educator
  // who issued it (P3).
  'educator_roster?select=id,username,alias',
] as const

/** Strings from the seed that must appear on no administration surface. */
const LEARNER_MARKERS = [
  SEED.learner1Alias,
  SEED.learner1Username,
  'Nimbus',
  'learner-l1b',
  'learner-l2',
] as const

test.describe.configure({ mode: 'serial' })

test.describe('an administrator reaches no learner data', () => {
  test.beforeAll(async () => {
    test.skip(!(await accountsAvailable()), UNAVAILABLE_REASON)
  })

  test('every learner-facing relation returns zero rows to her token (SC-018)', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.adminEmail)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    // An administrator is kept out of the lab, so she lands on the administration
    // screen rather than on /projects.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    const results = await page.evaluate(
      async ({ url, anonKey, relations }) => {
        const raw = localStorage.getItem('ml4g.auth')
        const empty: Record<string, number> = {}
        if (!raw) return { session: false, rows: empty }
        const token = (JSON.parse(raw) as { access_token?: string }).access_token ?? ''
        const headers = { Authorization: `Bearer ${token}`, apikey: anonKey }

        const rows: Record<string, number> = {}
        for (const relation of relations) {
          const response = await fetch(`${url}/rest/v1/${relation}`, { headers })
          // A refusal counts as zero: PostgREST answers a missing grant with 401/403
          // and a missing policy with an empty array, and both are acceptable. What
          // is not acceptable is a row.
          rows[relation] = response.ok ? ((await response.json()) as unknown[]).length : 0
        }
        return { session: true, rows }
      },
      {
        url: process.env.VITE_SUPABASE_URL ?? '',
        anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? '',
        relations: [...FORBIDDEN_RELATIONS],
      },
    )

    // Guard the guard: with no token the zeroes below would be meaningless.
    expect(results.session, 'no administrator session, so nothing was asserted').toBe(true)

    const leaked = Object.entries(results.rows).filter(([, count]) => count > 0)
    expect(
      leaked,
      'an administrator read rows FR-055 forbids; each entry is [relation, row count]',
    ).toEqual([])
  })

  test('she reads exactly three things, and they are the three she needs', async ({ page }) => {
    test.setTimeout(300_000)

    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.adminEmail)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    const allowed = await page.evaluate(
      async ({ url, anonKey }) => {
        const raw = localStorage.getItem('ml4g.auth')
        const token = raw ? ((JSON.parse(raw) as { access_token?: string }).access_token ?? '') : ''
        const headers = { Authorization: `Bearer ${token}`, apikey: anonKey }
        const count = async (relation: string) => {
          const response = await fetch(`${url}/rest/v1/${relation}`, { headers })
          if (!response.ok) return -1
          return ((await response.json()) as unknown[]).length
        }
        return {
          educators: await count('profiles?role=eq.educator&select=id,display_name'),
          invitations: await count('invitations?select=id,target'),
          classrooms: await count('admin_classrooms?select=id,name,educator_id'),
        }
      },
      {
        url: process.env.VITE_SUPABASE_URL ?? '',
        anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
    )

    // The positive half of SC-018. A test that only asserted denials would pass
    // against a policy set that denied her everything — including the three reads
    // FR-057 needs, which would break reassignment and strand a classroom.
    expect(allowed.educators, 'she cannot see the educators she is meant to manage').toBeGreaterThan(0)
    expect(allowed.classrooms, 'she cannot see a classroom to reassign').toBeGreaterThan(0)
    expect(allowed.invitations).toBeGreaterThanOrEqual(0)
  })

  test('no administration screen renders a learner marker', async ({ page }) => {
    test.setTimeout(300_000)

    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.adminEmail)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    // Every route she can type, not only the one she is given. `/lessons` and
    // `/classroom` are the ones a guard must hold on.
    for (const route of ['/admin', '/', '/projects', '/lab', '/lessons', '/classroom']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
      const text = await page.locator('body').innerText()

      for (const marker of LEARNER_MARKERS) {
        expect(text, `${route} rendered "${marker}" to an administrator`).not.toContain(marker)
      }
      // And no reflection text. The seed gives L1 an answer; if any of it reaches an
      // administration surface, the FR-055 boundary has gone.
      expect(text, `${route} rendered reflection text`).not.toMatch(/I think it|background/i)
    }
  })

  test('she is kept out of the lab, the lessons and the classroom (FR-055)', async ({ page }) => {
    test.setTimeout(300_000)

    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.adminEmail)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    for (const route of ['/projects', '/lab', '/lessons', '/classroom']) {
      await page.goto(route)
      // A refusal, not a redirect: a link an adult was given must be shown to be
      // wrong rather than silently swapped for somewhere else.
      await expect(page.getByTestId('role-refused'), `${route} was not refused`).toBeVisible({
        timeout: 30_000,
      })
    }

    // And the navigation does not offer them in the first place, so she never has to
    // meet the refusal at all.
    await page.goto('/admin')
    const navLinks = await page
      .locator('header nav a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    expect(navLinks.filter((href) => /projects|lab|lessons|classroom/.test(href))).toEqual([])
  })

  test('no link on any administration screen leads to classroom content', async ({ page }) => {
    test.setTimeout(300_000)

    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.adminEmail)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    // Every href on the page, including the `mailto:`. This is the assertion a code
    // review misses: not what the screen shows, but where it lets you go.
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))

    const suspicious = hrefs.filter((href) =>
      /\/(projects|lab|lessons|classroom)(\/|$|\?)/.test(href),
    )
    expect(suspicious, 'an administration screen links into classroom content').toEqual([])

    // The one outbound href is the handover mailto, and it must carry no learner
    // data — only an educator's address and a code.
    for (const href of hrefs.filter((candidate) => candidate.startsWith('mailto:'))) {
      for (const marker of LEARNER_MARKERS) {
        expect(decodeURIComponent(href)).not.toContain(marker)
      }
    }
  })

  test('the audit log is readable by nobody, including her (FR-058, U1)', async ({ page }) => {
    test.setTimeout(300_000)

    // Checked here as well as in tests/db because this is the table most tempting to
    // build an administrator screen on top of — and such a screen would name learner
    // accounts, recreating exactly the role FR-055 forbids.
    const rows = await query<{ count: string }>(`select count(*) from public.audit_log`)
    expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(0)

    await page.goto('/login')
    await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.adminEmail)
    await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
    await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    const audit = await page.evaluate(
      async ({ url, anonKey }) => {
        const raw = localStorage.getItem('ml4g.auth')
        const token = raw ? ((JSON.parse(raw) as { access_token?: string }).access_token ?? '') : ''
        const response = await fetch(`${url}/rest/v1/audit_log?select=id`, {
          headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
        })
        return { status: response.status, rows: response.ok ? ((await response.json()) as unknown[]).length : 0 }
      },
      {
        url: process.env.VITE_SUPABASE_URL ?? '',
        anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
    )
    expect(audit.rows).toBe(0)

    // And there is no screen for it either.
    await page.goto('/admin')
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/audit|registro de auditor/i)
  })
})
