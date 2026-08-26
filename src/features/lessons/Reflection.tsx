import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { questionKey, type ModuleId } from '@/content/lessons/schema'
import { AUTOSAVE_DELAY_MS, REFLECTION_MAX_LENGTH } from './progress'

/**
 * T098 / FR-035, L4 — write, store, revisit, revise.
 *
 * "Revise in place" is the requirement, and the design follows from it: there is one
 * textarea holding the current answer, not an answer plus an edit form. A learner
 * returning to a module sees what she wrote, in an editable field, and changing it
 * replaces it — which is exactly what L4's unique constraint enforces underneath.
 *
 * **There is no save button** (FR-035). The three things that make that safe rather
 * than merely tidy:
 *
 *   - a debounce, so a paragraph is one write rather than eighty;
 *   - a flush on unmount, so navigating away mid-sentence still saves;
 *   - a visible status, because autosave without feedback is indistinguishable from
 *     silent data loss, and a 14-year-old who has written three sentences about bias
 *     deserves to know they are safe.
 *
 * The status is `aria-live="polite"` and not `assertive`: it fires on every save and
 * an assertive region would interrupt a screen-reader user mid-word, repeatedly.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'anonymous'

export function Reflection({
  moduleId,
  questionId,
  initialAnswer,
  onSave,
  canSave,
}: {
  readonly moduleId: ModuleId
  readonly questionId: string
  readonly initialAnswer: string
  readonly onSave: (questionId: string, answer: string) => Promise<boolean>
  /** `false` for an anonymous visitor: she may write, nothing is recorded. */
  readonly canSave: boolean
}) {
  const { t } = useTranslation(['lessons', 'common'])
  const fieldId = useId()

  const [answer, setAnswer] = useState(initialAnswer)
  const [status, setStatus] = useState<SaveState>(canSave ? 'idle' : 'anonymous')

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Held in a ref as well as in state so the unmount flush reads the latest value:
  // the cleanup closure captures the value from its own render, which is stale by
  // exactly the keystrokes this flush exists to save.
  const latest = useRef(initialAnswer)
  const lastSaved = useRef(initialAnswer)

  // Re-syncs when the answer arrives from the server after first paint. Guarded on
  // the saved marker so it cannot overwrite something she is in the middle of typing.
  useEffect(() => {
    if (lastSaved.current === initialAnswer) return
    lastSaved.current = initialAnswer
    latest.current = initialAnswer
    setAnswer(initialAnswer)
  }, [initialAnswer])

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      // Fire and forget on the way out. There is no component left to report to, and
      // the alternative — losing the edit — is worse than an unobserved failure.
      if (canSave && latest.current !== lastSaved.current) {
        void onSave(questionId, latest.current)
      }
    }
  }, [canSave, onSave, questionId])

  function change(value: string) {
    setAnswer(value)
    latest.current = value
    if (!canSave) return

    if (timer.current) clearTimeout(timer.current)
    setStatus('saving')
    timer.current = setTimeout(() => {
      void onSave(questionId, value).then((ok) => {
        if (ok) lastSaved.current = value
        setStatus(ok ? 'saved' : 'failed')
      })
    }, AUTOSAVE_DELAY_MS)
  }

  const remaining = REFLECTION_MAX_LENGTH - answer.length

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="font-medium">
        {t(`lessons:${questionKey(moduleId, questionId)}`)}
      </label>

      <textarea
        id={fieldId}
        value={answer}
        onChange={(event) => {
          change(event.target.value)
        }}
        rows={4}
        maxLength={REFLECTION_MAX_LENGTH}
        // Her own words about her own model. Autocorrect fighting her is worse than
        // a typo in a reflection nobody is marking for spelling.
        spellCheck
        className="w-full rounded border border-border-subtle bg-surface p-2"
      />

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-muted">
        <p aria-live="polite" data-testid={`reflection-status-${questionId}`}>
          {status === 'saving' ? t('lessons:reflection.saving') : null}
          {status === 'saved' ? t('lessons:reflection.saved') : null}
          {status === 'failed' ? t('lessons:reflection.failed') : null}
          {status === 'anonymous' ? t('lessons:reflection.notSaved') : null}
        </p>
        {/* Only near the limit. A counter always on invites a learner to write to
            length rather than to the question. */}
        {remaining < 200 ? <p>{t('lessons:reflection.remaining', { count: remaining })}</p> : null}
      </div>
    </div>
  )
}
