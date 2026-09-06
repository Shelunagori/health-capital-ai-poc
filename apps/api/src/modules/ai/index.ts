/**
 * The AI boundary. Only branded, minimized types cross it, and a provider can explain a decision
 * but never make one.
 */
export {
  AiSafeExplanationContextSchema,
  AiSafeToolResultSchema,
  type AIProvider,
  type AiSafeExplanationContext,
  type AiSafeToolResult,
  type AiUserQuery,
  type AiUserQueryShape,
  type ModelToolCall,
  type StructuredRequest,
  type ToolDefinition,
  type ToolExchange,
  type ToolTurnRequest,
  type ToolTurnResult,
} from './types.js';
export { AiUnavailableError, withTimeout, AI_CALL_TIMEOUT_MS } from './errors.js';
export {
  sanitizeUserQuery,
  MAX_QUERY_LENGTH,
  RedactionKind,
  type KnownProfileValues,
} from './sanitizer.js';
export {
  toAiSafeExplanationContext,
  toAiSafeBalanceResult,
  toAiSafeCategoriesResult,
  toAiSafeDecisionResult,
  toAiSafeToolError,
  type CoveredCategorySource,
  type DecisionContextSource,
} from './minimizer.js';
export {
  STAGE_A_PROMPT,
  STAGE_B_PROMPT,
  EXPLANATION_RESPONSE_SCHEMA,
  type PromptTemplate,
} from './prompts/index.js';
export { NullProvider } from './providers/null.js';
export { FakeProvider, type FakeScript } from './providers/fake.js';
export { GeminiProvider, DEFAULT_GEMINI_MODEL } from './providers/gemini.js';
