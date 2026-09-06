import { z } from 'zod';

/** The closed category vocabulary, shared by requests and by ledger spend. */
export const BenefitCategorySchema = z.enum([
  'PHYSICAL_THERAPY',
  'DENTAL',
  'VISION',
  'MENTAL_HEALTH',
  'PRESCRIPTION',
  'COSMETIC',
  'GYM_MEMBERSHIP',
  'OTHER',
]);
export type BenefitCategory = z.infer<typeof BenefitCategorySchema>;

export const OutcomeSchema = z.enum([
  'ELIGIBLE',
  'PARTIALLY_ELIGIBLE',
  'INELIGIBLE',
  'UNDETERMINED',
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

/**
 * A structured expense to check. There is no free-text field: a member describes what they want to
 * spend on by choosing a category, not by writing prose that would then have to be stored.
 */
export const EvaluateEligibilityRequestSchema = z
  .object({
    treatmentCategory: BenefitCategorySchema,
    expenseAmountCents: z.number().int().positive().max(100_000_000),
    serviceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be a date, as YYYY-MM-DD'),
  })
  .strict();
export type EvaluateEligibilityRequest = z.infer<typeof EvaluateEligibilityRequestSchema>;

export const DecisionReasonSchema = z
  .object({ ruleRef: z.string(), code: z.string(), message: z.string() })
  .strict();
export type DecisionReason = z.infer<typeof DecisionReasonSchema>;

export const EligibilityDecisionDtoSchema = z
  .object({
    decisionId: z.string().uuid(),
    careRequestId: z.string().uuid(),
    outcome: OutcomeSchema,
    coveredAmountCents: z.number().int().nullable(),
    requestedAmountCents: z.number().int(),
    treatmentCategory: BenefitCategorySchema,
    serviceDate: z.string(),
    reasons: z.array(DecisionReasonSchema),
    conditions: z.array(z.string()),
    engineVersion: z.string(),
    planConfigVersion: z.number().int().nullable(),
    evaluatedAt: z.string(),
  })
  .strict();
export type EligibilityDecisionDto = z.infer<typeof EligibilityDecisionDtoSchema>;

/** Where the wording came from. The verdict itself always comes from the decision. */
export const ExplanationSourceSchema = z.enum(['template', 'ai']);
export type ExplanationSource = z.infer<typeof ExplanationSourceSchema>;

export const EvaluateEligibilityResponseSchema = z
  .object({
    decision: EligibilityDecisionDtoSchema,
    explanation: z.string(),
    explanationSource: ExplanationSourceSchema,
  })
  .strict();
export type EvaluateEligibilityResponse = z.infer<typeof EvaluateEligibilityResponseSchema>;
