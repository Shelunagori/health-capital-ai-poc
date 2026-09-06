/**
 * Eligibility: the deterministic answer to whether health capital can pay for an expense.
 * No AI provider is reachable from this module, by design.
 */
export { ENGINE_VERSION } from './version.js';
export {
  evaluate,
  Outcome,
  Condition,
  RuleRef,
  ReasonCode,
  type EligibilityResult,
  type Reason,
} from './rules.js';
export {
  MissingReason,
  present,
  missing,
  type EligibilityInputs,
  type EnrollmentInput,
  type Input,
  type PlanInputs,
  type BalanceInputs,
  type ConfirmedEnrollment,
} from './inputs.js';
export { buildSnapshot, snapshotToInputs, type DecisionSnapshot } from './snapshot.js';
export { templateExplanation } from './explanation.js';
export { EligibilityService, type EvaluateCommand } from './service.js';
export { registerEligibilityRoutes, type EligibilityRouteOptions } from './routes.js';
