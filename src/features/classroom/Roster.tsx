import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import {
  invitationState,
  revokeInvitation,
  type LearnerProgress,
  type LearnerReflection,
  type LearnerRun,
  type PendingInvitation,
  type RosterEntry,
} from './api'
import { LearnerDetail } from './LearnerDetail'

/**
 * T107 / FR-040, FR-054, Scenario 6.2 — the roster and the pending invitations.
 *
 * **Two lists, and the split is a privacy decision rather than a layout one.**
 *
 * The *enrolled* list shows aliases only. Her educator issued her username and has it
 * on the slip of paper she handed over; putting it on a roster she screen-shares with
 * a class would make it a display surface for no benefit, and FR-025's rule is easiest
 * to keep when the column is never selected in the first place.
 *
 * The *pending* list shows usernames, and must. Before redemption there is no alias —
 * the learner chooses it during redemption — so the username is the only thing that
 * tells two pending invitations apart. That is a genuine need rather than convenience,
 * and it disappears the moment she redeems.
 *
 * Each row expands rather than navigating. An educator walking a room of thirty checks
 * one learner and goes back; a route per learner costs two navigations for every
 * glance, and loses her scroll position both times.
 */

export function Roster({
  classroomId,
  roster,
  invitations,
  progress,
  reflections,
  runs,
  moduleIds,
  onChanged,
}: {
  readonly classroomId: string
  readonly roster: readonly RosterEntry[]
  readonly invitations: readonly PendingInvitation[]
  readonly progress: readonly LearnerProgress[]
  readonly reflections: readonly LearnerReflection[]
  readonly runs: readonly LearnerRun[]
  readonly moduleIds: readonly string[]
  readonly onChanged: () => void
}) {
  const { t, i18n } = useTranslation(['classroom', 'common'])
  const [expanded, setExpanded] = useState<string | null>(null)
  const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  const completedByLearner = new Map<string, number>()
  for (const entry of progress) {
    if (entry.state !== 'completed') continue
    completedByLearner.set(entry.learnerId, (completedByLearner.get(entry.learnerId) ?? 0) + 1)
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="roster-heading" className="flex flex-col gap-3">
        <h2 id="roster-heading" className="font-display text-lg">
          {t('classroom:roster.heading', { count: roster.length })}
        </h2>

        {roster.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{t('classroom:roster.empty')}</p>
        ) : (
          <ul role="list" className="flex list-none flex-col gap-3 p-0">
            {roster.map((learner) => {
              const open = expanded === learner.learnerId
              return (
                <li key={learner.learnerId} data-testid={`roster-row-${learner.learnerId}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface p-3">
                    <div className="flex flex-col">
                      <span className="font-medium">{learner.alias}</span>
                      <span className="text-sm text-ink-muted">
                        {t('classroom:roster.modulesDone', {
                          done: completedByLearner.get(learner.learnerId) ?? 0,
                          total: moduleIds.length,
                        })}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      aria-expanded={open}
                      onClick={() => {
                        setExpanded(open ? null : learner.learnerId)
                      }}
                    >
                      {open ? t('classroom:roster.collapse') : t('classroom:roster.expand')}
                    </Button>
                  </div>

                  {open ? (
                    <div className="mt-2">
                      <LearnerDetail
                        classroomId={classroomId}
                        learner={learner}
                        progress={progress}
                        reflections={reflections}
                        runs={runs}
                        moduleIds={moduleIds}
                        onChanged={onChanged}
                      />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
        <h2 id="pending-heading" className="font-display text-lg">
          {t('classroom:pending.heading')}
        </h2>

        {invitations.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{t('classroom:pending.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="mb-2 text-left text-sm text-ink-muted">
                {t('classroom:pending.caption')}
              </caption>
              <thead>
                <tr className="border-b border-border-subtle">
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('classroom:pending.usernameColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('classroom:pending.kindColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('classroom:pending.stateColumn')}
                  </th>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t('classroom:pending.actionColumn')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const state = invitationState(invitation)
                  return (
                    <tr
                      key={invitation.id}
                      data-testid={`invitation-${invitation.id}`}
                      className="border-b border-border-subtle"
                    >
                      <th scope="row" className="p-2 text-left font-mono font-normal">
                        {invitation.target}
                      </th>
                      <td className="p-2">{t(`classroom:pending.purpose.${invitation.purpose}`)}</td>
                      <td className="p-2" data-testid={`invitation-state-${invitation.id}`}>
                        {t(`classroom:pending.state.${state}`)}
                        {state === 'live' ? (
                          <span className="block text-ink-muted">
                            {t('classroom:pending.expires', {
                              date: formatter.format(new Date(invitation.expiresAt)),
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {/* Only a live one can be revoked. An already-redeemed
                            invitation cannot be un-redeemed — the account exists —
                            and `revoke_invitation` refuses it, so offering the
                            button would be offering a failure. */}
                        {state === 'live' ? (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              void revokeInvitation(invitation.id).then(onChanged)
                            }}
                          >
                            {t('classroom:pending.revoke')}
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
    </div>
  )
}
