import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

/**
 * T014 — copy a value to the clipboard.
 *
 * Its one important use is handing over an invitation code (FR-026, T106): the code is
 * shown exactly once, so a silent copy failure means the educator loses it and has to
 * issue another. The failure path therefore says so and leaves the value selectable on
 * screen rather than reporting success it cannot verify.
 *
 * `navigator.clipboard` is absent on insecure origins and in some in-app browsers, which
 * is why the absence is handled rather than assumed away.
 */

export interface CopyToClipboardProps {
  readonly value: string
  readonly label?: string
  readonly className?: string
}

type State = 'idle' | 'copied' | 'failed'

export function CopyToClipboard({ value, label, className = '' }: CopyToClipboardProps) {
  const { t } = useTranslation('common')
  const [state, setState] = useState<State>('idle')

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(value)
      setState('copied')
      // Reverting is deliberate: a button stuck on "Copied" gives no signal on a second
      // press, and a second press is exactly what someone does when unsure it worked.
      setTimeout(() => {
        setState('idle')
      }, 2000)
    } catch {
      setState('failed')
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-surface-sunken px-3 py-2 text-lg tracking-[0.25em] tabular-nums select-all">
          {value}
        </code>
        <Button variant="secondary" onClick={() => void copy()}>
          {state === 'copied' ? t('action.copied') : (label ?? t('action.copy'))}
        </Button>
      </div>
      {/* Announced politely so a screen-reader user learns the outcome; a visual-only
          "Copied" tick is invisible to her. */}
      <span aria-live="polite" className="text-sm text-ink-muted">
        {state === 'failed' ? t('action.copyFailed') : ''}
      </span>
    </div>
  )
}
