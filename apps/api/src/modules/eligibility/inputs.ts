import type { BenefitCategory } from '../../generated/prisma/enums.js';
import type { CoverageRule } from '../benefits/index.js';

/**
 * The facts a decision is made from, and the vocabulary for not having them.
 *
 * A rule engine that cannot tell "we asked and the answer is no" from "we could not ask" will
 * eventually guess. These types make the difference impossible to lose: an absent enrollment that
 * the employer confirmed is a different constructor from an enrollment we failed to look up.
 */
export const MissingReason = {
  /** The source could not be reached. */
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  /** The source did not answer in time. */
  SOURCE_TIMEOUT: 'SOURCE_TIMEOUT',
  /** The source answered from data too old to rely on. */
  SOURCE_STALE: 'SOURCE_STALE',
  /** Two sources disagree by more than we tolerate. */
  SOURCE_CONFLICT: 'SOURCE_CONFLICT',
  /** More than one enrollment applies to this service date. */
  MULTIPLE_APPLICABLE: 'MULTIPLE_APPLICABLE',
  /** The record exists but its configuration cannot be read. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
} as const;
export type MissingReason = (typeof MissingReason)[keyof typeof MissingReason];

export type Input<T> = { present: true; value: T } | { present: false; reason: MissingReason };

export const present = <T>(value: T): Input<T> => ({ present: true, value });
export const missing = <T>(reason: MissingReason): Input<T> => ({ present: false, reason });

export interface ConfirmedEnrollment {
  enrollmentId: string;
  planId: string;
  status: 'PENDING' | 'ACTIVE' | 'TERMINATED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** When the employer system last confirmed this, and which system said so. */
  sourceAsOf: Date;
  source: string;
}

/**
 * Three states, not two. `CONFIRMED_ABSENT` is an answer: the employer system was asked and there
 * is no enrollment covering this date. `UNKNOWN` is the absence of an answer.
 */
export type EnrollmentInput =
  | { state: 'FOUND'; value: ConfirmedEnrollment }
  | { state: 'CONFIRMED_ABSENT' }
  | { state: 'UNKNOWN'; reason: MissingReason };

export interface PlanInputs {
  planId: string;
  planConfigVersion: number;
  planConfigAsOf: Date;
  planYearStart: Date;
  planYearEnd: Date;
  coverageRules: CoverageRule[];
}

export interface BalanceInputs {
  ledgerBalanceCents: number;
  cardAvailableCents: number;
  balanceAsOf: Date;
  balanceSource: string;
}

export interface EligibilityRequestInputs {
  treatmentCategory: BenefitCategory;
  expenseAmountCents: number;
  serviceDate: Date;
}

export interface EligibilityInputs {
  request: EligibilityRequestInputs;
  enrollment: EnrollmentInput;
  plan: Input<PlanInputs>;
  balances: Input<BalanceInputs>;
  ytdCategorySpendCents: Input<number>;
  /** How far the card system and our ledger may differ before neither is trusted. */
  balanceToleranceCents: number;
}
