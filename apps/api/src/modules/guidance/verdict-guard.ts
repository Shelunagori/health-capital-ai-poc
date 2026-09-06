import type { AiSafeExplanationContext } from '../ai/index.js';
import type { Outcome } from '../eligibility/index.js';

/**
 * Checks a model's explanation against the decision it was supposed to explain.
 *
 * The verdict is echoed back by the model alongside its wording, which turns "did the model agree
 * with the rules" from a reading exercise into a comparison. If it disagrees, or introduces a number
 * that was never in the context, the wording is discarded and the platform's own explanation is used
 * instead. The decision itself is never affected: it was made before the model was asked.
 */
export const GuardFailure = {
  VERDICT_MISMATCH: 'VERDICT_MISMATCH',
  UNKNOWN_NUMBER: 'UNKNOWN_NUMBER',
  CONTRADICTORY_WORDING: 'CONTRADICTORY_WORDING',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  EMPTY_EXPLANATION: 'EMPTY_EXPLANATION',
} as const;
export type GuardFailure = (typeof GuardFailure)[keyof typeof GuardFailure];

export type GuardResult = { ok: true } | { ok: false; failure: GuardFailure };

/** Every way a number from the context might legitimately be written. */
function allowedNumbers(context: AiSafeExplanationContext): Set<string> {
  const allowed = new Set<string>();
  const add = (value: number | null): void => {
    if (value === null) return;
    allowed.add(String(value));
    allowed.add(String(Math.abs(value)));
    const major = value / 100;
    allowed.add(major.toFixed(2));
    allowed.add(String(major));
    allowed.add(String(Math.trunc(major)));
  };

  add(context.expenseAmountCents);
  add(context.coveredAmountCents);
  add(context.availableBalanceCents);
  add(context.remainingCategoryLimitCents);

  // Dates and version strings, so quoting them back is not treated as invention.
  for (const part of context.serviceDate.split('-')) allowed.add(String(Number(part)));
  allowed.add(context.serviceDate);
  for (const part of context.engineVersion.split('.')) allowed.add(part);
  for (const reason of context.reasons) {
    for (const digits of reason.ruleRef.match(/\d+/g) ?? []) allowed.add(String(Number(digits)));
  }
  return allowed;
}

/** Words that would flatly contradict the outcome, whatever the rest of the sentence says. */
const CONTRADICTIONS: Record<Outcome, RegExp | null> = {
  ELIGIBLE: /\b(?:not eligible|cannot use|can't use|is not covered|denied)\b/i,
  PARTIALLY_ELIGIBLE: /\b(?:not eligible|cannot use|can't use|denied|in full|fully covered)\b/i,
  INELIGIBLE: /\b(?:is eligible|you can use|fully covered|approved)\b/i,
  UNDETERMINED: /\b(?:is eligible|not eligible|you can use|cannot use|approved|denied)\b/i,
};

export interface ModelExplanation {
  verdict: string;
  explanation: string;
}

/** Parses what the model returned. Anything unexpected is a malformed response, not a best effort. */
export function parseModelExplanation(value: unknown): ModelExplanation | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { verdict, explanation } = record;
  if (typeof verdict !== 'string' || typeof explanation !== 'string') return null;
  return { verdict, explanation };
}

export function checkExplanation(
  candidate: unknown,
  decisionOutcome: Outcome,
  context: AiSafeExplanationContext,
): GuardResult {
  const parsed = parseModelExplanation(candidate);
  if (parsed === null) return { ok: false, failure: GuardFailure.MALFORMED_RESPONSE };

  const explanation = parsed.explanation.trim();
  if (explanation === '') return { ok: false, failure: GuardFailure.EMPTY_EXPLANATION };

  // The decision is authoritative. A model that says otherwise has its wording dropped.
  if (parsed.verdict !== decisionOutcome) {
    return { ok: false, failure: GuardFailure.VERDICT_MISMATCH };
  }

  const contradiction = CONTRADICTIONS[decisionOutcome];
  if (contradiction !== null && contradiction.test(explanation)) {
    return { ok: false, failure: GuardFailure.CONTRADICTORY_WORDING };
  }

  const allowed = allowedNumbers(context);
  for (const raw of explanation.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const normalised = raw.replace(/,/g, '');
    if (!allowed.has(normalised) && !allowed.has(String(Number(normalised)))) {
      // A figure nobody gave it. Whether invented or calculated, it is not the platform's number.
      return { ok: false, failure: GuardFailure.UNKNOWN_NUMBER };
    }
  }

  return { ok: true };
}
