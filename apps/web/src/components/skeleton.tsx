/**
 * A placeholder shaped like the thing that will replace it.
 *
 * Presentation only: it is always inside a container marked `aria-hidden`, with the real loading
 * message in a live region next to it, so a screen reader hears one sentence rather than a row of
 * empty boxes. The shimmer stops entirely under `prefers-reduced-motion`.
 */
export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <span className={`skeleton ${className}`.trim()} />;
}
