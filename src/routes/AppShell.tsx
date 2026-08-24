import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useSession } from '@/features/auth/session'
import type { AccountRole } from '@/lib/database.types'

/**
 * T034 / FR-045, FR-046, SC-009 — the application shell.
 *
 * Mobile-first: the default layer IS the 360 px layout (SC-004's constitutional
 * floor), and `md` is the first breakpoint where anything becomes a second
 * column. Building it the other way round is how a "responsive" interface ends up
 * with a control clipped off the right edge of a phone.
 *
 * The navigation is a plain horizontal scroller rather than a hamburger menu. At
 * five items or fewer a drawer costs a tap, hides the destinations, and needs its
 * own focus management — three costs for no benefit at this size.
 */

interface NavItem {
  readonly to: string
  readonly labelKey: string
  /** `null` means visible to everyone, including an anonymous visitor. */
  readonly roles: readonly AccountRole[] | null
}

const NAV: readonly NavItem[] = [
  // FR-023: the lab and projects are reachable with no account at all, and they
  // come first because for an anonymous visitor they are the entire product.
  { to: '/projects', labelKey: 'nav.projects', roles: null },
  { to: '/lab', labelKey: 'nav.lab', roles: null },
  { to: '/lessons', labelKey: 'nav.lessons', roles: ['learner', 'educator'] },
  { to: '/classroom', labelKey: 'nav.classroom', roles: ['educator'] },
  { to: '/admin', labelKey: 'nav.admin', roles: ['administrator'] },
]

export function AppShell() {
  const { t } = useTranslation('common')
  const { status, account } = useSession()

  const visible = NAV.filter((item) => {
    if (item.roles === null) {
      // An administrator reaches no lab, lesson or classroom-content route at all
      // (FR-055), so even the universally-visible items are hidden from her.
      return account?.role !== 'administrator'
    }
    return account ? item.roles.includes(account.role) : false
  })

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      {/* SC-009: the first focusable element, so a keyboard-only learner can pass
          the navigation instead of tabbing through it on every page. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-blue focus:px-4 focus:py-2 focus:text-ink-inverse"
      >
        {t('app.skipToContent')}
      </a>

      <header className="border-b border-border-subtle bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-3">
            <NavLink to="/" className="font-display text-lg font-bold text-ink no-underline">
              {t('app.name')}
            </NavLink>
            <LanguageSwitcher className="md:hidden" />
          </div>

          <div className="flex items-center gap-3">
            <nav aria-label={t('nav.label')}>
              {/* Horizontal scroll rather than wrap: a wrapping nav changes the
                  page's vertical rhythm as the item count changes with role. */}
              <ul className="-mx-1 flex list-none items-center gap-1 overflow-x-auto p-0">
                {visible.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        [
                          'flex min-h-touch items-center rounded px-3 text-sm font-medium whitespace-nowrap no-underline',
                          isActive ? 'bg-sky-100 text-navy' : 'text-ink-muted hover:bg-surface-sunken',
                        ].join(' ')
                      }
                    >
                      {t(item.labelKey)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>

            <LanguageSwitcher className="hidden md:inline-flex" />

            {status === 'signed-in' && account ? (
              // Her alias, never her username (FR-025). The username is not even
              // readable through `profiles`, so there is nothing else to show.
              <span className="text-sm text-ink-muted">{account.displayName ?? account.alias}</span>
            ) : (
              <NavLink
                to="/login"
                className="flex min-h-touch items-center rounded px-3 text-sm font-medium text-blue no-underline"
              >
                {t('nav.login')}
              </NavLink>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {/* Lazy-loaded routes keep TensorFlow.js and the lesson content out of the
            initial bundle (SC-008's 3 s budget on a mid-range phone). */}
        <Suspense fallback={<p className="text-ink-muted">{t('action.loading')}</p>}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="border-t border-border-subtle px-4 py-4">
        <p className="mx-auto max-w-6xl text-sm text-ink-muted">{t('privacy.onDevice')}</p>
      </footer>
    </div>
  )
}

/**
 * The lab's three panels: capture, test, explain.
 *
 * Stacked in one column below `md` and three across above it (FR-045). The
 * stacking order is the order of the work — capture, then test, then explain — so
 * that scrolling down a phone follows what a learner is actually doing rather
 * than a desktop column order that happens to read left to right.
 */
export function LabLayout({
  capture,
  testing,
  explaining,
}: {
  readonly capture: React.ReactNode
  readonly testing: React.ReactNode
  readonly explaining: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <section aria-labelledby="panel-capture" className="min-w-0">
        {capture}
      </section>
      <section aria-labelledby="panel-testing" className="min-w-0">
        {testing}
      </section>
      <section aria-labelledby="panel-explaining" className="min-w-0">
        {explaining}
      </section>
    </div>
  )
}
