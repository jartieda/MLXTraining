/**
 * T014 / FR-017, R3, R6 — the heat-map legend.
 *
 * The labels are relative ("low evidence" → "high evidence"), never numeric, and that is
 * a correctness requirement rather than a simplification: every map is normalised by its
 * own maximum (R3), so the hottest cell is 1.0 in every map regardless of how strong the
 * evidence actually was. Printing "1.0" or "100%" would invite a learner to compare two
 * maps as if the scale were absolute, which it is not.
 *
 * Colour stops arrive from `legendStops()` in src/ml/explain/colormap.ts — the one place
 * Principle V exempts from the token rule so the ramp can be perceptually uniform (R6).
 */

export interface LegendProps {
  /** CSS colour strings, coldest first. Produced by `legendStops(count)`. */
  readonly stops: readonly string[]
  readonly lowLabel: string
  readonly highLabel: string
  readonly caption?: string
  readonly className?: string
}

export function Legend({ stops, lowLabel, highLabel, caption, className = '' }: LegendProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div
        // The gradient itself carries no information a sighted user needs beyond the two
        // end labels, which are real text, so the strip is decorative to assistive tech.
        aria-hidden="true"
        className="flex h-3 w-full overflow-hidden rounded-full border border-border-subtle"
      >
        {stops.map((colour, index) => (
          <span
            key={`${colour}-${String(index)}`}
            className="h-full flex-1"
            style={{ backgroundColor: colour }}
          />
        ))}
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-ink-muted">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
      {caption ? <p className="text-xs text-ink-muted">{caption}</p> : null}
    </div>
  )
}
