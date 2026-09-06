import type { BenefitCategory, LedgerEntryType } from '../../generated/prisma/enums.js';

/**
 * Money arithmetic over the ledger.
 *
 * Amounts are stored as positive magnitudes and the entry type decides the direction, so every sum
 * here is explicit about which way an entry moves the total. Working in integer cents throughout
 * means no rounding ever happens.
 */
export interface LedgerLine {
  type: LedgerEntryType;
  amountCents: number;
  occurredAt: Date;
  benefitCategory: BenefitCategory | null;
}

/** Contributions add, debits subtract, adjustments add back (a refund or correction). */
export function computeLedgerBalance(entries: readonly LedgerLine[]): number {
  return entries.reduce((total, entry) => {
    switch (entry.type) {
      case 'CONTRIBUTION':
        return total + entry.amountCents;
      case 'DEBIT':
        return total - entry.amountCents;
      case 'ADJUSTMENT':
        return total + entry.amountCents;
    }
  }, 0);
}

export interface PlanYear {
  start: Date;
  end: Date;
}

/** Inclusive of both ends: a service on the last day of the plan year counts towards it. */
export function withinPlanYear(occurredAt: Date, planYear: PlanYear): boolean {
  return (
    occurredAt.getTime() >= planYear.start.getTime() &&
    occurredAt.getTime() <= endOfDay(planYear.end)
  );
}

function endOfDay(date: Date): number {
  return date.getTime() + 86_400_000 - 1;
}

/**
 * What a member has spent in one category during the plan year: debits in that category, less any
 * adjustment in the same category. Entries with no category never count towards a category total.
 */
export function computeYtdCategorySpend(
  entries: readonly LedgerLine[],
  category: BenefitCategory,
  planYear: PlanYear,
): number {
  return entries
    .filter(
      (entry) => entry.benefitCategory === category && withinPlanYear(entry.occurredAt, planYear),
    )
    .reduce((total, entry) => {
      if (entry.type === 'DEBIT') return total + entry.amountCents;
      if (entry.type === 'ADJUSTMENT') return total - entry.amountCents;
      return total;
    }, 0);
}
