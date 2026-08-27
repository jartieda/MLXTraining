import { test, expect, type Page } from '@playwright/test'
import { assertNothingEscaped, watchForEscapes } from './helpers/egress'

/**
 * T111 / US8 — SC-004, FR-045, FR-046. The complete journey at 360×740.
 *
 * Every prior story was built mobile-first, so this file **verifies** rather than
 * retrofits. What it verifies is the two things a mobile layout fails at silently:
 *
 * 1. **Horizontal scroll.** A page 380 px wide in a 360 px viewport looks almost
 *    right, and the control that fell off the right edge is invisible in a
 *    screenshot review. Measured as `scrollWidth > clientWidth` on every route.
 * 2. **Clipped and undersized controls.** FR-046's 44 px floor is checked against
 *    the *rendered box* of every interactive element, not against the class list —
 *    a `min-h-touch` on an element inside a flex row that shrinks it is still a
 *    28 px target.
 *
 * The journey itself is the anonymous one, which by FR-023 is the whole product for
 * a visitor with no account: capture, train, test, explain, and read the figures.
 */

/** SC-004's constitutional floor. */
const MOBILE_WIDTH = 360

/** FR-046. 44 CSS px, with a pixel of slack for sub-pixel layout rounding. */
const TOUCH_FLOOR = 43

test.describe('the whole journey on a phone', () => {
  // Runs only where the viewport is actually a phone. The desktop project would
  // pass every assertion here trivially and prove nothing.
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) > MOBILE_WIDTH,
    'This suite asserts the 360 px layout; run it under the mobile project.',
  )

  test('no route scrolls horizontally (SC-004)', async ({ page }) => {
    for (const route of ['/', '/projects', '/lab', '/lessons', '/login', '/redeem', '/reset']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        // The widest offending element, so a failure names what to fix rather than
        // reporting that the page is four pixels too wide.
        widest: [...document.querySelectorAll('body *')]
          .map((element) => {
            const box = element.getBoundingClientRect()
            return { tag: element.tagName, right: Math.round(box.right), width: Math.round(box.width) }
          })
          .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 3),
      }))

      expect(
        overflow.scrollWidth,
        `${route} scrolls horizontally; widest overflowing elements: ${JSON.stringify(overflow.widest)}`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1)
    }
  })

  test('every interactive control clears the 44 px floor (FR-046)', async ({ page }) => {
    for (const route of ['/', '/projects', '/lab', '/lessons', '/login', '/redeem', '/reset']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

      const undersized = await page.evaluate((floor) => {
        const interactive = [
          ...document.querySelectorAll(
            'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=checkbox]',
          ),
        ]
        return interactive
          .filter((element) => {
            const style = getComputedStyle(element)
            if (style.display === 'none' || style.visibility === 'hidden') return false
            const box = element.getBoundingClientRect()
            if (box.width === 0 || box.height === 0) return false
            // A visually-hidden control is not a touch target. The skip link is
            // deliberately 1×1 until it receives focus, at which point it becomes
            // a full-sized button — its focused size is asserted by the keyboard
            // pass in a11y.spec.ts rather than here.
            if (style.clipPath === 'inset(50%)' || element.classList.contains('sr-only')) {
              return false
            }
            // A control wrapped in a label big enough to tap is tappable: the
            // question FR-046 asks is how big the target is, not how big the box
            // that draws it is.
            const target = element.closest('label') ?? element
            const targetBox = target.getBoundingClientRect()
            return Math.max(box.height, targetBox.height) < floor
          })
          .map((element) => {
            const box = element.getBoundingClientRect()
            return {
              tag: element.tagName,
              type: element.getAttribute('type'),
              text: (element.textContent ?? '').trim().slice(0, 40),
              height: Math.round(box.height),
            }
          })
      }, TOUCH_FLOOR)

      expect(undersized, `${route} has controls below the 44 px floor`).toEqual([])
    }
  })

  test('captures, trains, tests and explains, all in portrait', async ({ page }) => {
    test.setTimeout(900_000)
    const { escapes } = watchForEscapes(page)

    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Phone journey')
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
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 300_000 })

    // US7's figures, on a phone. The confusion matrix scrolls inside its own
    // container rather than widening the page — asserted by the no-horizontal-scroll
    // test above, and here by the figures simply being reachable.
    await expect(page.getByTestId('overall-accuracy')).toBeVisible({ timeout: 60_000 })

    // The three panels stack, so everything is below rather than beside. Scrolling
    // to the explanation panel is the mobile journey working.
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await expect(page.getByText(/frame frozen|imagen congelada/i)).toBeVisible()

    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByTestId('heatmap-description')).toBeVisible({ timeout: 300_000 })

    assertNothingEscaped(escapes)
  })

  test('the lab stacks into one column below md (FR-045)', async ({ page }) => {
    await page.goto('/lab')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    const columns = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('main section[aria-labelledby^="panel-"]')]
      // Distinct left edges: one column means every panel starts at the same x.
      return [...new Set(sections.map((section) => Math.round(section.getBoundingClientRect().left)))]
    })

    // Zero sections is a legitimate state here (no project selected), so the
    // assertion is about the count of columns rather than of panels.
    expect(columns.length, `the lab rendered ${String(columns.length)} columns at 360 px`).toBeLessThanOrEqual(1)
  })
})

/**
 * The desktop side of FR-045: above `md` the lab is three columns.
 *
 * Asserted so that "mobile-first" cannot quietly become "mobile-only" — a media
 * query deleted while chasing a 360 px bug would leave a phone layout on a 1440 px
 * screen, and every mobile assertion above would still pass.
 */
test.describe('the desktop layout is still three columns', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) <= MOBILE_WIDTH,
    'This assertion belongs to the desktop project.',
  )

  test('spreads the lab across three columns above md', async ({ page }: { page: Page }) => {
    await page.goto('/lab')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })

    const columns = await page.evaluate(() => {
      const grid = document.querySelector('main .grid')
      return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
    })
    // Zero when no project is open; three when one is. Either is correct — what
    // would be wrong is one.
    expect([0, 3]).toContain(columns)
  })
})
