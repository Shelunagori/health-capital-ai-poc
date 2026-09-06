/**
 * Integrations: the boundary to external systems. Adapters return results rather than throwing, so
 * a caller must decide what an unanswered question means. No business rules live here.
 */
export {
  AdapterFailure,
  adapterOk,
  adapterFailed,
  type AdapterResult,
  type Adapters,
  type AvailableBalance,
  type BenefitsAdministratorAdapter,
  type CardSystemAdapter,
  type EmployerSystemAdapter,
  type EnrollmentRecord,
  type PlanConfiguration,
} from './types.js';
export {
  Scenario,
  ScenarioSchema,
  ScenarioController,
  DEFAULT_SCENARIOS,
  type ScenarioSettings,
} from './scenarios.js';
export {
  SyntheticEmployerSystemAdapter,
  SyntheticBenefitsAdministratorAdapter,
  SyntheticCardSystemAdapter,
  BALANCE_TOLERANCE_CENTS,
} from './synthetic.js';
export { auditedAdapters } from './audited.js';
