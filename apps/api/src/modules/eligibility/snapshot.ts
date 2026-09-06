import type { EligibilityInputs } from './inputs.js';
import type { EligibilityResult } from './rules.js';

/**
 * The minimized record of what a decision was made from, stored alongside the decision so it can be
 * replayed and explained later even after balances, plans and enrollments have moved on.
 *
 * It carries no name, date of birth, address, employee identifier or email. It is still health and
 * financial data: a treatment category, an amount and a date about one person. It is classified and
 * protected as such, and is not "safe" merely because it is small.
 */
export interface DecisionSnapshot {
  treatmentCategory: string;
  expenseAmountCents: number;
  serviceDate: string;

  enrollmentId: string | null;
  enrollmentStatus: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  enrollmentSourceAsOf: string | null;
  enrollmentSource: string | null;

  planId: string | null;
  planConfigVersion: number | null;
  planConfigAsOf: string | null;
  planYearStart: string | null;
  planYearEnd: string | null;
  coverageRuleApplied: {
    ruleRef: string;
    covered: boolean;
    annualLimitCents: number | null;
    substantiation: string;
  } | null;

  ytdCategorySpendCents: number | null;
  ledgerBalanceCents: number | null;
  cardAvailableCents: number | null;
  balanceAsOf: string | null;
  balanceSource: string | null;
  balanceToleranceCents: number;

  missingInputs: { input: string; reason: string }[];
}

const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;
const isoDate = (date: Date | null | undefined): string | null =>
  date?.toISOString().slice(0, 10) ?? null;

export function buildSnapshot(
  inputs: EligibilityInputs,
  result: EligibilityResult,
): DecisionSnapshot {
  const enrollment = inputs.enrollment.state === 'FOUND' ? inputs.enrollment.value : null;
  const plan = inputs.plan.present ? inputs.plan.value : null;
  const balances = inputs.balances.present ? inputs.balances.value : null;

  const applied =
    plan?.coverageRules.find((rule) => rule.category === inputs.request.treatmentCategory) ?? null;

  return {
    treatmentCategory: inputs.request.treatmentCategory,
    expenseAmountCents: inputs.request.expenseAmountCents,
    serviceDate: inputs.request.serviceDate.toISOString().slice(0, 10),

    enrollmentId: enrollment?.enrollmentId ?? null,
    enrollmentStatus:
      enrollment?.status ?? (inputs.enrollment.state === 'CONFIRMED_ABSENT' ? 'ABSENT' : null),
    effectiveFrom: isoDate(enrollment?.effectiveFrom),
    effectiveTo: isoDate(enrollment?.effectiveTo),
    enrollmentSourceAsOf: iso(enrollment?.sourceAsOf),
    enrollmentSource: enrollment?.source ?? null,

    planId: plan?.planId ?? null,
    planConfigVersion: plan?.planConfigVersion ?? null,
    planConfigAsOf: iso(plan?.planConfigAsOf),
    planYearStart: isoDate(plan?.planYearStart),
    planYearEnd: isoDate(plan?.planYearEnd),
    coverageRuleApplied:
      applied === null
        ? null
        : {
            ruleRef: applied.ruleRef,
            covered: applied.covered,
            annualLimitCents: applied.annualLimitCents,
            substantiation: applied.substantiation,
          },

    ytdCategorySpendCents: inputs.ytdCategorySpendCents.present
      ? inputs.ytdCategorySpendCents.value
      : null,
    ledgerBalanceCents: balances?.ledgerBalanceCents ?? null,
    cardAvailableCents: balances?.cardAvailableCents ?? null,
    balanceAsOf: iso(balances?.balanceAsOf),
    balanceSource: balances?.balanceSource ?? null,
    balanceToleranceCents: inputs.balanceToleranceCents,

    missingInputs: result.missingInputs.map((entry) => ({
      input: entry.input,
      reason: entry.reason,
    })),
  };
}

/**
 * Rebuilds evaluable inputs from a stored snapshot, so a decision can be replayed and shown to
 * produce the same outcome. Returns null when the snapshot is too incomplete to replay, which is
 * the case for an undetermined decision that never had the facts in the first place.
 */
export function snapshotToInputs(snapshot: DecisionSnapshot): EligibilityInputs | null {
  if (
    snapshot.enrollmentId === null ||
    snapshot.planId === null ||
    snapshot.coverageRuleApplied === null ||
    snapshot.ledgerBalanceCents === null ||
    snapshot.cardAvailableCents === null ||
    snapshot.ytdCategorySpendCents === null ||
    snapshot.planYearStart === null ||
    snapshot.planYearEnd === null
  ) {
    return null;
  }

  return {
    request: {
      treatmentCategory:
        snapshot.treatmentCategory as EligibilityInputs['request']['treatmentCategory'],
      expenseAmountCents: snapshot.expenseAmountCents,
      serviceDate: new Date(snapshot.serviceDate),
    },
    enrollment: {
      state: 'FOUND',
      value: {
        enrollmentId: snapshot.enrollmentId,
        planId: snapshot.planId,
        status: (snapshot.enrollmentStatus ?? 'ACTIVE') as 'PENDING' | 'ACTIVE' | 'TERMINATED',
        effectiveFrom: new Date(snapshot.effectiveFrom ?? snapshot.planYearStart),
        effectiveTo: snapshot.effectiveTo === null ? null : new Date(snapshot.effectiveTo),
        sourceAsOf: new Date(snapshot.enrollmentSourceAsOf ?? snapshot.serviceDate),
        source: snapshot.enrollmentSource ?? 'unknown',
      },
    },
    plan: {
      present: true,
      value: {
        planId: snapshot.planId,
        planConfigVersion: snapshot.planConfigVersion ?? 0,
        planConfigAsOf: new Date(snapshot.planConfigAsOf ?? snapshot.serviceDate),
        planYearStart: new Date(snapshot.planYearStart),
        planYearEnd: new Date(snapshot.planYearEnd),
        coverageRules: [
          {
            category: snapshot.treatmentCategory as 'DENTAL',
            covered: snapshot.coverageRuleApplied.covered,
            annualLimitCents: snapshot.coverageRuleApplied.annualLimitCents,
            substantiation: snapshot.coverageRuleApplied.substantiation as
              'NONE' | 'RECEIPT_REQUIRED',
            ruleRef: snapshot.coverageRuleApplied.ruleRef,
          },
        ],
      },
    },
    balances: {
      present: true,
      value: {
        ledgerBalanceCents: snapshot.ledgerBalanceCents,
        cardAvailableCents: snapshot.cardAvailableCents,
        balanceAsOf: new Date(snapshot.balanceAsOf ?? snapshot.serviceDate),
        balanceSource: snapshot.balanceSource ?? 'unknown',
      },
    },
    ytdCategorySpendCents: { present: true, value: snapshot.ytdCategorySpendCents },
    balanceToleranceCents: snapshot.balanceToleranceCents,
  };
}
