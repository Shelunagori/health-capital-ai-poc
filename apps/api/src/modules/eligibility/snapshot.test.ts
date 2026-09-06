import { describe, expect, it } from 'vitest';
import { present, type EligibilityInputs } from './inputs.js';
import { evaluate } from './rules.js';
import { buildSnapshot, snapshotToInputs } from './snapshot.js';

const inputs: EligibilityInputs = {
  request: {
    treatmentCategory: 'DENTAL',
    expenseAmountCents: 30_000,
    serviceDate: new Date('2026-04-10'),
  },
  enrollment: {
    state: 'FOUND',
    value: {
      enrollmentId: '44444444-4444-4444-8444-000000000001',
      planId: '22222222-2222-4222-8222-000000000001',
      status: 'ACTIVE',
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      sourceAsOf: new Date('2026-04-01T00:00:00.000Z'),
      source: 'EmployerSystemAdapter',
    },
  },
  plan: present({
    planId: '22222222-2222-4222-8222-000000000001',
    planConfigVersion: 1,
    planConfigAsOf: new Date('2026-01-05T00:00:00.000Z'),
    planYearStart: new Date('2026-01-01'),
    planYearEnd: new Date('2026-12-31'),
    coverageRules: [
      {
        category: 'DENTAL',
        covered: true,
        annualLimitCents: 80_000,
        substantiation: 'RECEIPT_REQUIRED',
        ruleRef: 'PLAN-DEN-05',
      },
    ],
  }),
  balances: present({
    ledgerBalanceCents: 217_000,
    cardAvailableCents: 217_000,
    balanceAsOf: new Date('2026-04-10T00:00:00.000Z'),
    balanceSource: 'CardSystemAdapter',
  }),
  ytdCategorySpendCents: present(65_000),
  balanceToleranceCents: 100,
};

describe('the decision snapshot', () => {
  const result = evaluate(inputs);
  const snapshot = buildSnapshot(inputs, result);

  it('carries no name, date of birth, address, employee identifier or email', () => {
    const serialised = JSON.stringify(snapshot);
    for (const forbidden of [
      'Sarah',
      'Thompson',
      '@',
      'Alder Street',
      'NS-1001',
      '1987-03-14',
      'MBR-',
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it('records which plan clause was applied and the versions behind the decision', () => {
    expect(snapshot.coverageRuleApplied).toEqual({
      ruleRef: 'PLAN-DEN-05',
      covered: true,
      annualLimitCents: 80_000,
      substantiation: 'RECEIPT_REQUIRED',
    });
    expect(snapshot.planConfigVersion).toBe(1);
    expect(snapshot.balanceToleranceCents).toBe(100);
  });

  it('records where each external fact came from and how current it was', () => {
    expect(snapshot.enrollmentSource).toBe('EmployerSystemAdapter');
    expect(snapshot.balanceSource).toBe('CardSystemAdapter');
    expect(snapshot.enrollmentSourceAsOf).toBe('2026-04-01T00:00:00.000Z');
  });

  it('replays to the same decision', () => {
    // This is what makes a stored decision explainable later: the inputs are sufficient, not just
    // descriptive.
    const replayed = snapshotToInputs(snapshot);
    expect(replayed).not.toBeNull();
    if (replayed === null) return;

    const again = evaluate(replayed);
    expect(again.outcome).toBe(result.outcome);
    expect(again.coveredAmountCents).toBe(result.coveredAmountCents);
    expect(again.conditions).toEqual(result.conditions);
    expect(again.reasons.map((r) => r.ruleRef)).toEqual(result.reasons.map((r) => r.ruleRef));
  });

  it('says which facts were missing when a decision could not be made', () => {
    const undetermined: EligibilityInputs = {
      ...inputs,
      balances: { present: false, reason: 'SOURCE_UNAVAILABLE' },
    };
    const outcome = evaluate(undetermined);
    const gapSnapshot = buildSnapshot(undetermined, outcome);

    expect(gapSnapshot.missingInputs).toEqual([
      { input: 'balances', reason: 'SOURCE_UNAVAILABLE' },
    ]);
    expect(gapSnapshot.cardAvailableCents).toBeNull();
    // Too incomplete to replay, which is honest rather than a failure.
    expect(snapshotToInputs(gapSnapshot)).toBeNull();
  });

  it('records a confirmed absence of enrollment as such', () => {
    const absent: EligibilityInputs = { ...inputs, enrollment: { state: 'CONFIRMED_ABSENT' } };
    const snapshotOfAbsence = buildSnapshot(absent, evaluate(absent));
    expect(snapshotOfAbsence.enrollmentStatus).toBe('ABSENT');
    expect(snapshotOfAbsence.enrollmentId).toBeNull();
  });
});
