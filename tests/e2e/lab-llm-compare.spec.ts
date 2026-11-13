import { test, expect, type Page } from '@playwright/test'

/**
 * The Lab LLM's A/B comparator, driven with a fake engine injected through
 * `window.__ML4G_FAKE_LLM_ENGINE__`, so the run needs no model download (the model CDN
 * is not reachable from every school or corporate network) and its answers are known.
 *
 * The fake answers a closed question with A unless the prompt sounds negative, gives
 * two next-word candidates whose order depends on «jefa», and writes a slow free-text
 * answer so the stop button can be exercised. In the jacket example only «contenta»
 * keeps the answer positive and «ayudado» helps a little, which gives the word lens a
 * known result.
 */
async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NEGATIVE = /harta|fed up|No es saludable dormir|Isn't it healthy/i
    const lp = (p: number) => Math.log(p)
    ;(window as unknown as Record<string, unknown>).__ML4G_FAKE_LLM_ENGINE__ = {
      backend: 'gpu',
      nextTokenAlternatives: (prompt: string, prefix = '') => {
        if (/letra de la opción|letter of the option/i.test(prompt)) {
          // The jacket example is only positive while «contenta» is in it, so the lens
          // finds that one word.
          const jacketWithoutHappy = /chaqueta|jacket/i.test(prompt) && !/contenta|happy/i.test(prompt)
          const negative = NEGATIVE.test(prompt) || jacketWithoutHappy
          // «ayudado» also holds the answer up, less: the lens's second word.
          let top = /chaqueta|jacket/i.test(prompt) && !/ayudado|helped/i.test(prompt) ? 0.5 : 0.8
          // The job application: a little less «Yes» for her than for him, slowly enough
          // that an audit of ten queries can be stopped half-way.
          const application = /desarroll|developer/i.test(prompt)
          if (application && /\bher\b|desarrolladora/i.test(prompt)) top = 0.6
          const reply = [
            { token: negative ? 'B' : 'A', logprob: lp(top) },
            { token: negative ? 'A' : 'B', logprob: lp(0.1) },
            { token: 'Hmm', logprob: lp(0.05) },
          ]
          return application ? new Promise((resolve) => setTimeout(() => resolve(reply), 120)) : Promise.resolve(reply)
        }
        if (prefix.length > 0) return Promise.resolve([{ token: '.', logprob: lp(0.99) }])
        const feminine = /jefa|she/i.test(prompt)
        return Promise.resolve([
          { token: feminine ? 'simpática' : 'exigente', logprob: lp(0.5) },
          { token: feminine ? 'exigente' : 'estricto', logprob: lp(0.2) },
        ])
      },
      generate: (messages: { content: string }[], _max: number, signal?: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          // Asked which words influenced it, the fake names one the lens agrees with
          // and two it does not: «coinciden en parte».
          const content = messages[0]?.content ?? ''
          const selfReport = /entre comillas|quotation marks/i.test(content)
          const reply = /quotation marks/i.test(content)
            ? 'Positive. "happy" "jacket" "favorite"'
            : 'Positivo. "contenta" "chaqueta" "favorita"'
          const timer = setTimeout(() => {
            resolve(selfReport ? reply : 'Rosalía no ha ganado el Premio Nobel de Literatura.')
          }, selfReport ? 50 : 1500)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            const error = new Error('stopped')
            error.name = 'LlmAbortedError'
            reject(error)
          })
        }),
      unload: () => Promise.resolve(),
    }
  })
}

async function openComparator(page: Page): Promise<void> {
  await withFakeEngine(page)
  await page.goto('/lab-llm')
  await page.getByRole('tab', { name: /herramientas|tools/i }).click()
  await expect(page.getByRole('button', { name: /^comparar$|^compare$/i })).toBeEnabled()
}

test.describe('Lab LLM — compare two prompts', () => {
  test('the sentiment example: one word flips the answer and the verdict says so', async ({ page }) => {
    await openComparator(page)

    // The lab's own sentiment example is prompt A, and only one word differs.
    await expect(page.getByTestId('compare-diff')).toContainText(/contenta|happy/)
    await expect(page.getByTestId('compare-diff')).not.toContainText(/cambiar solo una|changing just one/i)

    await page.getByRole('button', { name: /^no$/i }).click()
    await page.getByRole('button', { name: /^comparar$|^compare$/i }).click()

    await expect(page.getByTestId('compare-band')).toHaveText(/cambio grande|big change/i)
    await expect(page.getByTestId('compare-verdict')).toContainText(/apostaste|your bet/i)
    // C was not among the reported tokens: "not measured", never 0 %.
    await expect(page.getByTestId('compare-column-a')).toContainText(/no está entre las 3 primeras|not in the top 3/i)
  })

  test('warns when more than one thing changes, without blocking', async ({ page }) => {
    await openComparator(page)
    await page.getByRole('textbox', { name: /prompt b/i }).fill('Ayer encontré una chaqueta nueva preciosa y estoy feliz.')
    await expect(page.getByTestId('compare-diff')).toContainText(/cambiar solo una|changing just one/i)
    await expect(page.getByRole('button', { name: /^comparar$|^compare$/i })).toBeEnabled()
  })

  test('compares by answer, not by letter, when the options are swapped', async ({ page }) => {
    await openComparator(page)
    await page.getByLabel(/caso preparado|prepared case/i).selectOption('promptOrder')
    await expect(page.getByText(/orden inverso|reverse order/i)).toBeVisible()
    await page.getByRole('button', { name: /^comparar$|^compare$/i }).click()
    // The fake always picks letter A, i.e. a different answer in B: position bias.
    await expect(page.getByTestId('compare-band')).toHaveText(/cambio grande|big change/i)
  })

  test('next-word stereotypes and saving an experiment on the device', async ({ page }) => {
    await openComparator(page)
    await page.getByLabel(/caso preparado|prepared case/i).selectOption('biasStereotype')
    await page.getByRole('button', { name: /^comparar$|^compare$/i }).click()
    await expect(page.getByTestId('compare-band')).toHaveText(/cambio grande|big change/i)

    await page.getByRole('button', { name: /guardar experimento|save experiment/i }).click()
    await expect(page.getByText(/guardado en este dispositivo|saved on this device/i)).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: /estereotipos|stereotypes/i })).toBeVisible()
  })

  test('a free-text comparison can be stopped', async ({ page }) => {
    await openComparator(page)
    await page.getByLabel(/caso preparado|prepared case/i).selectOption('falsePremise')
    await page.getByRole('button', { name: /^comparar$|^compare$/i }).click()
    await page.getByRole('button', { name: /^parar$|^stop$/i }).click()
    await expect(page.getByText(/comparación parada|comparison stopped/i)).toBeVisible()
  })

  test('the word lens finds the word that holds up the answer, and the model only partly agrees', async ({ page }) => {
    await openComparator(page)
    await expect(page.getByText(/19 consultas|19 times/)).toBeVisible()
    await page.getByRole('button', { name: /pasar la lupa|use the lens/i }).click()
    await expect(page.getByTestId('lens-summary')).toContainText(/más pesa es «contenta»|matters most is “happy”/i)

    await page.getByRole('button', { name: /preguntar al modelo|ask the model/i }).click()
    await expect(page.getByTestId('self-report-band')).toHaveText(/coinciden en parte|partly match/i)
  })

  test('the audit of five pairs gives a table and an average, and can be stopped', async ({ page }) => {
    await openComparator(page)
    await page.getByLabel(/caso preparado|prepared case/i).selectOption('biasName')
    const audit = page.getByTestId('audit')
    await audit.getByRole('button', { name: /auditar 5 pares|audit 5 pairs/i }).click()
    await expect(page.getByText(/par 1 de 5|pair 1 of 5/i)).toBeVisible()
    await page.getByRole('button', { name: /^parar$|^stop$/i }).click()
    await expect(page.getByText(/auditoría parada|audit stopped/i)).toBeVisible()

    await audit.getByRole('button', { name: /auditar 5 pares|audit 5 pairs/i }).click()
    // Only Lucía / Javier differs (her vs him): 20 points in one pair, 4 on average.
    await expect(page.getByTestId('audit-band')).toHaveText(/casi igual|almost the same/i, { timeout: 10_000 })
    await expect(page.getByTestId('audit-verdict')).toContainText(/1 de 5 pares|1 of 5 pairs/i)
    await expect(audit.getByRole('row', { name: /Lucía \/ Javier/ })).toContainText('+20')
  })

  test('one prompt, two models: A waits while the model is switched', async ({ page }) => {
    await openComparator(page)
    await page.getByRole('button', { name: /un prompt, dos modelos|one prompt, two models/i }).click()
    await page.getByRole('button', { name: /probar con gemma|try with gemma/i }).click()
    const step2 = page.getByTestId('two-models-step2')
    await expect(step2).toContainText(/cambia de modelo|switch model/i)
    await expect(step2.getByRole('button', { name: /probar con|try with/i })).toBeDisabled()

    await page.getByRole('button', { name: /^llama$/i }).click()
    await step2.getByRole('button', { name: /probar con llama|try with llama/i }).click()
    await expect(page.getByTestId('compare-result')).toContainText(/gemma.*llama/i)
    await expect(page.getByTestId('compare-band')).toHaveText(/casi igual|almost the same/i)
  })

  test('«Repeat 5 times» is a mock-up and says so', async ({ page }) => {
    await openComparator(page)
    const mockup = page.getByTestId('repeat-mockup')
    await expect(mockup.getByTestId('repeat-badge')).toHaveText(/próximamente|coming soon/i)
    await expect(mockup).toContainText(/siempre igual|always answers the same/i)
    await expect(mockup.getByRole('button', { name: /repetir 5 veces|repeat 5 times/i })).toBeDisabled()
  })

  test('fits a 360 px screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openComparator(page)
    await page.getByRole('button', { name: /^comparar$|^compare$/i }).click()
    await expect(page.getByTestId('compare-verdict')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
