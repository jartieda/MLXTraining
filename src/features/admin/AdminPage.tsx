import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/features/auth/session'
import {
  listAdminClassrooms,
  listEducators,
  listIssuedInvitations,
  type AdminClassroom,
  type EducatorSummary,
  type IssuedInvitation,
} from './api'
import { EducatorList } from './EducatorList'
import { InviteEducator } from './InviteEducator'
import { ReassignClassroom } from './ReassignClassroom'

/**
 * T131–T134 assembled / FR-053–FR-057, SC-018 — the administration screen.
 *
 * **Everything on this page is about adults.** Invite an educator, see the educators
 * and the invitations issued, deactivate an account, move a classroom. There is no
 * search, no learner list, no export, and no route from here into a classroom's
 * contents — because there is no policy that would let one work (FR-055), and because
 * this directory cannot even import the on-device sample store (lint rule).
 *
 * The page states its own limits rather than leaving them to be discovered. An
 * administrator who cannot find the learners will otherwise assume the feature is
 * missing and ask for it; telling her it is deliberate, and why, is the difference
 * between a constraint that holds and one that gets filed as a bug.
 *
 * **There is no path to create an administrator** (FR-056), here or anywhere. The
 * first one is seeded by migration. That absence is stated on the page for the same
 * reason.
 */
export function AdminPage() {
  const { t } = useTranslation(['admin', 'common'])
  const account = useSession((state) => state.account)
  const status = useSession((state) => state.status)

  const [educators, setEducators] = useState<readonly EducatorSummary[]>([])
  const [invitations, setInvitations] = useState<readonly IssuedInvitation[]>([])
  const [classrooms, setClassrooms] = useState<readonly AdminClassroom[]>([])
  const [loading, setLoading] = useState(true)

  const administratorId = account?.role === 'administrator' ? account.id : null

  const reload = useCallback(async () => {
    if (!administratorId) {
      setLoading(false)
      return
    }
    const [people, issued, rooms] = await Promise.all([
      listEducators(),
      listIssuedInvitations(administratorId),
      listAdminClassrooms(),
    ])
    setEducators(people)
    setInvitations(issued)
    setClassrooms(rooms)
    setLoading(false)
  }, [administratorId])

  useEffect(() => {
    if (status === 'loading') return
    void reload()
  }, [status, reload])

  if (status !== 'loading' && !administratorId) {
    // Not a redirect, for the same reason the classroom page is not: an account that
    // followed a link deserves an answer rather than being bounced.
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">{t('admin:title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('common:error.forbidden')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('admin:title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('admin:intro')}</p>
      </header>

      {/* FR-055 / SC-018, stated as a feature rather than left as an absence. */}
      <section
        aria-labelledby="admin-scope"
        data-testid="admin-scope-note"
        className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      >
        <h2 id="admin-scope" className="text-base font-semibold">
          {t('admin:scope.heading')}
        </h2>
        <p className="max-w-prose text-sm">{t('admin:scope.body')}</p>
        <p className="max-w-prose text-sm">{t('admin:scope.noAdmins')}</p>
      </section>

      {loading ? <p className="text-ink-muted">{t('common:action.loading')}</p> : null}

      <InviteEducator onIssued={() => void reload()} />

      <EducatorList
        educators={educators}
        invitations={invitations}
        currentAdministratorId={administratorId ?? ''}
        onChanged={() => void reload()}
      />

      <ReassignClassroom
        classrooms={classrooms}
        educators={educators}
        onChanged={() => void reload()}
      />
    </div>
  )
}
