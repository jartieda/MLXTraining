import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/features/auth/session'

/**
 * T122 / Edge Cases — "offline with an expired session".
 *
 * The Edge Cases section requires that a learner who goes offline "keep full access to
 * locally stored projects and be told that progress will sync when she is back
 * online". The first half was already true — everything that matters is in IndexedDB
 * and the ML runs on-device — and the second half was a locale string
 * (`common:error.offline`) that nothing rendered. This is the thing that renders it.
 *
 * It matters more than a status pill usually would, because in this product going
 * offline changes *nothing* about the core journey. She can still capture, train, test
 * and explain. Without a message she has no way to know that, and the reasonable
 * assumption — that a web app with no connection has stopped working — is exactly
 * wrong here. So the banner's job is reassurance, not warning.
 *
 * It is only shown to a signed-in learner. For an anonymous visitor nothing was going
 * to be saved remotely anyway (FR-023), and she already has the projects banner saying
 * so; a second notice about syncing would be noise about a thing that does not apply.
 *
 * **A cold start while offline is out of scope and worth being explicit about.** That
 * needs a service worker caching the shell and 5.4 MB of backbone weights, which this
 * project does not ship — the spec asks for offline *continuity*, not offline install.
 * A learner who reloads with no connection gets the browser's own error page.
 */
export function OfflineNotice() {
  const { t } = useTranslation('common')
  const signedIn = useSession((state) => state.status === 'signed-in')

  // Initialised from the live value rather than `true`: a learner who opens the lab
  // already offline must see this on the first paint, not after the first transition.
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    const goOffline = () => {
      setOffline(true)
    }
    const goOnline = () => {
      setOffline(false)
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline || !signedIn) return null

  return (
    // `status`, not `alert`: being offline is a condition rather than an error, and an
    // assertive region would interrupt a screen-reader user mid-sentence to announce
    // something that has not stopped her doing anything.
    <p
      role="status"
      data-testid="offline-notice"
      className="border-b border-amber bg-surface px-4 py-2 text-center text-sm"
    >
      {t('error.offline')}
    </p>
  )
}
