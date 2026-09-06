import { z } from 'zod';

/**
 * The boundary to an AI provider.
 *
 * Nothing reaches a model except through one of the branded types below. They are branded rather
 * than plain objects on purpose: a Prisma row, a member profile or a raw request body will not
 * type-check where one is expected, so widening the boundary takes a deliberate edit rather than a
 * careless argument.
 *
 * The rule this enforces is minimum-necessary context. A field is not included because the backend
 * happens to have it. It is included because a model cannot do its job without it.
 */
declare const aiSafeBrand: unique symbol;
type Branded<T, B extends string> = T & { readonly [aiSafeBrand]: B };

/** What a member typed, after normalization and redaction. Nothing else from the request goes with it. */
export interface AiUserQueryShape {
  text: string;
  /** How many values of each kind were removed. Counts only, never the values. */
  redactions: { kind: string; count: number }[];
}
export type AiUserQuery = Branded<AiUserQueryShape, 'AiUserQuery'>;

export const AiSafeBalanceResultSchema = z
  .object({ availableCents: z.number().int(), currency: z.string().length(3) })
  .strict();

export const AiSafeCategoriesResultSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            category: z.string(),
            covered: z.boolean(),
            annualLimitCents: z.number().int().nullable(),
            receiptRequired: z.boolean(),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

export const AiSafeDecisionResultSchema = z
  .object({
    outcome: z.enum(['ELIGIBLE', 'PARTIALLY_ELIGIBLE', 'INELIGIBLE', 'UNDETERMINED']),
    coveredAmountCents: z.number().int().nullable(),
    requestedAmountCents: z.number().int(),
    treatmentCategory: z.string(),
    conditions: z.array(z.string()).max(8),
    reasons: z.array(z.object({ ruleRef: z.string(), code: z.string() }).strict()).max(16),
  })
  .strict();

export const AiSafeToolErrorSchema = z.object({ error: z.string().max(120) }).strict();

/** Everything a tool may hand back to a model. Strict, so an extra key is rejected rather than sent. */
export const AiSafeToolResultSchema = z.union([
  AiSafeBalanceResultSchema,
  AiSafeCategoriesResultSchema,
  AiSafeDecisionResultSchema,
  AiSafeToolErrorSchema,
]);
export type AiSafeToolResult = Branded<z.infer<typeof AiSafeToolResultSchema>, 'AiSafeToolResult'>;

/**
 * What the explanation stage is given. Note what is absent: no identifier of any kind, no name, no
 * date of birth, no address, no employee identifier, and no history. A model writing a sentence
 * about one decision does not need to know whose decision it is.
 */
export const AiSafeExplanationContextSchema = z
  .object({
    treatmentCategory: z.string(),
    expenseAmountCents: z.number().int(),
    serviceDate: z.string(),
    outcome: z.enum(['ELIGIBLE', 'PARTIALLY_ELIGIBLE', 'INELIGIBLE', 'UNDETERMINED']),
    coveredAmountCents: z.number().int().nullable(),
    availableBalanceCents: z.number().int().nullable(),
    remainingCategoryLimitCents: z.number().int().nullable(),
    conditions: z.array(z.string()).max(8),
    reasons: z.array(z.object({ ruleRef: z.string(), code: z.string() }).strict()).max(16),
    engineVersion: z.string(),
  })
  .strict();
export type AiSafeExplanationContext = Branded<
  z.infer<typeof AiSafeExplanationContextSchema>,
  'AiSafeExplanationContext'
>;

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Never contains a member or enrollment identifier. */
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  name: string;
  /** Untrusted: whatever the model produced. Validated before anything acts on it. */
  args: unknown;
}

export interface ToolExchange {
  call: ModelToolCall;
  result: AiSafeToolResult;
}

export interface ToolTurnRequest {
  systemInstruction: string;
  promptTemplateId: string;
  promptVersion: string;
  /** The only member-authored text that ever reaches a provider, and only after sanitizing. */
  query: AiUserQuery;
  tools: ToolDefinition[];
  /** Tool calls already made in this conversation, with their results. */
  exchanges: ToolExchange[];
}

export interface ToolTurnResult {
  text: string | null;
  toolCalls: ModelToolCall[];
}

export interface StructuredRequest {
  systemInstruction: string;
  promptTemplateId: string;
  promptVersion: string;
  /** Deliberately not the user's words: the explanation stage never sees them. */
  context: AiSafeExplanationContext;
  responseSchema: Record<string, unknown>;
}

/**
 * A provider. Both methods accept only branded types, so passing a database row or a request body
 * is a compile error rather than a review comment.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** Whether this provider can actually be called. False for the null provider. */
  readonly available: boolean;
  generateWithTools(request: ToolTurnRequest): Promise<ToolTurnResult>;
  generateStructured(request: StructuredRequest): Promise<unknown>;
}
