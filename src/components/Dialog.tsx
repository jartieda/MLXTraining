import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * T014 / FR-046, SC-009 — a modal built on the native `<dialog>` element.
 *
 * Native `showModal()` is used rather than a hand-rolled overlay because it brings focus
 * trapping, the top layer, inert background content and `Escape` handling for free, all
 * of which are the parts a custom modal reliably gets wrong and `axe` reliably catches
 * (SC-009 requires zero violations).
 *
 * Cancellation is routed through the `cancel` event so that `Escape` and the close button
 * take the same path — otherwise a learner who dismisses with the keyboard leaves the
 * caller's state unchanged while the dialogue disappears.
 */

export interface DialogProps {
  readonly open: boolean
  readonly title: string
  /** Called for the close button, `Escape`, and a backdrop click alike. */
  readonly onClose: () => void
  readonly children: ReactNode
  /** Footer actions, typically a confirm and a cancel. */
  readonly actions?: ReactNode
  readonly closeLabel: string
  /**
   * A destructive confirmation should not be dismissible by a stray backdrop tap on a
   * phone, where the modal occupies most but not all of the screen.
   */
  readonly dismissOnBackdrop?: boolean
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
  closeLabel,
  dismissOnBackdrop = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useRef(`dialog-title-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handleCancel = (event: Event) => {
      // Prevent the default close so React state stays the single source of truth for
      // whether the dialogue is open; otherwise `open` and `el.open` diverge.
      event.preventDefault()
      onClose()
    }
    el.addEventListener('cancel', handleCancel)
    return () => {
      el.removeEventListener('cancel', handleCancel)
    }
  }, [onClose])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId.current}
      onClick={(event) => {
        if (!dismissOnBackdrop) return
        // A click landing on the dialogue element itself, rather than a child, is a
        // backdrop click — `<dialog>` gives no separate backdrop node to listen on.
        if (event.target === ref.current) onClose()
      }}
      className={[
        'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg bg-surface p-0 text-ink shadow-lg',
        'backdrop:bg-navy/50',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border-subtle p-4">
        <h2 id={titleId.current} className="text-lg font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="-m-2 flex min-h-touch min-w-touch items-center justify-center rounded text-ink-muted hover:bg-surface-sunken"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="p-4">{children}</div>

      {actions ? (
        // Column on a phone, row above it: two side-by-side buttons at 360 px either
        // wrap awkwardly or shrink below the touch floor (FR-045, FR-046).
        <div className="flex flex-col gap-2 border-t border-border-subtle p-4 sm:flex-row sm:justify-end">
          {actions}
        </div>
      ) : null}
    </dialog>
  )
}
