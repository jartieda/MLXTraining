import { Link, type LinkProps } from 'react-router'

/**
 * T116 / FR-046 — a navigation link that clears the 44 px touch floor.
 *
 * It exists because the floor was eroding one call site at a time. Thirteen
 * `<Link className="text-blue">` had accumulated across the features, each
 * individually reasonable and each a 24 px target on a phone. `Button` has owned
 * the floor since T014; this is the same idea for the links that are navigation
 * rather than prose.
 *
 * `inline-flex` rather than `block`, so a link at the end of a paragraph still sits
 * on the text baseline instead of becoming a full-width band. The `min-height` still
 * applies, which is what makes it tappable.
 *
 * **`inline` is the deliberate exception, not a loophole.** WCAG 2.5.8 exempts a
 * target that is inline within a sentence, because enlarging it would break the line
 * it belongs to. Use it only for a link genuinely embedded in running text, and
 * prefer restructuring the sentence so the link stands alone — a link on its own line
 * is both more tappable and easier to find.
 */
export function TextLink({
  variant = 'standalone',
  className = '',
  ...props
}: LinkProps & { readonly variant?: 'standalone' | 'inline' }) {
  const base =
    variant === 'inline'
      ? 'font-medium text-blue-ink underline'
      : 'inline-flex min-h-touch items-center gap-1 font-medium text-blue-ink'

  return <Link {...props} className={`${base} ${className}`.trim()} />
}
