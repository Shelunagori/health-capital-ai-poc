import { z } from 'zod';
import { EligibilityDecisionDtoSchema, ExplanationSourceSchema } from './eligibility.js';

/**
 * A member asks in their own words. The question is processed in memory and discarded: it is never
 * stored, and neither is any hash of it.
 */
export const AskGuidanceRequestSchema = z
  .object({ question: z.string().min(1).max(2_000) })
  .strict();
export type AskGuidanceRequest = z.infer<typeof AskGuidanceRequestSchema>;

/**
 * Whether the AI provider took part.
 * `ok` it answered, `degraded` it answered but its wording was not used, `unavailable` it did not answer.
 */
export const AiStatusSchema = z.enum(['ok', 'degraded', 'unavailable']);
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const AskGuidanceResponseSchema = z
  .object({
    /** Null when no decision was reached, for instance when the question was not about an expense. */
    decision: EligibilityDecisionDtoSchema.nullable(),
    explanation: z.string(),
    /** Where the wording came from. The verdict always comes from the decision. */
    explanationSource: ExplanationSourceSchema,
    aiStatus: AiStatusSchema,
  })
  .strict();
export type AskGuidanceResponse = z.infer<typeof AskGuidanceResponseSchema>;
