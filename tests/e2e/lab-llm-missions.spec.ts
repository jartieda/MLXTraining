import { test, expect, type Page } from '@playwright/test'

/**
 * The Lab LLM's «Misiones» tab. No model is needed: missions only store progress and
 * answers in the browser, open the right tool, and download the project card.
 */
async function openMissions(page: Page): Promise<void> {
  await page.goto('/lab-llm')
  await page.getByRole('tab', { name: /misiones|missions/i }).click()
  await expect(page.getByText(/0 de 7|0 of 7/)).toBeVisible()
}

function storedMission(page: Page, id: string): Promise<unknown> {
  return page.evaluate(
    (missionId) =>
      new Promise((resolve) => {
        const request = indexedDB.open('ml4g-llm-lab')
        request.onsuccess = () => {
          const database = request.result
          if (!database.objectStoreNames.contains('missions')) {
            database.close()
            resolve(null)
            return
          }
          const read = database.transaction('missions').objectStore('missions').get(missionId)
          read.onsuccess = () => {
            database.close()
            resolve(read.result ?? null)
          }
        }
        request.onerror = () => {
          resolve(null)
        }
      }),
    id,
  )
}

test.describe('Lab LLM — missions', () => {
  test('a mission opens the comparator with the case it needs', async ({ page }) => {
    await openMissions(page)
    await page.getByTestId('mission-name').getByRole('button', { name: /ir a «herramientas»|go to “tools”/i }).click()
    await expect(page.getByRole('tab', { name: /herramientas|tools/i })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel(/caso preparado|prepared case/i)).toHaveValue('biasName')
  })

  test('progress and answers stay in the browser after reloading', async ({ page }) => {
    await openMissions(page)
    const mission = page.getByTestId('mission-lens')
    await mission.getByRole('textbox').fill('«contenta». No me lo esperaba.')
    await mission.getByRole('checkbox').check()
    await expect(page.getByTestId('mission-lens-status')).toHaveText(/conseguida|completed/i)
    // The tick shows at once; wait for IndexedDB to hold it before reloading.
    await expect.poll(() => storedMission(page, 'lens')).toMatchObject({ done: true, reflection: '«contenta». No me lo esperaba.' })

    await page.reload()
    await page.getByRole('tab', { name: /misiones|missions/i }).click()
    await expect(page.getByText(/1 de 7|1 of 7/)).toBeVisible()
    await expect(page.getByTestId('mission-lens').getByRole('textbox')).toHaveValue('«contenta». No me lo esperaba.')
  })

  test('the project card downloads as Markdown and completes the last mission', async ({ page }) => {
    await openMissions(page)
    const card = page.getByTestId('mission-projectCard')
    const fields = card.getByRole('textbox')
    await expect(fields).toHaveCount(4)
    for (const [index, value] of ['Qué canción escuchar', 'Quien la usa', 'Cambié el nombre', 'Te la recomiendo porque…'].entries()) {
      await fields.nth(index).fill(value)
    }
    const downloadPromise = page.waitForEvent('download')
    await card.getByRole('button', { name: /descargar ficha|download card/i }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.md$/)
    await expect(page.getByTestId('mission-projectCard-status')).toHaveText(/conseguida|completed/i)
  })

  test('the Extras maths tutor section is removed', async ({ page }) => {
    await page.goto('/lab-llm')
    await expect(page.locator('details').filter({ hasText: /extras/i })).toHaveCount(0)
  })

  test('fits a 360 px screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openMissions(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
