import { useRef, useState } from 'react'
import {useNavigate} from 'react-router'
import { TextLink } from '@/components/TextLink'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { invitationTtlHours, type RedemptionRefusal } from '@/lib/supabase'
import { CodeInput } from './CodeInput'
import { Field } from './Field'
import { isCompleteCode, redeemInvitation } from './redemption'
import { signIn } from './session'

/**
 * T074 / FR-027, FR-028, FR-051, R15 — the only route to an account.
 *
 * She holds two things her educator gave her — a username and a six-character
 * code — and chooses two of her own: a password and a display name. The password
 * is set inside `redeem_invitation`, which is why no educator can ever read it
 * (FR-027); there is no step at which it passes through anyone else's hands.
 *
 * The username field is not sent to the database. `redeem_invitation` derives the
 * account from the invitation the code identifies and never trusts an argument for
 * it. What the field is for is **signing her in afterwards**: Scenario 4.1 says the
 * account is usable immediately, and the auth provider needs the identifier that
 * `authIdentifierFor` derives from her username. If she mistypes it, the account
 * still exists and the page says so rather than implying the redemption failed —
 * the code is single-use, so telling her to start again would strand her.
 *
 * The three terminal refusals are shown distinctly (FR-028) and the two
 * indistinguishable ones are not pulled apart (SC-020). Both properties are
 * decided in `classifyRedemptionError` against the database's own wording.
 */

export function RedeemPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const aliasRef = useRef<HTMLInputElement>(null)

  const [credential, setCredential] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [alias, setAlias] = useState('')

  const [refusal, setRefusal] = useState<RedemptionRefusal | null>(null)
  const [localProblem, setLocalProblem] = useState<'passwordMismatch' | null>(null)
  const [stranded, setStranded] = useState(false)
  const [busy, setBusy] = useState(false)

  const complete =
    credential.trim() !== '' && isCompleteCode(code) && password !== '' && alias.trim() !== ''

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setRefusal(null)
    setLocalProblem(null)
    setStranded(false)

    // Checked here rather than at the database, because a mistyped confirmation is
    // not a failed guess at a code and must not spend one of her five attempts.
    if (password !== confirmation) {
      setLocalProblem('passwordMismatch')
      return
    }

    setBusy(true)
    const outcome = await redeemInvitation({ code, password, alias })

    if (!outcome.ok) {
      setBusy(false)
      setRefusal(outcome.refusal)
      // FR-051: an alias already taken in her classroom is the one refusal she can
      // fix on the spot, so the form keeps everything else and puts her cursor
      // where the fix goes.
      if (outcome.refusal === 'aliasTaken' || outcome.refusal === 'aliasLength') {
        aliasRef.current?.focus()
        aliasRef.current?.select()
      }
      return
    }

    const signedIn = await signIn(credential, password)
    setBusy(false)

    if (!signedIn.ok) {
      // The account exists. The code is spent. Saying "that did not work" here
      // would be false and would send her back to an educator she does not need.
      setStranded(true)
      return
    }

    void navigate('/projects')
  }

  if (stranded) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="font-display text-2xl">{t('redeem.title')}</h1>
        <p role="alert" className="max-w-prose">
          {t('redeem.signInAfterwards')}
        </p>
        <TextLink to="/login">
          {t('login.submit')}
        </TextLink>
      </div>
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('redeem.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('redeem.intro')}</p>
      </header>

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

        <CodeInput value={code} onChange={setCode} labelKey="label" disabled={busy} />

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

        <Field
          label={t('field.aliasLabel')}
          hint={t('field.aliasHint')}
          inputRef={aliasRef}
          name="alias"
          value={alias}
          onChange={(event) => {
            setAlias(event.target.value)
          }}
          required
          minLength={2}
          maxLength={24}
        />

        <p role="alert" aria-live="polite" className="text-sm text-magenta">
          {localProblem ? t(`field.${localProblem}`) : null}
          {refusal ? t(`refusal.${refusal}`, { hours: invitationTtlHours() }) : null}
        </p>

        <Button type="submit" disabled={busy || !complete}>
          {busy ? t('redeem.working') : t('redeem.submit')}
        </Button>
      </form>

      {/* Stated on the screen where she is handing over a password, which is the
          one moment she is most likely to wonder what else is being collected. */}
      <p className="max-w-prose text-sm text-ink-muted">{t('redeem.privacy')}</p>
    </div>
  )
}
