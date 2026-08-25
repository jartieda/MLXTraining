import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { CODE_LENGTH, normaliseCode } from './redemption'

/**
 * T074 / FR-028, I6 — the six-character code field.
 *
 * Shared by redemption and password reset because the code is the same object in
 * both: a single-use bearer credential drawn from the same 32-symbol alphabet.
 *
 * It is one input rather than six boxes. Six boxes look tidier and break paste,
 * screen readers, and the browser's own autofill, for a code that is dictated
 * aloud in a classroom and pasted from a message about equally often.
 *
 * Normalisation happens on the way in, so the field only ever holds characters a
 * real code could contain. That is what makes "check it with whoever gave it to
 * you" honest advice: a refusal is then about the code, not about a lowercase
 * letter or a stray space.
 */

export function CodeInput({
  value,
  onChange,
  labelKey,
  disabled = false,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly labelKey: 'label' | 'resetLabel'
  readonly disabled?: boolean
}) {
  const { t } = useTranslation('auth')
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {t(`code.${labelKey}`)}
      </label>
      <input
        id={id}
        name="invitationCode"
        value={value}
        onChange={(event) => {
          onChange(normaliseCode(event.target.value))
        }}
        disabled={disabled}
        required
        maxLength={CODE_LENGTH}
        minLength={CODE_LENGTH}
        inputMode="text"
        // A code is uppercase, so a phone keyboard should not open in lower case
        // and autocorrect must not "fix" a six-character non-word into a word.
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="one-time-code"
        aria-describedby={hintId}
        className="min-h-touch w-full max-w-[12ch] rounded border border-border-subtle bg-surface px-2 font-mono text-lg tracking-[0.35em] uppercase"
      />
      <p id={hintId} className="max-w-prose text-sm text-ink-muted">
        {t('code.hint')}
      </p>
    </div>
  )
}
