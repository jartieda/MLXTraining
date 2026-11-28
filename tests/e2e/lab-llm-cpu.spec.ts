import { expect, test, type Page } from '@playwright/test'

async function mockQwenCpuLoad(page: Page): Promise<void> {
  await page.route(/\/onnx\.worker(?:-[^/]+)?\.(?:js|ts)(?:\?|$)/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      self.onmessage = ({ data }) => {
        if (data.type !== 'load') return
        self.postMessage(data.model === 'qwen' ? { result: undefined } : { error: 'Expected Qwen' })
      }
    `,
  }))
}

test('loads Qwen automatically on a CPU-only device and reports the engine', async ({ page }) => {
  const downloads: string[] = []
  page.on('request', request => {
    if (request.url().includes('huggingface.co')) downloads.push(request.url())
  })
  await mockQwenCpuLoad(page)
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }))
  await page.goto('/lab-llm')

  const ready = page.getByText(/(?:Modelo listo en la CPU|Model ready on the CPU): Qwen 2.5/)
  await expect(ready).toBeVisible()
  await expect(page.getByRole('button', { name: 'Qwen', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'GPU (WebGPU)', exact: true })).toHaveCount(0)
  expect(downloads).toEqual([])

  await page.getByRole('button', { name: 'Gemma 4 E2B', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Qwen', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(ready).toBeVisible()
})

test('automatically falls back to CPU when WebGPU exists but its model download fails', async ({ page }) => {
  await mockQwenCpuLoad(page)
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: () => Promise.resolve({}) },
  }))
  let blocked = 0
  await page.route('https://huggingface.co/**', route => {
    blocked++
    return route.abort('failed')
  })
  await page.goto('/lab-llm')
  await expect(page.getByText(/(?:Modelo listo en la CPU|Model ready on the CPU): Qwen 2.5/)).toBeVisible()
  expect(blocked).toBeGreaterThan(0)
})
