import type { Outcome } from '@health-capital/contracts';

/**
 * The verdict, rendered from the decision object.
 *
 * Never from the explanation text. A model writes the wording; the badge reads the field the rules
 * engine set. If the two ever disagree, the member still sees what was actually decided.
 */
const LABELS: Record<Outcome, { label: string; tone: string }> = {
  ELIGIBLE: { label: 'Covered', tone: 'eligible' },
  PARTIALLY_ELIGIBLE: { label: 'Partly covered', tone: 'partial' },
  INELIGIBLE: { label: 'Not covered', tone: 'ineligible' },
  UNDETERMINED: { label: 'Could not check', tone: 'undetermined' },
};

export function VerdictBadge({ outcome }: { outcome: Outcome }): JSX.Element {
  const { label, tone } = LABELS[outcome];
  return (
    <span className={`badge badge--${tone}`} data-testid="verdict-badge" data-outcome={outcome}>
      {label}
    </span>
  );
}
