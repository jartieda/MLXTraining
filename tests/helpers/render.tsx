import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18next from '@/lib/i18n'
import { initI18n, setLocale, type Locale } from '@/lib/i18n'

/**
 * Renders a component with the providers the application gives it.
 *
 * The real i18n instance is used, not a stub that echoes keys back. Two reasons:
 * a test asserting on `capture.classes.duplicate` passes whether or not that key
 * exists, and half the interface's job here is the wording — a refusal that
 * fails to name the empty class is the defect Acceptance Scenario 1.3 is about,
 * and only real strings can catch it.
 */

export async function setupI18n(locale: Locale = 'en'): Promise<void> {
  await initI18n()
  await setLocale(locale)
}

export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string } = {},
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18next}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>
    )
  }

  return render(ui, { wrapper: Wrapper })
}

/** A 1×1 JPEG-ish blob. Enough for a sample record; nothing decodes it. */
export function stubImageBlob(bytes = 64): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
}

export function stubEmbedding(size = 512, fill = 0.5): Float32Array {
  return new Float32Array(size).fill(fill)
}
