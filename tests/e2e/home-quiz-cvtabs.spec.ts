import { test, expect } from '@playwright/test'

/**
 * The home page (how the site works, theory, «Tu proyecto y la XAI»), the learning
 * questionnaire with its downloadable result, and the Lab CV's three tabs.
 */

test.describe('home page', () => {
  test('explains the site, holds the theory and keeps the project answers', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /cómo funciona esta web|how this site works/i })).toBeVisible()
    await page.getByText(/¿qué es un sesgo\?|what is a bias\?/i).first().click()
    await expect(page.getByText(/tendencia sistemática|systematic tendency/i).first()).toBeVisible()

    const technology = page.getByLabel(/qué tipo de tecnología usas|what kind of technology/i)
    await technology.fill('Un modelo que reconoce residuos')
    await page.reload()
    await expect(page.getByLabel(/qué tipo de tecnología usas|what kind of technology/i)).toHaveValue('Un modelo que reconoce residuos')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /descargar mis respuestas|download my answers/i }).click()
    expect((await download).suggestedFilename()).toMatch(/\.md$/)
  })
})

test.describe('learning questionnaire', () => {
  test('pre attempt hides the answers; post attempt shows the score; both download a CSV', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /ir al cuestionario|go to the quiz/i }).click()

    await page.getByLabel(/tu código|your code/i).fill('ab 12')
    await expect(page.getByLabel(/tu código|your code/i)).toHaveValue('AB12')
    await page.getByRole('button', { name: /empezar|^start$/i }).click()
    await page.getByTestId('quiz-q1').getByText(/entender por qué|understanding why/i).click()
    await page.getByRole('button', { name: /terminar|finish/i }).click()
    await expect(page.getByTestId('quiz-done')).toBeVisible()
    await expect(page.getByTestId('quiz-score')).toHaveCount(0)

    const csv = page.waitForEvent('download')
    await page.getByRole('button', { name: /descargar resultado|download result/i }).click()
    expect((await csv).suggestedFilename()).toBe('cuestionario-AB12-pre.csv')

    await page.reload()
    await page.getByLabel(/tu código|your code/i).fill('AB12')
    await page.getByLabel(/después de usar|after using/i).check()
    await page.getByRole('button', { name: /empezar|^start$/i }).click()
    await page.getByTestId('quiz-q1').getByText(/entender por qué|understanding why/i).click()
    await page.getByRole('button', { name: /terminar|finish/i }).click()
    await expect(page.getByTestId('quiz-score')).toHaveText(/1 de 12|1 of 12/)

    await page.getByText(/para el profesorado|for teachers/i).click()
    await expect(page.getByText(/ahora hay 2|there are 2 now/i)).toBeVisible()
  })
})

test.describe('Lab CV tabs', () => {
  test('tools, challenges and missions; a challenge without photos says so', async ({ page }) => {
    await page.goto('/lab')
    await expect(page.getByRole('heading', { level: 1, name: 'Lab CV' })).toBeVisible()
    await page.getByRole('tab', { name: /retos|challenges/i }).click()
    await expect(page.getByTestId('cv-challenge-huskyWolf')).toBeVisible()
    await expect(page.getByTestId('cv-challenge-huskyWolf').getByTestId('cv-challenge-missing')).toBeVisible()

    await page.getByRole('tab', { name: /misiones|missions/i }).click()
    await page.getByTestId('cv-mission-shortcut').getByRole('checkbox').check()
    await page.reload()
    await page.getByRole('tab', { name: /misiones|missions/i }).click()
    await expect(page.getByTestId('cv-mission-shortcut').getByRole('checkbox')).toBeChecked()
    await page.getByTestId('cv-mission-shortcut').getByRole('button', { name: /retos|challenges/i }).click()
    await expect(page.getByRole('tab', { name: /retos|challenges/i })).toHaveAttribute('aria-selected', 'true')
  })
})
