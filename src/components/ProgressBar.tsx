/**
 * T014 — progress toward completion, with a cancel affordance.
 *
 * Used by training (FR-007) and by occlusion (FR-014), both of which are long enough on a
 * phone that an uncancellable indeterminate spinner would read as a hang. The
 * `indeterminate` case exists for the interval before the first epoch or chunk reports.
 */

import type { ReactNode } from 'react'

export interface ProgressBarProps {
  readonly label: string
  /** 0–1, or `null` when the total is not yet known. */
  readonly value: number | null
  /** e.g. "Epoch 4 of 20" — the human-readable detail beneath the bar. */
  readonly detail?: string
  readonly action?: ReactNode
  readonly className?: string
}

export function ProgressBar({ label, value, detail, action, className = '' }: ProgressBarProps) {
  const indeterminate = value === null || !Number.isFinite(value)
  const percent = indeterminate ? 0 : Math.round(Math.min(1, Math.max(0, value)) * 100)

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        {indeterminate ? null : (
          <span className="shrink-0 text-sm tabular-nums text-ink-muted">{percent}%</span>
        )}
      </div>

      <div
        role="progressbar"
        aria-label={label}
        // Omitting aria-valuenow is what marks a progressbar indeterminate; setting it to
        // 0 would announce "0%" and stall there, which reads as broken.
        {...(indeterminate ? {} : { 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue motion-reduce:w-full motion-reduce:animate-none" />
        ) : (
          <div
            className="h-full rounded-full bg-blue transition-[width] duration-(--tv-motion-duration)"
            style={{ width: `${String(percent)}%` }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* aria-live so a learner using a screen reader hears progress without polling.
            `polite` rather than `assertive`: epoch updates must not interrupt her. */}
        <span aria-live="polite" className="text-sm text-ink-muted">
          {detail ?? ''}
        </span>
        {action}
      </div>
    </div>
  )
}
