import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Field } from './Field'
import { signIn, type SignInFailure } from './session'

/**
 * T073 / FR-024, FR-025, R16 — sign-in for all three roles.
 *
 * One credential field, not two, and not a role picker. A learner types the
 * username her educator gave her; an educator types the email address she was
 * invited by. `authIdentifierFor` decides which is which on the `@`, so nobody has
 * to declare a role before she has proved anything — and a role picker would tell
 * an attacker which namespace a given string lives in.
 *
 * What is deliberately absent matters as much as what is here. **There is no
 * sign-up link, no sign-up route, and no sign-up form** (FR-024). Rather than
 * leaving that as an absence a future contributor might helpfully fill in, the
 * page says so in words: an account comes from an invitation, and that is the
 * whole mechanism.
 *
 * The "forgotten your password" affordance is a link to a code-entry screen, not
 * a mail form. R16 accepts having no self-service recovery as the price of holding
 * no contact detail, and the honest treatment is to state the consequence rather
 * than offer a button that cannot work.
 */

export function LoginPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()

  const [credential, setCredential] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<SignInFailure | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setFailure(null)
    const result = await signIn(credential, password)
    setBusy(false)

    if (!result.ok) {
      setFailure(result.failure)
      // Cleared on failure, kept on the credential field. Retyping a username she
      // read off a slip of paper is the annoying half; the password she knows.
      setPassword('')
      return
    }

    void navigate('/projects')
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t('login.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('login.intro')}</p>
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

        <Field
          label={t('login.passwordLabel')}
          type="password"
          name="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          required
          autoComplete="current-password"
        />

        {/* One region, always in the tree, so a refusal is announced rather than
            appearing silently for anyone using a screen reader. */}
        <p role="alert" aria-live="polite" className="text-sm text-magenta">
          {failure ? t(`error.${failure}`) : null}
        </p>

        <Button type="submit" disabled={busy || credential.trim() === '' || password === ''}>
          {busy ? t('login.working') : t('login.submit')}
        </Button>
      </form>

      <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
        <h2 className="text-base font-semibold">{t('login.noSignUpTitle')}</h2>
        <p className="max-w-prose text-sm">{t('login.noSignUpBody')}</p>
        <Link to="/redeem" className="text-sm font-medium text-blue">
          {t('login.haveCode')}
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t('login.forgotTitle')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('login.forgotBody')}</p>
        <Link to="/reset" className="text-sm font-medium text-blue">
          {t('login.forgotAction')}
        </Link>
      </section>
    </div>
  )
}
