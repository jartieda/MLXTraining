import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * T014 / FR-045, FR-046, Principle V.
 *
 * Every colour here is a Tailwind utility backed by a Technovation token; the
 * ml4g/no-raw-hex-or-font-family lint rule fails the build on a literal.
 *
 * `min-h-touch` is the 44 px floor from FR-046 and is not optional per variant — a
 * "small" button that a learner cannot reliably tap on a phone is a defect, so `size`
 * changes padding and type scale but never drops below the floor.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** Renders a spinner and disables the control, keeping the label readable. */
  readonly busy?: boolean
  /** Stretches to the container. The default on narrow screens for primary actions. */
  readonly block?: boolean
  readonly children: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  // Blue is the action colour (R12). White-on-blue clears AA comfortably.
  primary: 'bg-blue text-ink-inverse hover:opacity-90 active:opacity-80',
  secondary: 'bg-surface text-ink border border-border-subtle hover:bg-surface-sunken',
  ghost: 'bg-transparent text-blue-ink hover:bg-surface-sunken',
  // Magenta rather than a red outside the palette. Destructive actions in this product
  // are rare and always confirmed, so the colour signals "stop and read", not "error".
  danger: 'bg-magenta text-ink-inverse hover:opacity-90',
}

const SIZE: Record<ButtonSize, string> = {
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
}

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  block = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // `busy` must disable as well as announce: a learner tapping Train twice while the
      // first run is still spinning up would start two training runs on one project.
      disabled={disabled ?? busy}
      aria-busy={busy || undefined}
      className={[
        'inline-flex items-center justify-center gap-2',
        'min-h-touch rounded font-body font-medium',
        'transition-opacity duration-(--tv-motion-duration)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        block ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      <span>{children}</span>
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  )
}
