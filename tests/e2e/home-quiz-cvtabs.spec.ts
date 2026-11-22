import { test, expect, type Page } from '@playwright/test'

async function consentToQuizSubmission(page: Page): Promise<void> {
  await page
    .getByLabel(/Acepto enviar el cuestionario anónimo|I agree to send the anonymous quiz/i)
    .check()
  await page.getByLabel(/^(País|Country)$/i).selectOption('ES')
}

/**
 * The home page (how the site works, theory, «Tu proyecto y la XAI»), the learning
 * questionnaire with its downloadable result, and the Lab CV's three tabs.
 */

test.describe('home page', () => {
  test('explains the site, holds the theory and keeps the project answers', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: /cómo funciona esta web|how this site works/i }),
    ).toBeVisible()
    await page
      .getByText(/¿qué es un sesgo\?|what is a bias\?/i)
      .first()
      .click()
    await expect(page.getByText(/tendencia sistemática|systematic tendency/i).first()).toBeVisible()

    const technology = page.getByLabel(/qué tipo de tecnología usas|what kind of technology/i)
    await technology.fill('Un modelo que reconoce residuos')
    await page.reload()
    await expect(
      page.getByLabel(/qué tipo de tecnología usas|what kind of technology/i),
    ).toHaveValue('Un modelo que reconoce residuos')

    const download = page.waitForEvent('download')
    await page
      .getByRole('button', { name: /descargar mis respuestas|download my answers/i })
      .click()
    expect((await download).suggestedFilename()).toMatch(/\.md$/)
  })
})

test.describe('learning questionnaire', () => {
  test('initial open answer compares with the final basic test; both download a CSV', async ({
    page,
  }) => {
    await page.goto('/')
    const initialQuiz = page.getByRole('link', { name: /cuestionario inicial|initial quiz/i })
    const finalQuiz = page.getByRole('link', { name: /cuestionario final|final quiz/i })
    await expect(initialQuiz).toHaveAttribute('href', '/quiz?phase=pre')
    await expect(finalQuiz).toHaveAttribute('href', '/quiz?phase=post')
    await initialQuiz.click()
    await expect(
      page.getByRole('heading', { level: 1, name: /cuestionario inicial|initial quiz/i }),
    ).toBeVisible()

    await page.getByLabel(/tu código|your code/i).fill('ab 12')
    await expect(page.getByLabel(/tu código|your code/i)).toHaveValue('AB12')
    await page.getByRole('button', { name: /empezar|^start$/i }).click()
    await page
      .getByLabel(
        /¿Sabes qué es la IA explicable y para qué sirve|do you know what explainable AI is and what it is for/i,
      )
      .fill('La XAI ayuda a entender decisiones de un modelo.')
    await expect(page.getByTestId('quiz-q1')).toHaveCount(0)
    await expect(page.getByTestId('quiz-l1')).toBeVisible()
    await page.getByTestId('quiz-l1').getByRole('radio').nth(2).check()
    const finishInitial = page.getByRole('button', { name: /terminar|finish/i })
    await expect(finishInitial).toBeDisabled()
    await consentToQuizSubmission(page)
    await expect(finishInitial).toBeEnabled()
    await finishInitial.click()
    await expect(page.getByTestId('quiz-done')).toBeVisible()
    await expect(page.getByTestId('quiz-score')).toHaveCount(0)

    const csv = page.waitForEvent('download')
    await page.getByRole('button', { name: /descargar resultado|download result/i }).click()
    expect((await csv).suggestedFilename()).toBe('cuestionario-AB12-pre.csv')

    await page.goto('/quiz?phase=post')
    await expect(
      page.getByRole('heading', { level: 1, name: /cuestionario final|final quiz/i }),
    ).toBeVisible()
    await page.getByLabel(/tu código|your code/i).fill('AB12')
    await page.getByRole('button', { name: /empezar|^start$/i }).click()
    const finish = page.getByRole('button', { name: /terminar|finish/i })
    await expect(finish).toBeDisabled()
    await expect(page.getByTestId('quiz-l1')).toHaveCount(0)
    await page
      .getByTestId('quiz-q1')
      .getByText(/entender por qué|understanding why/i)
      .click()
    await page
      .getByLabel(
        /Explica con tus palabras qué es la IA explicable|Explain in your own words what explainable AI is/i,
      )
      .fill('La XAI ayuda a entender decisiones de un modelo.')
    await expect(page.getByText(/cuánta confianza|how confident/i)).toHaveCount(0)
    await expect(finish).toBeDisabled()
    for (let question = 2; question <= 12; question++) {
      await page.getByTestId(`quiz-q${question}`).getByRole('radio').last().check()
    }
    await expect(finish).toBeDisabled()
    await consentToQuizSubmission(page)
    await expect(finish).toBeEnabled()
    await finish.click()
    await expect(page.getByTestId('quiz-score')).toHaveText(/1 de 12|1 of 12/)

    await page.getByText(/para el profesorado|for teachers/i).click()
    await expect(page.getByText(/ahora hay 2|there are 2 now/i)).toBeVisible()
  })

  test('advanced final test has no confidence prompts and ends with the XAI question', async ({
    page,
  }) => {
    await page.goto('/quiz?phase=post')
    await page.getByLabel(/tu código|your code/i).fill('ADV01')
    await page.getByLabel(/avanzado|advanced/i).check()
    await page.getByRole('button', { name: /empezar|^start$/i }).click()

    await expect(page.getByText(/radiografías|x-rays/i)).toBeVisible()
    await page
      .getByTestId('quiz-q1')
      .getByText(/atajo|shortcut/i)
      .click()
    await page
      .getByLabel(/explica con tus palabras qué es XAI|explain in your own words what XAI is/i)
      .fill('Explica las decisiones del modelo.')
    await expect(page.getByText(/cuánta confianza|how confident/i)).toHaveCount(0)
    const finish = page.getByRole('button', { name: /terminar|finish/i })
    await expect(finish).toBeDisabled()
    for (let question = 2; question <= 12; question++) {
      await page.getByTestId(`quiz-q${question}`).getByRole('radio').last().check()
    }
    await expect(finish).toBeDisabled()
    await consentToQuizSubmission(page)
    await expect(finish).toBeEnabled()
    await finish.click()

    await expect(page.getByTestId('quiz-score')).toHaveText(/1 de 12|1 of 12/)
    await expect(page.getByText(/rúbrica orientativa.*0–2|suggested rubric.*0–2/i)).toBeVisible()
  })
})

test.describe('Lab CV tabs', () => {
  test('tools, challenges and missions show the prepared challenge photos', async ({ page }) => {
    await page.goto('/lab')
    await expect(page.getByRole('heading', { level: 1, name: 'Lab CV' })).toBeVisible()
    await expect(page.locator('#main header').first().locator('img')).toHaveAttribute(
      'src',
      '/icons/lab-cv-search.png',
    )
    await page.getByRole('tab', { name: /retos|challenges/i }).click()
    const cracks = page.getByTestId('cv-challenge-concrete_crack')
    const pneumonia = page.getByTestId('cv-challenge-pneumonia')
    await expect(cracks).toContainText(/25 fotos preparadas|25 prepared photos/)
    await expect(pneumonia).toContainText(/40 fotos preparadas|40 prepared photos/)
    await expect(cracks.getByTestId('cv-challenge-missing')).toHaveCount(0)
    await expect(pneumonia.getByTestId('cv-challenge-missing')).toHaveCount(0)

    await page.getByRole('tab', { name: /misiones|missions/i }).click()
    await page.getByTestId('cv-mission-shortcut').getByRole('checkbox').check()
    await page.reload()
    await page.getByRole('tab', { name: /misiones|missions/i }).click()
    await expect(page.getByTestId('cv-mission-shortcut').getByRole('checkbox')).toBeChecked()
    await page
      .getByTestId('cv-mission-shortcut')
      .getByRole('button', { name: /retos|challenges/i })
      .click()
    await expect(page.getByRole('tab', { name: /retos|challenges/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
})
