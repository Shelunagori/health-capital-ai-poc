/**
 * Benefits: plan configuration as data, health capital accounts, and the ledger arithmetic that
 * turns entries into a balance and into category spend.
 */
export { BenefitsService, type AccountSummary, type PlanSummary } from './service.js';
export {
  computeLedgerBalance,
  computeYtdCategorySpend,
  withinPlanYear,
  type LedgerLine,
  type PlanYear,
} from './balance.js';
export {
  parseCoverageRules,
  findCoverageRule,
  CoverageRuleSchema,
  CoverageRulesSchema,
  SubstantiationSchema,
  type CoverageRule,
  type Substantiation,
} from './coverage.js';
