import { findCoverageRule } from '../benefits/index.js';
import type { EligibilityInputs, MissingReason } from './inputs.js';
import { ENGINE_VERSION } from './version.js';

/**
 * The deterministic rules engine.
 *
 * `evaluate` is a pure function: same inputs, same decision, no database, no clock, no network and
 * no model. Everything uncertain has already been resolved into the inputs, so this file is only
 * ever about what the rules say.
 *
 * The outcomes below are synthetic semantics chosen for this proof of concept. They are not any
 * organisation's real benefit rules.
 */
export const Outcome = {
  /** Covered in full by the plan, within limits, and payable from available funds. */
  ELIGIBLE: 'ELIGIBLE',
  /** Covered, but only part of the amount: a limit or the balance stops short. */
  PARTIALLY_ELIGIBLE: 'PARTIALLY_ELIGIBLE',
  /** A rule says no. The reasons say which. */
  INELIGIBLE: 'INELIGIBLE',
  /** Something needed could not be established. Never a guess. */
  UNDETERMINED: 'UNDETERMINED',
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

/** Conditions attached to a decision that is otherwise a yes. */
export const Condition = {
  RECEIPT_REQUIRED: 'RECEIPT_REQUIRED',
} as const;
export type Condition = (typeof Condition)[keyof typeof Condition];

export const RuleRef = {
  DATA: 'ELIG-DATA-00',
  ENROLLMENT: 'ELIG-ENROLL-01',
  PLAN_YEAR: 'ELIG-PLANYEAR-02',
  CATEGORY: 'ELIG-CAT-03',
  LIMIT: 'ELIG-LIMIT-04',
  FUNDS: 'ELIG-FUNDS-05',
  COVERAGE: 'ELIG-COVER-06',
  SUBSTANTIATION: 'ELIG-DOC-07',
} as const;
export type RuleRef = (typeof RuleRef)[keyof typeof RuleRef];

export const ReasonCode = {
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
  BALANCE_CONFLICT: 'BALANCE_CONFLICT',
  NO_ENROLLMENT: 'NO_ENROLLMENT',
  ENROLLMENT_NOT_ACTIVE: 'ENROLLMENT_NOT_ACTIVE',
  OUTSIDE_ENROLLMENT_PERIOD: 'OUTSIDE_ENROLLMENT_PERIOD',
  OUTSIDE_PLAN_YEAR: 'OUTSIDE_PLAN_YEAR',
  CATEGORY_NOT_COVERED: 'CATEGORY_NOT_COVERED',
  CATEGORY_NOT_IN_PLAN: 'CATEGORY_NOT_IN_PLAN',
  LIMIT_EXHAUSTED: 'LIMIT_EXHAUSTED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PARTIALLY_COVERED: 'PARTIALLY_COVERED',
  FULLY_COVERED: 'FULLY_COVERED',
  RECEIPT_REQUIRED: 'RECEIPT_REQUIRED',
} as const;
export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode];

export interface Reason {
  ruleRef: RuleRef;
  code: ReasonCode;
  /** A short, factual sentence. Never personal data, never free text from a member. */
  message: string;
}

export interface EligibilityResult {
  outcome: Outcome;
  /** Null only when undetermined, where no amount would be meaningful. */
  coveredAmountCents: number | null;
  reasons: Reason[];
  conditions: Condition[];
  engineVersion: string;
  /** Present whenever the plan could be read. */
  planConfigVersion: number | null;
  /** Populated for an undetermined outcome, so the gap is explicit rather than implied. */
  missingInputs: { input: string; reason: MissingReason }[];
}

const reason = (ruleRef: RuleRef, code: ReasonCode, message: string): Reason => ({
  ruleRef,
  code,
  message,
});

/** Inclusive of the last day: care received on the closing date of a period is inside it. */
function withinInclusive(date: Date, from: Date, to: Date | null): boolean {
  if (date.getTime() < from.getTime()) return false;
  if (to === null) return true;
  return date.getTime() <= to.getTime() + 86_400_000 - 1;
}

export function evaluate(inputs: EligibilityInputs): EligibilityResult {
  const { request } = inputs;
  const planConfigVersion = inputs.plan.present ? inputs.plan.value.planConfigVersion : null;

  const undetermined = (
    missingInputs: { input: string; reason: MissingReason }[],
  ): EligibilityResult => ({
    outcome: Outcome.UNDETERMINED,
    coveredAmountCents: null,
    reasons: [
      reason(
        RuleRef.DATA,
        ReasonCode.DATA_UNAVAILABLE,
        'Some information needed to decide could not be established, so no decision was made.',
      ),
    ],
    conditions: [],
    engineVersion: ENGINE_VERSION,
    planConfigVersion,
    missingInputs,
  });

  const ineligible = (reasons: Reason[]): EligibilityResult => ({
    outcome: Outcome.INELIGIBLE,
    coveredAmountCents: 0,
    reasons,
    conditions: [],
    engineVersion: ENGINE_VERSION,
    planConfigVersion,
    missingInputs: [],
  });

  // ELIG-ENROLL-01, first half. A confirmed absence is an answer, so it decides rather than
  // blocking. This is checked before the data rule precisely so it cannot be mistaken for a gap.
  if (inputs.enrollment.state === 'CONFIRMED_ABSENT') {
    return ineligible([
      reason(
        RuleRef.ENROLLMENT,
        ReasonCode.NO_ENROLLMENT,
        'No benefit enrollment covers the date of service.',
      ),
    ]);
  }

  // ELIG-DATA-00. Anything still unknown stops the evaluation. Nothing below this line guesses.
  const missingInputs: { input: string; reason: MissingReason }[] = [];
  if (inputs.enrollment.state === 'UNKNOWN') {
    missingInputs.push({ input: 'enrollment', reason: inputs.enrollment.reason });
  }
  if (!inputs.plan.present) missingInputs.push({ input: 'plan', reason: inputs.plan.reason });
  if (!inputs.balances.present)
    missingInputs.push({ input: 'balances', reason: inputs.balances.reason });
  if (!inputs.ytdCategorySpendCents.present) {
    missingInputs.push({ input: 'ytdCategorySpend', reason: inputs.ytdCategorySpendCents.reason });
  }
  if (missingInputs.length > 0) return undetermined(missingInputs);

  // Narrow the three inputs the rest of the rules read.
  if (inputs.enrollment.state !== 'FOUND' || !inputs.plan.present || !inputs.balances.present) {
    return undetermined(missingInputs);
  }
  const enrollment = inputs.enrollment.value;
  const plan = inputs.plan.value;
  const balances = inputs.balances.value;
  const ytdSpend = inputs.ytdCategorySpendCents.present ? inputs.ytdCategorySpendCents.value : 0;

  // ELIG-DATA-00, continued. Two systems that disagree about the money are worse than one that is
  // silent: we hold two numbers and no way to choose, so no decision is made.
  const balanceGap = Math.abs(balances.cardAvailableCents - balances.ledgerBalanceCents);
  if (balanceGap > inputs.balanceToleranceCents) {
    return {
      ...undetermined([{ input: 'balances', reason: 'SOURCE_CONFLICT' }]),
      reasons: [
        reason(
          RuleRef.DATA,
          ReasonCode.BALANCE_CONFLICT,
          'The card system and our ledger disagree about the available balance, so no decision was made.',
        ),
      ],
    };
  }

  // ELIG-ENROLL-01, second half.
  if (enrollment.status !== 'ACTIVE') {
    return ineligible([
      reason(
        RuleRef.ENROLLMENT,
        ReasonCode.ENROLLMENT_NOT_ACTIVE,
        'The benefit enrollment is not active.',
      ),
    ]);
  }
  if (!withinInclusive(request.serviceDate, enrollment.effectiveFrom, enrollment.effectiveTo)) {
    return ineligible([
      reason(
        RuleRef.ENROLLMENT,
        ReasonCode.OUTSIDE_ENROLLMENT_PERIOD,
        'The date of service falls outside the enrollment period.',
      ),
    ]);
  }

  // ELIG-PLANYEAR-02.
  if (!withinInclusive(request.serviceDate, plan.planYearStart, plan.planYearEnd)) {
    return ineligible([
      reason(
        RuleRef.PLAN_YEAR,
        ReasonCode.OUTSIDE_PLAN_YEAR,
        'The date of service falls outside the plan year.',
      ),
    ]);
  }

  // ELIG-CAT-03.
  const coverage = findCoverageRule(plan.coverageRules, request.treatmentCategory);
  if (coverage === null) {
    return ineligible([
      reason(
        RuleRef.CATEGORY,
        ReasonCode.CATEGORY_NOT_IN_PLAN,
        'The plan says nothing about this category of expense.',
      ),
    ]);
  }
  if (!coverage.covered) {
    return ineligible([
      reason(
        RuleRef.CATEGORY,
        ReasonCode.CATEGORY_NOT_COVERED,
        `The plan does not cover this category of expense (${coverage.ruleRef}).`,
      ),
    ]);
  }

  // ELIG-LIMIT-04 and ELIG-FUNDS-05 supply the two ceilings.
  const remainingLimit =
    coverage.annualLimitCents === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, coverage.annualLimitCents - ytdSpend);
  const availableFunds = Math.max(0, balances.cardAvailableCents);

  // ELIG-COVER-06. What is payable is the smallest of what was asked, what the limit leaves, and
  // what the account holds.
  const covered = Math.min(request.expenseAmountCents, remainingLimit, availableFunds);

  // ELIG-DOC-07. A receipt requirement is a condition on a yes, not a different answer. There is no
  // review workflow in this proof of concept, so an outcome implying one would be misleading.
  const conditions: Condition[] =
    coverage.substantiation === 'RECEIPT_REQUIRED' ? [Condition.RECEIPT_REQUIRED] : [];
  const substantiationReason =
    conditions.length > 0
      ? [
          reason(
            RuleRef.SUBSTANTIATION,
            ReasonCode.RECEIPT_REQUIRED,
            `This category requires a receipt (${coverage.ruleRef}).`,
          ),
        ]
      : [];

  if (covered === 0) {
    const exhausted = remainingLimit === 0;
    return ineligible([
      reason(
        exhausted ? RuleRef.LIMIT : RuleRef.FUNDS,
        exhausted ? ReasonCode.LIMIT_EXHAUSTED : ReasonCode.INSUFFICIENT_FUNDS,
        exhausted
          ? `The annual limit for this category has already been used (${coverage.ruleRef}).`
          : 'There is no available balance for this expense.',
      ),
    ]);
  }

  if (covered < request.expenseAmountCents) {
    const limitedByAllowance = remainingLimit <= availableFunds;
    return {
      outcome: Outcome.PARTIALLY_ELIGIBLE,
      coveredAmountCents: covered,
      reasons: [
        reason(
          limitedByAllowance ? RuleRef.LIMIT : RuleRef.FUNDS,
          ReasonCode.PARTIALLY_COVERED,
          limitedByAllowance
            ? `Part of this expense is covered: the annual limit for this category leaves less than the amount requested (${coverage.ruleRef}).`
            : 'Part of this expense is covered: the available balance is less than the amount requested.',
        ),
        ...substantiationReason,
      ],
      conditions,
      engineVersion: ENGINE_VERSION,
      planConfigVersion,
      missingInputs: [],
    };
  }

  return {
    outcome: Outcome.ELIGIBLE,
    coveredAmountCents: covered,
    reasons: [
      reason(
        RuleRef.COVERAGE,
        ReasonCode.FULLY_COVERED,
        `This expense is covered in full by the plan (${coverage.ruleRef}).`,
      ),
      ...substantiationReason,
    ],
    conditions,
    engineVersion: ENGINE_VERSION,
    planConfigVersion,
    missingInputs: [],
  };
}
