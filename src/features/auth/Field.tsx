import { useId, type InputHTMLAttributes } from 'react'

/**
 * A labelled text field with an optional hint, wired for assistive technology.
 *
 * Extracted because the three auth screens between them render nine of these and
 * the part that is easy to get wrong is the same every time: the label's `for`,
 * the hint's `aria-describedby`, and the 44 px touch floor (FR-046, SC-009). One
 * component means one place where those are right.
 */

export function Field({
  label,
  hint,
  inputRef,
  ...input
}: {
  readonly label: string
  readonly hint?: string
  readonly inputRef?: React.Ref<HTMLInputElement>
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        {...input}
        id={id}
        ref={inputRef}
        aria-describedby={hint ? hintId : input['aria-describedby']}
        className="min-h-touch w-full rounded border border-border-subtle bg-surface px-2"
      />
      {hint ? (
        <p id={hintId} className="max-w-prose text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
