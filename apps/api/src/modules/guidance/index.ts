/**
 * Guidance: the member's natural-language path to a deterministic answer. The only module that
 * calls both eligibility and the AI boundary.
 */
export {
  GuidanceService,
  MAX_TOOL_ROUNDS,
  type GuidanceRequest,
  type GuidanceDeps,
} from './service.js';
export {
  ToolExecutor,
  TOOL_DEFINITIONS,
  type ToolExecutionContext,
  type ToolExecutorDeps,
} from './tools.js';
export {
  checkExplanation,
  parseModelExplanation,
  GuardFailure,
  type GuardResult,
  type ModelExplanation,
} from './verdict-guard.js';
export { registerGuidanceRoutes, type GuidanceRouteOptions } from './routes.js';
