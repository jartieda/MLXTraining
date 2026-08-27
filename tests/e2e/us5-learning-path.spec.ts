import { test, expect, type Page } from '@playwright/test'
import { SEED, UNAVAILABLE_REASON, accountsAvailable, query } from './helpers/accounts'
import { assertNothingEscaped, watchForEscapes } from './helpers/egress'

/**
 * T092 / US5 — module 1 end to end, then the fairness module's before-and-after.
 *
 * Split by what each half needs. The **anonymous half** runs everywhere and asserts
 * what FR-023 makes true without an account: every module is readable, and the lab
 * says plainly that nothing is being recorded. The **signed-in half** needs a real
 * Supabase, because `lesson_progress` and `reflections` are remote-only and the
 * property under test is precisely that progress *persists* — across a reload, which
 * a fake in-memory client cannot demonstrate.
 *
 * The reload is the assertion that matters. FR-035 says progress saves automatically,
 * and the only honest way to test "automatically" is to never press anything, close
 * the page, and come back.
 */

test.describe.configure({ mode: 'serial' })

async function signIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/username|nombre de usuaria/i).fill(SEED.learner1Username)
  await page.getByLabel(/^password$|^contraseña$/i).fill(SEED.password)
  await page.getByRole('button', { name: /^sign in$|^iniciar sesión$/i }).click()
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })
}

/** Removes L1's lesson rows so a re-run starts from nothing. */
async function clearProgress(): Promise<void> {
  await query(`delete from public.lesson_progress where learner_id = $1`, [SEED.learner1Id])
  await query(`delete from public.reflections where learner_id = $1`, [SEED.learner1Id])
}

// ══════════════════════════════════════════════ the anonymous half (no database)

test.describe('the path is readable with no account (FR-023)', () => {
  test('lists all seven modules and says nothing will be saved', async ({ page }) => {
    const { escapes } = watchForEscapes(page)

    await page.goto('/lessons')
    await expect(page.getByRole('heading', { level: 1, name: /learning path|camino de aprendizaje/i })).toBeVisible()

    // FR-033's seven, each openable — nothing is locked. Scoped by test id rather
    // than by role: the shell's navigation is a list too, so a bare `listitem`
    // count silently includes it.
    await expect(page.locator('[data-testid^="module-card-"]')).toHaveCount(7)
    await expect(page.getByTestId('path-anonymous')).toContainText(/will not be saved|no se guardarán/i)

    assertNothingEscaped(escapes)
  })

  test('a module shows its goal, steps, challenge and questions (FR-034)', async ({ page }) => {
    await page.goto('/lessons/what-the-model-sees')

    // The four things FR-034 requires, in the order they are taught.
    await expect(page.getByRole('heading', { name: /what you will learn|qué vas a aprender/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /do this in the lab|haz esto en el laboratorio/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /your challenge|tu reto/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /write it down|escríbelo/i })).toBeVisible()

    await expect(page.getByRole('checkbox')).toHaveCount(6)
    await expect(page.getByRole('textbox')).toHaveCount(2)
  })

  test('a challenge she cannot yet attempt names the earlier step (FR-037)', async ({ page }) => {
    // No project on a fresh context, so module 2's challenge is unavailable.
    await page.goto('/lessons/reading-a-heat-map')

    const blocked = page.getByTestId('challenge-blocked')
    await expect(blocked).toBeVisible({ timeout: 30_000 })
    await expect(blocked).toContainText(/trained model|modelo entrenado/i)

    // Scenario 5.4: the step, by name, as a working link.
    const link = blocked.getByTestId('prerequisite-link').first()
    await expect(link).toContainText(/train it|entrénalo/i)
    await link.click()
    await expect(page).toHaveURL(/\/lessons\/what-the-model-sees$/)
  })

  test('every module renders in Spanish with no raw key paths (SC-005)', async ({ page }) => {
    await page.goto('/lessons')
    await page.evaluate(() => {
      localStorage.setItem('ml4g.locale', 'es')
    })

    for (const moduleId of [
      'what-the-model-sees',
      'reading-a-heat-map',
      'shortcuts-and-bias',
      'fooling-the-model',
      'comparing-explanations',
      'imbalance-experiment',
      'final-presentation',
    ]) {
      await page.goto(`/lessons/${moduleId}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

      // An untranslated key renders as `modules.foo.title`, which is the failure a
      // Spanish-speaking learner sees and nobody else does.
      const text = await page.locator('main').innerText()
      expect(text, `${moduleId} rendered a raw key path`).not.toMatch(/modules\.[a-z-]+\./)
      expect(text, `${moduleId} rendered a raw path key`).not.toMatch(/\bpath\.[a-z]/i)
    }
  })
})

// ══════════════════════════════════════════════ the signed-in half (needs Postgres)

test.describe('progress and reflections persist', () => {
  test.beforeAll(async () => {
    test.skip(!(await accountsAvailable()), UNAVAILABLE_REASON)
  })

  test.beforeEach(async () => {
    await clearProgress()
  })

  test('5.2 — a ticked step survives a reload, with nothing pressed to save it', async ({ page }) => {
    test.setTimeout(300_000)
    await signIn(page)
    await page.goto('/lessons/what-the-model-sees')

    const first = page.getByRole('checkbox').first()
    await first.click()
    await expect(first).toBeChecked()

    // Wait for the write rather than for a button, because there is no button.
    await expect
      .poll(
        async () => {
          const rows = await query<{ count: string }>(
            `select count(*) from public.lesson_progress where learner_id = $1`,
            [SEED.learner1Id],
          )
          return Number(rows[0]?.count ?? 0)
        },
        { timeout: 20_000 },
      )
      .toBe(1)

    // FR-035's "automatically", tested the only honest way: navigate away without
    // saving anything, come back, and see it.
    await page.goto('/projects')
    await page.goto('/lessons/what-the-model-sees')
    await expect(page.getByRole('checkbox').first()).toBeChecked({ timeout: 30_000 })

    // And the path shows the module as started (Scenario 5.1).
    await page.goto('/lessons')
    await expect(page.getByTestId('module-state-what-the-model-sees')).toContainText(
      /in progress|en marcha/i,
    )
  })

  test('5.1 — finishing every step marks the module complete on the path', async ({ page }) => {
    test.setTimeout(300_000)
    await signIn(page)
    await page.goto('/lessons/fooling-the-model')

    const boxes = page.getByRole('checkbox')
    const total = await boxes.count()
    for (let index = 0; index < total; index += 1) await boxes.nth(index).click()

    await expect
      .poll(
        async () => {
          const rows = await query<{ state: string }>(
            `select state from public.lesson_progress
             where learner_id = $1 and module_id = 'fooling-the-model'`,
            [SEED.learner1Id],
          )
          return rows[0]?.state ?? ''
        },
        { timeout: 20_000 },
      )
      .toBe('completed')

    await page.goto('/lessons')
    await expect(page.getByTestId('module-state-fooling-the-model')).toContainText(
      /finished|terminado/i,
    )
  })

  test('5.3 — a reflection is written, revisited, and revised in place (L4)', async ({ page }) => {
    test.setTimeout(300_000)
    await signIn(page)
    await page.goto('/lessons/what-the-model-sees')

    const field = page.getByRole('textbox').first()
    await field.fill('I think it used the colour.')

    await expect
      .poll(
        async () => {
          const rows = await query<{ answer: string }>(
            `select answer from public.reflections
             where learner_id = $1 and module_id = 'what-the-model-sees'`,
            [SEED.learner1Id],
          )
          return rows[0]?.answer ?? ''
        },
        { timeout: 20_000 },
      )
      .toBe('I think it used the colour.')

    // Navigate away, return, and find it in an editable field.
    await page.goto('/lessons')
    await page.goto('/lessons/what-the-model-sees')
    const again = page.getByRole('textbox').first()
    await expect(again).toHaveValue('I think it used the colour.', { timeout: 30_000 })

    await again.fill('Actually it used the background.')

    await expect
      .poll(
        async () => {
          const rows = await query<{ answer: string; total: string }>(
            `select answer, (select count(*) from public.reflections where learner_id = $1)::text as total
             from public.reflections where learner_id = $1 and module_id = 'what-the-model-sees'`,
            [SEED.learner1Id],
          )
          return `${rows[0]?.answer ?? ''}|${rows[0]?.total ?? ''}`
        },
        { timeout: 20_000 },
      )
      // L4: replaced, not appended. Still exactly one row.
      .toBe('Actually it used the background.|1')
  })

  test('5.4 / FR-036 — the fairness module carries the before-and-after comparison', async ({
    page,
  }) => {
    test.setTimeout(900_000)
    const { escapes } = watchForEscapes(page)
    await signIn(page)

    // Two runs of one project, so the comparison has something to compare. The
    // fairness module is where FR-036 says it belongs.
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Fairness lesson')
    await page.getByRole('button', { name: /^save$|^guardar$/i }).click()

    for (const [className, files] of [
      ['Stripes', ['class-stripes-h-0.png', 'class-stripes-h-1.png', 'class-stripes-h-2.png']],
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
      await expect(
        page.getByText(new RegExp(`added ${String(files.length)} photos`, 'i')),
      ).toBeVisible({ timeout: 60_000 })
    }

    await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 180_000 })

    // Rebalance and train again — the "after".
    await page.getByRole('radio', { name: /Circles/i }).click()
    await page
      .locator('#upload-samples-input')
      .setInputFiles(
        ['class-circle-2.png', 'class-circle-3.png'].map((file) => `tests/fixtures/${file}`),
      )
    await expect(page.getByText(/added 2 photos/i)).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: /^train again$|^entrenar otra vez$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 180_000 })

    // FR-036: the comparison, inside the module that argues from it.
    await page.goto('/lessons/imbalance-experiment')
    await expect(
      page.getByRole('heading', { name: /side by side|uno al lado del otro/i }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('comparison-overall')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('comparison-summary')).toContainText(/Circles/)

    // And the challenge is now available, because both halves of the experiment
    // exist — the FR-037 check reading her actual lab rather than her ticks.
    await expect(page.getByTestId('challenge-ready')).toBeVisible({ timeout: 30_000 })

    assertNothingEscaped(escapes)
  })

  test('no lesson request carries an image or a model (Principle I)', async ({ page }) => {
    const { escapes, requests } = watchForEscapes(page)
    await signIn(page)

    await page.goto('/lessons')
    await page.goto('/lessons/imbalance-experiment')
    await page.getByRole('textbox').first().fill('Words about my own model, and nothing else.')
    await expect
      .poll(
        async () => {
          const rows = await query<{ count: string }>(
            `select count(*) from public.reflections where learner_id = $1`,
            [SEED.learner1Id],
          )
          return Number(rows[0]?.count ?? 0)
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0)

    // The reflections table is the one place a learner's own words leave the device
    // (Principle I permits words; it forbids images and weights). Worth asserting
    // at the moment those words are actually sent.
    assertNothingEscaped(escapes)
    expect(requests.length).toBeGreaterThan(3)
  })
})
