import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TextLink } from '@/components/TextLink'
import { useSession } from '@/features/auth/session'
import type { AccountRole } from '@/lib/database.types'

/**
 * T135 / FR-055 — route guards.
 *
 * Two directions, and they exist for different reasons.
 *
 * **An administrator is kept out of the lab, the lessons and the classroom** because
 * FR-055 forbids her reaching classroom content, and a lesson page or a project list
 * is classroom content — a learner's, if she happens also to hold a learner account,
 * but more importantly it is a surface that will grow. Today `/lab` under an
 * administrator session shows her own empty IndexedDB; the guard is what stops that
 * from quietly becoming a route into someone else's the day the feature changes.
 *
 * **A learner or educator is kept out of `/admin`** for the ordinary reason.
 *
 * **These guards are convenience, not enforcement, and that framing matters.** The
 * enforcement is the row-level-security policies: an administrator hitting `/lessons`
 * with a modified client gets zero rows because no policy grants her any, and the
 * whole `tests/db/` suite exists to prove it. A guard in the client is removable by
 * anyone with developer tools open, so treating it as the boundary would be a mistake.
 * What it buys is that the interface never *offers* a route it will then refuse.
 *
 * It renders a refusal rather than redirecting. A redirect from a link an adult was
 * given loses the information that the link was wrong, and sends her somewhere she
 * did not ask to go — twice as confusing when she does have an account, just not that
 * one.
 */

export function RoleGate({
  allow,
  /** `true` when an unauthenticated visitor may pass (FR-023 routes). */
  allowAnonymous = false,
  children,
}: {
  readonly allow: readonly AccountRole[]
  readonly allowAnonymous?: boolean
  readonly children: ReactNode
}) {
  const { t } = useTranslation('common')
  const { status, account } = useSession()

  // Never refuse while the stored session is still resolving: a refusal shown for
  // 300 ms and then replaced is worse than a moment of nothing, because a learner
  // reads it and navigates away.
  if (status === 'loading') {
    return (
      <p aria-live="polite" className="text-ink-muted">
        {t('action.loading')}
      </p>
    )
  }

  const permitted = account ? allow.includes(account.role) : allowAnonymous
  if (permitted) return <>{children}</>

  return (
    <div className="flex flex-col gap-3" data-testid="role-refused">
      <h1 className="font-display text-2xl">{t('error.forbidden')}</h1>
      <p className="max-w-prose text-ink-muted">
        {account ? t('error.forbiddenForRole') : t('error.forbiddenSignIn')}
      </p>
      <TextLink to={account?.role === 'administrator' ? '/admin' : '/'}>
        {account?.role === 'administrator' ? t('nav.admin') : t('nav.home')}
      </TextLink>
    </div>
  )
}

/**
 * The FR-023 routes: an anonymous visitor, a learner and an educator may all pass;
 * an administrator may not (FR-055).
 *
 * An educator is allowed because she has to work through the lab herself to teach it
 * — she is an adult with her own projects, and nothing on these routes reads a
 * learner's.
 */
export function LearnerRoute({ children }: { readonly children: ReactNode }) {
  return (
    <RoleGate allow={['learner', 'educator']} allowAnonymous>
      {children}
    </RoleGate>
  )
}
