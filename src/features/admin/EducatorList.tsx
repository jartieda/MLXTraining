import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import {
  deactivateEducator,
  invitationState,
  revokeInvitation,
  type AdminFailure,
  type EducatorSummary,
  type IssuedInvitation,
} from './api'

/**
 * T132, T133 / FR-054, FR-056 — the educators, and the invitations she issued.
 *
 * **What is not here is the point.** No learner, no project, no run, no reflection,
 * no metric, no image (FR-055, SC-018). Every row is either an adult's profile or an
 * invitation this administrator issued herself, and the two together are the entire
 * educator-management surface.
 *
 * Two refusals are handled differently on purpose:
 *
 * - **An already-redeemed invitation offers no revoke button**, because
 *   `revoke_invitation` refuses one — the account exists and cannot be un-created.
 * - **The last administrator cannot be deactivated** (FR-056), and that refusal comes
 *   from the database rather than from a disabled button here. A client-side guard
 *   would be removed by anyone who cared to try, and the cost of getting it wrong is
 *   a program locked out of its own administration with no path back but a migration.
 *   So the button is offered, the attempt is made, and the refusal is surfaced
 *   plainly — which is also how an administrator learns the rule exists.
 */

export function EducatorList({
  educators,
  invitations,
  currentAdministratorId,
  onChanged,
}: {
  readonly educators: readonly EducatorSummary[]
  readonly invitations: readonly IssuedInvitation[]
  readonly currentAdministratorId: string
  readonly onChanged: () => void
}) {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const [pending, setPending] = useState<EducatorSummary | null>(null)
  const [failure, setFailure] = useState<AdminFailure | null>(null)
  const [busy, setBusy] = useState(false)

  const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  async function deactivate() {
    if (!pending) return
    setBusy(true)
    const problem = await deactivateEducator(pending.id)
    setBusy(false)
    setFailure(problem)
    if (!problem) {
      setPending(null)
      onChanged()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="educators-heading" className="flex flex-col gap-3">
        <h2 id="educators-heading" className="font-display text-lg">
          {t('admin:educators.heading', { count: educators.length })}
        </h2>

        {educators.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{t('admin:educators.empty')}</p>
        ) : (
          <ul role="list" className="flex list-none flex-col gap-2 p-0">
            {educators.map((educator) => (
              <li
                key={educator.id}
                data-testid={`educator-${educator.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface p-3"
              >
                <div className="flex min-w-0 flex-col">
                  {/* Her display name, not her email address. The address is the one
                      personal datum this system holds, and a roster she screen-shares
                      is not the place for it — it appears only on an invitation she
                      issued, where it is what identifies the invitation. */}
                  <span className="truncate font-medium">
                    {educator.displayName ?? t('admin:educators.unnamed')}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {t(`admin:educators.role.${educator.role}`)}
                    {' · '}
                    {educator.isActive
                      ? t('admin:educators.active')
                      : t('admin:educators.inactive')}
                  </span>
                </div>

                {educator.isActive ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFailure(null)
                      setPending(educator)
                    }}
                  >
                    {educator.id === currentAdministratorId
                      ? t('admin:educators.deactivateSelf')
                      : t('admin:educators.deactivate')}
                  </Button>
                ) : (
                  <span className="text-sm text-ink-muted">
                    {t('admin:educators.alreadyInactive')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-invitations" className="flex flex-col gap-3">
        <h2 id="admin-invitations" className="font-display text-lg">
          {t('admin:invitations.heading')}
        </h2>

        {invitations.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{t('admin:invitations.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="mb-2 text-left text-sm text-ink-muted">
                {t('admin:invitations.caption')}
              </caption>
              <thead>
                <tr className="border-b border-border-subtle">
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('admin:invitations.emailColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('admin:invitations.stateColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('admin:invitations.actionColumn')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const state = invitationState(invitation)
                  return (
                    <tr
                      key={invitation.id}
                      data-testid={`admin-invitation-${invitation.id}`}
                      className="border-b border-border-subtle"
                    >
                      <th scope="row" className="p-2 text-left font-normal">
                        {invitation.target}
                      </th>
                      <td className="p-2" data-testid={`admin-invitation-state-${invitation.id}`}>
                        {t(`admin:invitations.state.${state}`)}
                        {state === 'live' ? (
                          <span className="block text-ink-muted">
                            {t('admin:invitations.expires', {
                              date: formatter.format(new Date(invitation.expiresAt)),
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {state === 'live' ? (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              void revokeInvitation(invitation.id).then(onChanged)
                            }}
                          >
                            {t('admin:invitations.revoke')}
                          </Button>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={pending !== null}
        title={t('admin:educators.deactivateTitle', {
          name: pending?.displayName ?? t('admin:educators.unnamed'),
        })}
        closeLabel={t('common:action.close')}
        dismissOnBackdrop={false}
        onClose={() => {
          setPending(null)
          setFailure(null)
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPending(null)
                setFailure(null)
              }}
            >
              {t('common:action.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void deactivate()} disabled={busy}>
              {t('admin:educators.deactivateConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p>{t('admin:educators.deactivateBody')}</p>
          {/* The reassurance that makes this action safe to offer: her classrooms and
              her learners' work are untouched, and only her access ends. Without it an
              administrator reasonably fears she is deleting a term's work. */}
          <p className="font-medium">{t('admin:educators.deactivateKeepsWork')}</p>
          {failure ? (
            <p role="alert" className="text-sm text-magenta" data-testid="deactivate-failure">
              {t(`admin:failure.${failure}`)}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}
