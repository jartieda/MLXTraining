import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './routes/router'
import { initI18n } from './lib/i18n'
import { useSession } from './features/auth/session'
import './styles/index.css'

/**
 * T034 — application entry.
 *
 * i18n is awaited before the first render, deliberately. Rendering first and
 * letting translations arrive shows a flash of raw key paths — `nav.projects`
 * rather than "My projects" — which is both ugly and, for a Spanish-speaking
 * learner, a flash of a language she may not read.
 *
 * The session starts as `anonymous` rather than `loading`, because FR-023 makes
 * the unauthenticated lab the whole product for a visitor with no account. US4's
 * session restoration (T073) is what will introduce a genuine loading phase; a
 * spinner now would be waiting for something nothing asks for.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Remote data here is classroom membership, progress and run metrics —
      // none of it changes second to second, and a school connection is often
      // slow. A minute of staleness costs nothing and saves a refetch on every
      // window focus.
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

async function start(): Promise<void> {
  await initI18n()
  useSession.getState().setAccount(null)

  const root = document.getElementById('root')
  if (!root) throw new Error('Root element #root is missing from index.html')

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void start()
