import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { CopyToClipboard } from '@/components/CopyToClipboard'
import { Field } from '@/features/auth/Field'
import { invitationTtlHours } from '@/lib/supabase'
import { handoverMailto, issueEducatorInvitation, type AdminFailure } from './api'

/**
 * T131 / FR-053, R15 — inviting an educator.
 *
 * **The lab sends no email, and this component is the whole reason that is possible.**
 * A `mailto:` opens the administrator's *own* mail client with the recipient and the
 * message prefilled; she presses send, from her address, through her provider. So
 * there is no SMTP configuration in this project, no queue, no bounce handling, and
 * no service holding a list of educator addresses — which is a meaningful reduction
 * in what the project has to be trusted with, for a feature that would otherwise be
 * a week of work and a permanent operational obligation.
 *
 * The fallback matters as much as the primary path. A Chromebook in a school often
 * has no mail client registered, so `mailto:` does nothing at all — silently. Hence
 * copy-to-clipboard is offered alongside rather than behind a failure, and the code
 * is on screen either way.
 *
 * Like every invitation in the system the code is shown **once**: only its hash is
 * stored (I2), so there is nothing to show again, and the panel says so before it
 * shows the code rather than after.
 */

export function InviteEducator({ onIssued }: { readonly onIssued: () => void }) {
  const { t } = useTranslation(['admin', 'common'])

  const [email, setEmail] = useState('')
  const [issued, setIssued] = useState<{ email: string; code: string } | null>(null)
  const [failure, setFailure] = useState<AdminFailure | null>(null)
  const [busy, setBusy] = useState(false)

  async function issue(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setFailure(null)
    const result = await issueEducatorInvitation(email)
    setBusy(false)

    if (!result.ok) {
      setFailure(result.failure)
      return
    }

    setIssued({ email: email.trim().toLowerCase(), code: result.code })
    setEmail('')
    onIssued()
  }

  if (issued) {
    const hours = invitationTtlHours()
    const body = t('admin:invite.mailBody', { code: issued.code, hours })

    return (
      <section
        aria-labelledby="educator-issued"
        data-testid="educator-invitation-issued"
        className="flex flex-col gap-3 rounded-lg border border-blue bg-surface p-4"
      >
        <h3 id="educator-issued" className="text-base font-semibold">
          {t('admin:invite.issuedHeading', { email: issued.email })}
        </h3>

        <p className="max-w-prose text-sm font-medium">{t('admin:invite.shownOnce')}</p>

        <p className="font-mono text-2xl tracking-[0.3em] uppercase" data-testid="educator-code">
          {issued.code}
        </p>

        <div className="flex flex-wrap gap-2">
          {/* Rendered as a link rather than a button calling `window.open`: a link
              lets her middle-click, and a popup blocker cannot silently swallow it. */}
          <a
            href={handoverMailto(issued.email, t('admin:invite.mailSubject'), body)}
            className="flex min-h-touch items-center rounded bg-blue px-4 text-sm font-medium text-ink-inverse no-underline"
            data-testid="handover-mailto"
          >
            {t('admin:invite.openMail')}
          </a>
          <CopyToClipboard value={body} label={t('admin:invite.copyMessage')} />
        </div>

        {/* Said plainly, because "open my mail client" reads to most people as "the
            app is emailing her". It is not, and the difference is the whole reason
            this project holds no mail credentials. */}
        <p className="max-w-prose text-sm text-ink-muted">{t('admin:invite.weSendNothing')}</p>
        <p className="max-w-prose text-sm text-ink-muted">
          {t('admin:invite.noMailClient')}
        </p>
        <p className="text-sm text-ink-muted">{t('admin:invite.expiry', { hours })}</p>

        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setIssued(null)
            }}
          >
            {t('admin:invite.inviteAnother')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="invite-educator" className="flex max-w-xl flex-col gap-3">
      <h3 id="invite-educator" className="text-base font-semibold">
        {t('admin:invite.heading')}
      </h3>
      <p className="max-w-prose text-sm text-ink-muted">{t('admin:invite.intro')}</p>

      <form className="flex flex-col gap-3" onSubmit={(event) => void issue(event)} noValidate>
        <Field
          label={t('admin:invite.emailLabel')}
          hint={t('admin:invite.emailHint')}
          type="email"
          name="educatorEmail"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        <p role="alert" aria-live="polite" className="text-sm text-magenta">
          {failure ? t(`admin:failure.${failure}`) : null}
        </p>

        <Button type="submit" disabled={busy || !email.includes('@')}>
          {busy ? t('admin:invite.issuing') : t('admin:invite.submit')}
        </Button>
      </form>
    </section>
  )
}
