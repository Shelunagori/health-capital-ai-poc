import { describe, expect, it } from 'vitest';
import {
  computeLedgerBalance,
  computeYtdCategorySpend,
  withinPlanYear,
  type LedgerLine,
} from './balance.js';

const planYear = { start: new Date('2026-01-01'), end: new Date('2026-12-31') };

const line = (
  type: LedgerLine['type'],
  amountCents: number,
  occurredAt: string,
  benefitCategory: LedgerLine['benefitCategory'] = null,
): LedgerLine => ({ type, amountCents, occurredAt: new Date(occurredAt), benefitCategory });

describe('ledger balance', () => {
  it('adds contributions, subtracts debits and adds adjustments back', () => {
    const entries = [
      line('CONTRIBUTION', 150_000, '2026-01-15'),
      line('DEBIT', 40_000, '2026-02-03', 'DENTAL'),
      line('ADJUSTMENT', 5_000, '2026-03-25', 'DENTAL'),
    ];
    expect(computeLedgerBalance(entries)).toBe(115_000);
  });

  it('is zero for an account with no entries', () => {
    expect(computeLedgerBalance([])).toBe(0);
  });

  it('can go negative if spend exceeds contributions', () => {
    // The arithmetic does not clamp; whether that is allowed is a rule, not a sum.
    expect(computeLedgerBalance([line('DEBIT', 1_000, '2026-02-01', 'DENTAL')])).toBe(-1_000);
  });

  it('works in whole cents with no rounding', () => {
    const entries = Array.from({ length: 3 }, () => line('DEBIT', 3_333, '2026-02-01', 'VISION'));
    expect(computeLedgerBalance(entries)).toBe(-9_999);
  });
});

describe('year-to-date category spend', () => {
  const entries = [
    line('CONTRIBUTION', 150_000, '2026-01-15'),
    line('DEBIT', 40_000, '2026-02-03', 'DENTAL'),
    line('DEBIT', 30_000, '2026-03-19', 'DENTAL'),
    line('ADJUSTMENT', 5_000, '2026-03-25', 'DENTAL'),
    line('DEBIT', 18_000, '2026-04-02', 'PHYSICAL_THERAPY'),
    line('DEBIT', 31_000, '2025-05-14', 'DENTAL'),
  ];

  it('counts debits and nets off adjustments in the same category', () => {
    expect(computeYtdCategorySpend(entries, 'DENTAL', planYear)).toBe(65_000);
  });

  it('ignores other categories', () => {
    expect(computeYtdCategorySpend(entries, 'PHYSICAL_THERAPY', planYear)).toBe(18_000);
    expect(computeYtdCategorySpend(entries, 'VISION', planYear)).toBe(0);
  });

  it('ignores spend from a previous plan year', () => {
    // The 2025 dental debit is excluded, which is why the total is 65,000 rather than 96,000.
    const previousYear = { start: new Date('2025-01-01'), end: new Date('2025-12-31') };
    expect(computeYtdCategorySpend(entries, 'DENTAL', previousYear)).toBe(31_000);
  });

  it('never counts contributions towards category spend', () => {
    const withCategorisedContribution = [
      ...entries,
      line('CONTRIBUTION', 20_000, '2026-06-01', 'DENTAL'),
    ];
    expect(computeYtdCategorySpend(withCategorisedContribution, 'DENTAL', planYear)).toBe(65_000);
  });

  it('ignores entries with no category', () => {
    expect(computeYtdCategorySpend([line('DEBIT', 9_000, '2026-02-01')], 'DENTAL', planYear)).toBe(
      0,
    );
  });
});

describe('plan year boundaries', () => {
  it('includes both the first and last day', () => {
    expect(withinPlanYear(new Date('2026-01-01T00:00:00.000Z'), planYear)).toBe(true);
    expect(withinPlanYear(new Date('2026-12-31T23:59:59.000Z'), planYear)).toBe(true);
  });

  it('excludes the day before and the day after', () => {
    expect(withinPlanYear(new Date('2025-12-31T23:59:59.000Z'), planYear)).toBe(false);
    expect(withinPlanYear(new Date('2027-01-01T00:00:00.000Z'), planYear)).toBe(false);
  });
});
