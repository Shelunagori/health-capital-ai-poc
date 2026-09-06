import { Outcome, type EligibilityResult } from './rules.js';

/**
 * The explanation the platform produces on its own, with no model involved.
 *
 * This is what a member sees when the AI provider is unconfigured, unavailable, or contradicted by
 * the verdict guard. It is written from the decision, so it can never disagree with it.
 */
const formatAmount = (cents: number): string => `${(cents / 100).toFixed(2)}`;

export function templateExplanation(result: EligibilityResult): string {
  const reasons = result.reasons.map((r) => r.message).join(' ');
  const receipt = result.conditions.includes('RECEIPT_REQUIRED')
    ? ' Keep the receipt: this category needs one.'
    : '';

  switch (result.outcome) {
    case Outcome.ELIGIBLE:
      return `You can use your health capital for this expense. ${reasons}${receipt}`;
    case Outcome.PARTIALLY_ELIGIBLE:
      return (
        `You can use your health capital for part of this expense: ` +
        `${formatAmount(result.coveredAmountCents ?? 0)} of it. ${reasons}${receipt}`
      );
    case Outcome.INELIGIBLE:
      return `You cannot use your health capital for this expense. ${reasons}`;
    case Outcome.UNDETERMINED:
      return (
        `We could not check this expense right now, so no decision has been made. ` +
        `${reasons} Please try again shortly.`
      );
  }
}
