/**
 * T014 — a labelled proportion bar, used for per-class confidence (FR-011) and for the
 * storage budget (FR-049).
 *
 * Deliberately a `meter` role rather than `progressbar`: a confidence figure is a
 * measurement within a known range, not progress toward completion, and screen readers
 * announce the two differently. `ProgressBar` is the separate component for the other
 * case.
 *
 * The numeric value is always rendered as text next to the bar. A bar alone encodes the
 * number in length only, which fails SC-009 for anyone who cannot see it and is also
 * simply harder to read for everyone.
 */

export type MeterTone = 'neutral' | 'leading' | 'warn' | 'good'

export interface MeterProps {
  readonly label: string
  /** 0–1. Clamped, because a probability arriving as 1.0000001 must not overflow. */
  readonly value: number
  readonly tone?: MeterTone
  /** Formatted value shown beside the label. Defaults to a whole percentage. */
  readonly valueText?: string
  readonly className?: string
}

const TONE: Record<MeterTone, string> = {
  neutral: 'bg-sky-500',
  // The predicted class. Blue is the action/attention colour in the palette.
  leading: 'bg-blue',
  // Amber and green are fill-only per R12 — used here as bar fill, never as text.
  warn: 'bg-amber',
  good: 'bg-green',
}

export function Meter({ label, value, tone = 'neutral', valueText, className = '' }: MeterProps) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const percent = Math.round(clamped * 100)
  const text = valueText ?? `${String(percent)}%`

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink">{label}</span>
        <span className="shrink-0 text-sm tabular-nums text-ink-muted">{text}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={text}
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-(--tv-motion-duration) ${TONE[tone]}`}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </div>
  )
}
