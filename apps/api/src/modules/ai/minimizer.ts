import type { EligibilityResult } from '../eligibility/index.js';
import {
  AiSafeExplanationContextSchema,
  AiSafeToolResultSchema,
  type AiSafeExplanationContext,
  type AiSafeToolResult,
} from './types.js';

/**
 * Builds the only structures a provider ever receives.
 *
 * Every schema is strict, so an extra key is rejected rather than quietly forwarded. The functions
 * name each field they emit, which means widening what a model sees is an edit here, reviewed on
 * its own, rather than a side effect of adding a column somewhere else.
 */
export interface DecisionContextSource {
  result: EligibilityResult;
  treatmentCategory: string;
  expenseAmountCents: number;
  serviceDate: string;
  availableBalanceCents: number | null;
  remainingCategoryLimitCents: number | null;
}

export function toAiSafeExplanationContext(
  source: DecisionContextSource,
): AiSafeExplanationContext {
  const context = {
    treatmentCategory: source.treatmentCategory,
    expenseAmountCents: source.expenseAmountCents,
    serviceDate: source.serviceDate,
    outcome: source.result.outcome,
    coveredAmountCents: source.result.coveredAmountCents,
    availableBalanceCents: source.availableBalanceCents,
    remainingCategoryLimitCents: source.remainingCategoryLimitCents,
    conditions: source.result.conditions,
    // Rule references and codes only. The prose in a reason is written for a member, not a model,
    // and sending it would let the model paraphrase text it did not need to see.
    reasons: source.result.reasons.map((reason) => ({
      ruleRef: reason.ruleRef,
      code: reason.code,
    })),
    engineVersion: source.result.engineVersion,
  };

  // Parsing rather than casting: an unexpected field fails here instead of reaching a provider.
  return AiSafeExplanationContextSchema.parse(context) as AiSafeExplanationContext;
}

export function toAiSafeBalanceResult(availableCents: number, currency: string): AiSafeToolResult {
  return AiSafeToolResultSchema.parse({ availableCents, currency }) as AiSafeToolResult;
}

export interface CoveredCategorySource {
  category: string;
  covered: boolean;
  annualLimitCents: number | null;
  substantiation: string;
}

export function toAiSafeCategoriesResult(
  categories: readonly CoveredCategorySource[],
): AiSafeToolResult {
  return AiSafeToolResultSchema.parse({
    categories: categories.map((rule) => ({
      category: rule.category,
      covered: rule.covered,
      annualLimitCents: rule.annualLimitCents,
      receiptRequired: rule.substantiation === 'RECEIPT_REQUIRED',
    })),
  }) as AiSafeToolResult;
}

export function toAiSafeDecisionResult(
  result: EligibilityResult,
  treatmentCategory: string,
  requestedAmountCents: number,
): AiSafeToolResult {
  return AiSafeToolResultSchema.parse({
    outcome: result.outcome,
    coveredAmountCents: result.coveredAmountCents,
    requestedAmountCents,
    treatmentCategory,
    conditions: result.conditions,
    reasons: result.reasons.map((reason) => ({ ruleRef: reason.ruleRef, code: reason.code })),
  }) as AiSafeToolResult;
}

/** A tool that could not run. The message is fixed text, never an exception or a stack. */
export function toAiSafeToolError(message: string): AiSafeToolResult {
  return AiSafeToolResultSchema.parse({ error: message.slice(0, 120) }) as AiSafeToolResult;
}
