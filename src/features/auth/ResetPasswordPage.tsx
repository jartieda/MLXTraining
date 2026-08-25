import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { invitationTtlHours, type RedemptionRefusal } from '@/lib/supabase'
import { CodeInput } from './CodeInput'
import { Field } from './Field'
import { RESET_ALIAS_PLACEHOLDER, isCompleteCode, redeemInvitation } from './redemption'
import { signIn } from './session'

/**
 * T075 / FR-030, R16 — a reset with no email exchange anywhere in it.
 *
 * A reset is a fresh invitation of the same shape against an account that already
 * exists, so it goes through the same `redeem_invitation` call. Her display name
 * and every row she owns are untouched; only the credential changes.
 *
 * **There is no "send me a reset link" affordance, and this page explains why
 * rather than leaving a gap.** The lab holds no address for a learner (FR-029), so
 * a link that promised mail would be a lie, and a dead one would send her hunting.
 * R16 accepts this cost explicitly — she depends on an adult being available — and
 * the mitigation is the sentence stating that the whole local lab still works
 * meanwhile, which is true and is the thing she actually needs to hear.
 */

export function ResetPasswordPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()

  const [credential, setCredential] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')

  const [refusal, setRefusal] = useState<RedemptionRefusal | null>(null)
  const [localProblem, setLocalProblem] = useState<'passwordMismatch' | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const complete = credential.trim() !== '' && isCompleteCode(code) && password !== ''

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setRefusal(null)
    setLocalProblem(null)

    if (password !== confirmation) {
      setLocalProblem('passwordMismatch')
      return
    }

    setBusy(true)
    const outcome = await redeemInvitation({
      code,
      password,
      // Ignored by the database on a reset, which is why the form does not ask.
      alias: RESET_ALIAS_PLACEHOLDER,
    })

    if (!outcome.ok) {
      setBusy(false)
      setRefusal(outcome.refusal)
      return
    }

    const signedIn = await signIn(credential, password)
    setBusy(false)

    if (!signedIn.ok) {
      // The password did change. Sending her back to the code entry would be
      // wrong twice over: the code is spent, and the new password already works.
      setDone(true)
      return
    }

    void navigate('/projects')
  }

  if (done) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="font-display text-2xl">{t('reset.title')}</h1>
        <p role="alert" className="max-w-prose">
          {t('reset.success')}
        </p>
        <Link to="/login" className="font-medium text-blue">
          {t('login.submit')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('reset.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('reset.intro')}</p>
      </header>

      <p className="max-w-prose rounded-lg border border-border-subtle bg-surface p-4 text-sm">
        {t('reset.onlyEducator')}
      </p>

      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        <Field
          label={t('login.credentialLabel')}
          hint={t('login.credentialHint')}
          name="credential"
          value={credential}
          onChange={(event) => {
            setCredential(event.target.value)
          }}
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        <CodeInput value={code} onChange={setCode} labelKey="resetLabel" disabled={busy} />

        <Field
          label={t('field.passwordLabel')}
          hint={t('field.passwordHint')}
          type="password"
          name="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          required
          minLength={8}
          autoComplete="new-password"
        />

        <Field
          label={t('field.confirmLabel')}
          type="password"
          name="passwordConfirmation"
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value)
          }}
          required
          autoComplete="new-password"
        />

        <p role="alert" aria-live="polite" className="text-sm text-magenta">
          {localProblem ? t(`field.${localProblem}`) : null}
          {refusal ? t(`refusal.${refusal}`, { hours: invitationTtlHours() }) : null}
        </p>

        <Button type="submit" disabled={busy || !complete}>
          {busy ? t('reset.working') : t('reset.submit')}
        </Button>
      </form>
    </div>
  )
}
