import { test, expect, type Page } from '@playwright/test'

/**
 * The Lab LLM's A/B comparator, driven with a fake engine injected through
 * `window.__ML4G_FAKE_LLM_ENGINE__`, so the run needs no model download (the model CDN
 * is not reachable from every school or corporate network) and its answers are known.
 *
 * The fake answers a closed question with A unless the prompt sounds negative, gives
 * two next-word candidates whose order depends on «jefa», and writes a slow free-text
 * answer so the stop button can be exercised.
 */
async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NEGATIVE = /harta|fed up|No es saludable dormir|Isn't it healthy/i
    const lp = (p: number) => Math.log(p)
    ;(window as unknown as Record<string, unknown>).__ML4G_FAKE_LLM_ENGINE__ = {
      backend: 'gpu',
      nextTokenAlternatives: (prompt: string, prefix = '') => {
        if (/letra de la opción|letter of the option/i.test(prompt)) {
          const negative = NEGATIVE.test(prompt)
          return Promise.resolve([
            { token: negative ? 'B' : 'A', logprob: lp(0.8) },
            { token: negative ? 'A' : 'B', logprob: lp(0.1) },
            { token: 'Hmm', logprob: lp(0.05) },
          ])
        }
        if (prefix.length > 0) return Promise.resolve([{ token: '.', logprob: lp(0.99) }])
        const feminine = /jefa|she/i.test(prompt)
        return Promise.resolve([
          { token: feminine ? 'simpática' : 'exigente', logprob: lp(0.5) },
          { token: feminine ? 'exigente' : 'estricto', logprob: lp(0.2) },
        ])
      },
      generate: (_messages: unknown, _max: number, signal?: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve('Rosalía no ha ganado el Premio Nobel de Literatura.')
          }, 1500)
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
  await page.getByRole('tab', { name: /comparar dos prompts|compare two prompts/i }).click()
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

  test('fits a 360 px screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openComparator(page)
    await page.getByRole('button', { name: /^comparar$|^compare$/i }).click()
    await expect(page.getByTestId('compare-verdict')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
