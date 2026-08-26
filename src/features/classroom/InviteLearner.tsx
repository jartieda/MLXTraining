import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { CopyToClipboard } from '@/components/CopyToClipboard'
import { Field } from '@/features/auth/Field'
import { invitationTtlHours } from '@/lib/supabase'
import { issueLearnerInvitation, type IssueFailure } from './api'

/**
 * T106 / FR-026, FR-028, Edge Cases — issuing one learner invitation.
 *
 * **The code is shown once, and that is a property of the system rather than a choice
 * of this screen.** Only its hash is stored (I2, R15), so there is nothing to show
 * again later — and the panel says so, because an educator who assumes she can look it
 * up will close it and then have a learner she cannot admit. The username is displayed
 * alongside it for the same reason: she has to hand over both, and this is the one
 * moment she needs them together.
 *
 * **There is no email option** (FR-026). A learner's code is handed over in person,
 * and the application holds no address for her to send it to anyway. Offering a "send
 * it" button would imply a channel that does not exist — R16's whole point.
 *
 * The refusals are separated because they need different actions. A username already
 * held by an account is unrecoverable: pick another. An unredeemed invitation for the
 * same username is recoverable: revoke that one first. Collapsing them into "that
 * username is not available" sends her to the wrong remedy half the time.
 */

export function InviteLearner({
  classroomId,
  onIssued,
}: {
  readonly classroomId: string
  /** So the pending list refreshes without this component knowing how. */
  readonly onIssued: () => void
}) {
  const { t } = useTranslation(['classroom', 'common'])

  const [username, setUsername] = useState('')
  const [issued, setIssued] = useState<{ username: string; code: string } | null>(null)
  const [failure, setFailure] = useState<IssueFailure | null>(null)
  const [busy, setBusy] = useState(false)

  async function issue(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setFailure(null)
    const result = await issueLearnerInvitation(classroomId, username)
    setBusy(false)

    if (!result.ok) {
      setFailure(result.failure)
      return
    }

    setIssued({ username: username.trim(), code: result.code })
    setUsername('')
    onIssued()
  }

  if (issued) {
    return (
      <section
        aria-labelledby="issued-heading"
        data-testid="invitation-issued"
        className="flex flex-col gap-3 rounded-lg border border-blue bg-surface p-4"
      >
        <h3 id="issued-heading" className="text-base font-semibold">
          {t('classroom:invite.issuedHeading')}
        </h3>

        {/* Said before the code, not after. Afterwards is where she has already
            stopped reading. */}
        <p className="max-w-prose text-sm font-medium">{t('classroom:invite.shownOnce')}</p>

        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-sm text-ink-muted">{t('classroom:invite.usernameLabel')}</dt>
            <dd className="font-mono text-lg" data-testid="issued-username">
              {issued.username}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">{t('classroom:invite.codeLabel')}</dt>
            <dd
              className="font-mono text-2xl tracking-[0.3em] uppercase"
              data-testid="issued-code"
            >
              {issued.code}
            </dd>
          </div>
        </dl>

        <CopyToClipboard
          value={t('classroom:invite.copyPayload', {
            username: issued.username,
            code: issued.code,
          })}
          label={t('classroom:invite.copyBoth')}
        />

        <p className="max-w-prose text-sm text-ink-muted">
          {t('classroom:invite.expiry', { hours: invitationTtlHours() })}
        </p>
        {/* FR-026: in person. Stated, so the absence of a send button reads as a
            decision rather than as a missing feature. */}
        <p className="max-w-prose text-sm text-ink-muted">{t('classroom:invite.inPerson')}</p>

        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setIssued(null)
            }}
          >
            {t('classroom:invite.inviteAnother')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
      <h3 id="invite-heading" className="text-base font-semibold">
        {t('classroom:invite.heading')}
      </h3>
      <p className="max-w-prose text-sm text-ink-muted">{t('classroom:invite.intro')}</p>

      <form className="flex flex-col gap-3" onSubmit={(event) => void issue(event)} noValidate>
        <Field
          label={t('classroom:invite.usernameLabel')}
          hint={t('classroom:invite.usernameHint')}
          name="learnerUsername"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value)
          }}
          required
          minLength={3}
          maxLength={24}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        <p role="alert" aria-live="polite" className="text-sm text-magenta">
          {failure ? t(`classroom:invite.failure.${failure}`) : null}
        </p>

        <Button type="submit" disabled={busy || username.trim().length < 3}>
          {busy ? t('classroom:invite.issuing') : t('classroom:invite.submit')}
        </Button>
      </form>
    </section>
  )
}
