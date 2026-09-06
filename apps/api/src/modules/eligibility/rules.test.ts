import { describe, expect, it } from 'vitest';
import type { CoverageRule } from '../benefits/index.js';
import { MissingReason, present, type EligibilityInputs } from './inputs.js';
import { Outcome, ReasonCode, RuleRef, evaluate } from './rules.js';
import { ENGINE_VERSION } from './version.js';

const PLAN_YEAR_START = new Date('2026-01-01');
const PLAN_YEAR_END = new Date('2026-12-31');
const SERVICE_DATE = new Date('2026-04-10');

const dentalRule: CoverageRule = {
  category: 'DENTAL',
  covered: true,
  annualLimitCents: 80_000,
  substantiation: 'RECEIPT_REQUIRED',
  ruleRef: 'PLAN-DEN-05',
};

const physioRule: CoverageRule = {
  category: 'PHYSICAL_THERAPY',
  covered: true,
  annualLimitCents: 120_000,
  substantiation: 'NONE',
  ruleRef: 'PLAN-PT-04',
};

const cosmeticRule: CoverageRule = {
  category: 'COSMETIC',
  covered: false,
  annualLimitCents: null,
  substantiation: 'NONE',
  ruleRef: 'PLAN-COS-09',
};

const unlimitedRule: CoverageRule = {
  category: 'MENTAL_HEALTH',
  covered: true,
  annualLimitCents: null,
  substantiation: 'NONE',
  ruleRef: 'PLAN-MH-07',
};

/** A healthy set of inputs; each test changes only what it is about. */
function inputs(overrides: Partial<EligibilityInputs> = {}): EligibilityInputs {
  return {
    request: {
      treatmentCategory: 'PHYSICAL_THERAPY',
      expenseAmountCents: 18_000,
      serviceDate: SERVICE_DATE,
      ...overrides.request,
    },
    enrollment: overrides.enrollment ?? {
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
    plan:
      overrides.plan ??
      present({
        planId: '22222222-2222-4222-8222-000000000001',
        planConfigVersion: 1,
        planConfigAsOf: new Date('2026-01-05T00:00:00.000Z'),
        planYearStart: PLAN_YEAR_START,
        planYearEnd: PLAN_YEAR_END,
        coverageRules: [dentalRule, physioRule, cosmeticRule, unlimitedRule],
      }),
    balances:
      overrides.balances ??
      present({
        ledgerBalanceCents: 217_000,
        cardAvailableCents: 217_000,
        balanceAsOf: new Date('2026-04-10T00:00:00.000Z'),
        balanceSource: 'CardSystemAdapter',
      }),
    ytdCategorySpendCents: overrides.ytdCategorySpendCents ?? present(0),
    balanceToleranceCents: overrides.balanceToleranceCents ?? 100,
  };
}

describe('a confirmed absence of enrollment is an answer, not a gap', () => {
  it('is ineligible, citing the enrollment rule', () => {
    const result = evaluate(inputs({ enrollment: { state: 'CONFIRMED_ABSENT' } }));
    expect(result.outcome).toBe(Outcome.INELIGIBLE);
    expect(result.coveredAmountCents).toBe(0);
    expect(result.reasons[0]).toMatchObject({
      ruleRef: RuleRef.ENROLLMENT,
      code: ReasonCode.NO_ENROLLMENT,
    });
    expect(result.missingInputs).toEqual([]);
  });

  it('decides even though the plan and balances were never reached', () => {
    // The absence settles it, so the facts that depend on an enrollment are simply not needed.
    const result = evaluate(
      inputs({
        enrollment: { state: 'CONFIRMED_ABSENT' },
        plan: { present: false, reason: MissingReason.NOT_CONFIGURED },
        balances: { present: false, reason: MissingReason.NOT_CONFIGURED },
        ytdCategorySpendCents: { present: false, reason: MissingReason.NOT_CONFIGURED },
      }),
    );
    expect(result.outcome).toBe(Outcome.INELIGIBLE);
  });
});

describe('an unanswered question is never a guess', () => {
  it.each([
    MissingReason.SOURCE_UNAVAILABLE,
    MissingReason.SOURCE_TIMEOUT,
    MissingReason.SOURCE_STALE,
    MissingReason.MULTIPLE_APPLICABLE,
  ])('is undetermined when the enrollment source says %s', (reason) => {
    const result = evaluate(inputs({ enrollment: { state: 'UNKNOWN', reason } }));
    expect(result.outcome).toBe(Outcome.UNDETERMINED);
    expect(result.coveredAmountCents).toBeNull();
    expect(result.missingInputs).toContainEqual({ input: 'enrollment', reason });
  });

  it('is undetermined when the plan configuration cannot be read', () => {
    const result = evaluate(
      inputs({ plan: { present: false, reason: MissingReason.NOT_CONFIGURED } }),
    );
    expect(result.outcome).toBe(Outcome.UNDETERMINED);
    expect(result.planConfigVersion).toBeNull();
  });

  it('is undetermined when the balance cannot be read', () => {
    const result = evaluate(
      inputs({ balances: { present: false, reason: MissingReason.SOURCE_UNAVAILABLE } }),
    );
    expect(result.outcome).toBe(Outcome.UNDETERMINED);
    expect(result.reasons[0]).toMatchObject({
      ruleRef: RuleRef.DATA,
      code: ReasonCode.DATA_UNAVAILABLE,
    });
  });

  it('reports every gap at once rather than the first one found', () => {
    const result = evaluate(
      inputs({
        plan: { present: false, reason: MissingReason.NOT_CONFIGURED },
        balances: { present: false, reason: MissingReason.SOURCE_TIMEOUT },
        ytdCategorySpendCents: { present: false, reason: MissingReason.NOT_CONFIGURED },
      }),
    );
    expect(result.missingInputs.map((m) => m.input).sort()).toEqual([
      'balances',
      'plan',
      'ytdCategorySpend',
    ]);
  });

  it('is undetermined when the card system and the ledger disagree beyond tolerance', () => {
    const result = evaluate(
      inputs({
        balances: present({
          ledgerBalanceCents: 217_000,
          cardAvailableCents: 216_000,
          balanceAsOf: new Date(),
          balanceSource: 'CardSystemAdapter',
        }),
      }),
    );
    expect(result.outcome).toBe(Outcome.UNDETERMINED);
    expect(result.reasons[0]).toMatchObject({ code: ReasonCode.BALANCE_CONFLICT });
  });

  it('tolerates a small disagreement', () => {
    const result = evaluate(
      inputs({
        balances: present({
          ledgerBalanceCents: 217_000,
          cardAvailableCents: 216_950,
          balanceAsOf: new Date(),
          balanceSource: 'CardSystemAdapter',
        }),
      }),
    );
    expect(result.outcome).toBe(Outcome.ELIGIBLE);
  });
});

describe('enrollment status and period', () => {
  it.each(['PENDING', 'TERMINATED'] as const)(
    'is ineligible when the enrollment is %s',
    (status) => {
      const base = inputs();
      if (base.enrollment.state !== 'FOUND') throw new Error('fixture');
      const result = evaluate({
        ...base,
        enrollment: { state: 'FOUND', value: { ...base.enrollment.value, status } },
      });
      expect(result.outcome).toBe(Outcome.INELIGIBLE);
      expect(result.reasons[0]?.code).toBe(ReasonCode.ENROLLMENT_NOT_ACTIVE);
    },
  );

  it('is ineligible for care after the enrollment ended', () => {
    const base = inputs();
    if (base.enrollment.state !== 'FOUND') throw new Error('fixture');
    const result = evaluate({
      ...base,
      enrollment: {
        state: 'FOUND',
        value: { ...base.enrollment.value, effectiveTo: new Date('2026-03-31') },
      },
    });
    expect(result.reasons[0]?.code).toBe(ReasonCode.OUTSIDE_ENROLLMENT_PERIOD);
  });

  it('accepts care on the closing day of the enrollment', () => {
    const base = inputs();
    if (base.enrollment.state !== 'FOUND') throw new Error('fixture');
    const result = evaluate({
      ...base,
      enrollment: {
        state: 'FOUND',
        value: { ...base.enrollment.value, effectiveTo: SERVICE_DATE },
      },
    });
    expect(result.outcome).toBe(Outcome.ELIGIBLE);
  });
});

describe('plan year', () => {
  it('is ineligible for care outside the plan year', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'PHYSICAL_THERAPY',
          expenseAmountCents: 18_000,
          serviceDate: new Date('2025-12-31'),
        },
      }),
    );
    expect(result.outcome).toBe(Outcome.INELIGIBLE);
    expect(result.reasons[0]?.code).toBe(ReasonCode.OUTSIDE_PLAN_YEAR);
  });

  it('accepts care on the first and last day', () => {
    for (const serviceDate of [PLAN_YEAR_START, PLAN_YEAR_END]) {
      const base = inputs();
      if (base.enrollment.state !== 'FOUND') throw new Error('fixture');
      const result = evaluate({
        ...base,
        request: { ...base.request, serviceDate },
        enrollment: {
          state: 'FOUND',
          value: { ...base.enrollment.value, effectiveFrom: new Date('2024-01-01') },
        },
      });
      expect(result.outcome, serviceDate.toISOString()).toBe(Outcome.ELIGIBLE);
    }
  });
});

describe('category coverage', () => {
  it('is ineligible for a category the plan excludes, quoting the plan clause', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'COSMETIC',
          expenseAmountCents: 50_000,
          serviceDate: SERVICE_DATE,
        },
      }),
    );
    expect(result.outcome).toBe(Outcome.INELIGIBLE);
    expect(result.reasons[0]).toMatchObject({
      ruleRef: RuleRef.CATEGORY,
      code: ReasonCode.CATEGORY_NOT_COVERED,
    });
    expect(result.reasons[0]?.message).toContain('PLAN-COS-09');
  });

  it('is ineligible for a category the plan says nothing about', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'GYM_MEMBERSHIP',
          expenseAmountCents: 5_000,
          serviceDate: SERVICE_DATE,
        },
      }),
    );
    expect(result.reasons[0]?.code).toBe(ReasonCode.CATEGORY_NOT_IN_PLAN);
  });
});

describe('limits, funds and what is actually payable', () => {
  it('is eligible in full when the amount fits within both the limit and the balance', () => {
    const result = evaluate(inputs());
    expect(result.outcome).toBe(Outcome.ELIGIBLE);
    expect(result.coveredAmountCents).toBe(18_000);
    expect(result.reasons[0]?.code).toBe(ReasonCode.FULLY_COVERED);
  });

  it('covers part of the amount when the annual limit leaves less', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'DENTAL',
          expenseAmountCents: 30_000,
          serviceDate: SERVICE_DATE,
        },
        ytdCategorySpendCents: present(65_000),
      }),
    );
    expect(result.outcome).toBe(Outcome.PARTIALLY_ELIGIBLE);
    expect(result.coveredAmountCents).toBe(15_000);
    expect(result.reasons[0]).toMatchObject({
      ruleRef: RuleRef.LIMIT,
      code: ReasonCode.PARTIALLY_COVERED,
    });
  });

  it('covers part of the amount when the balance runs out first', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'PHYSICAL_THERAPY',
          expenseAmountCents: 50_000,
          serviceDate: SERVICE_DATE,
        },
        balances: present({
          ledgerBalanceCents: 20_000,
          cardAvailableCents: 20_000,
          balanceAsOf: new Date(),
          balanceSource: 'CardSystemAdapter',
        }),
      }),
    );
    expect(result.outcome).toBe(Outcome.PARTIALLY_ELIGIBLE);
    expect(result.coveredAmountCents).toBe(20_000);
    expect(result.reasons[0]?.ruleRef).toBe(RuleRef.FUNDS);
  });

  it('is ineligible when the annual limit is entirely used', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'DENTAL',
          expenseAmountCents: 10_000,
          serviceDate: SERVICE_DATE,
        },
        ytdCategorySpendCents: present(80_000),
      }),
    );
    expect(result.outcome).toBe(Outcome.INELIGIBLE);
    expect(result.coveredAmountCents).toBe(0);
    expect(result.reasons[0]?.code).toBe(ReasonCode.LIMIT_EXHAUSTED);
  });

  it('is ineligible when there is no money available', () => {
    const result = evaluate(
      inputs({
        balances: present({
          ledgerBalanceCents: 0,
          cardAvailableCents: 0,
          balanceAsOf: new Date(),
          balanceSource: 'CardSystemAdapter',
        }),
      }),
    );
    expect(result.outcome).toBe(Outcome.INELIGIBLE);
    expect(result.reasons[0]?.code).toBe(ReasonCode.INSUFFICIENT_FUNDS);
  });

  it('treats a negative balance as nothing available, not as a debt to spend', () => {
    const result = evaluate(
      inputs({
        balances: present({
          ledgerBalanceCents: -5_000,
          cardAvailableCents: -5_000,
          balanceAsOf: new Date(),
          balanceSource: 'CardSystemAdapter',
        }),
      }),
    );
    expect(result.outcome).toBe(Outcome.INELIGIBLE);
    expect(result.coveredAmountCents).toBe(0);
  });

  it('applies no ceiling for a category with no annual limit', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'MENTAL_HEALTH',
          expenseAmountCents: 200_000,
          serviceDate: SERVICE_DATE,
        },
        ytdCategorySpendCents: present(500_000),
        balances: present({
          ledgerBalanceCents: 300_000,
          cardAvailableCents: 300_000,
          balanceAsOf: new Date(),
          balanceSource: 'CardSystemAdapter',
        }),
      }),
    );
    expect(result.outcome).toBe(Outcome.ELIGIBLE);
    expect(result.coveredAmountCents).toBe(200_000);
  });

  it('covers exactly the amount when it equals the remaining limit', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'DENTAL',
          expenseAmountCents: 15_000,
          serviceDate: SERVICE_DATE,
        },
        ytdCategorySpendCents: present(65_000),
      }),
    );
    expect(result.outcome).toBe(Outcome.ELIGIBLE);
    expect(result.coveredAmountCents).toBe(15_000);
  });
});

describe('a receipt requirement is a condition, not a different answer', () => {
  it('stays eligible and attaches the condition', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'DENTAL',
          expenseAmountCents: 20_000,
          serviceDate: SERVICE_DATE,
        },
      }),
    );
    expect(result.outcome).toBe(Outcome.ELIGIBLE);
    expect(result.conditions).toEqual(['RECEIPT_REQUIRED']);
    expect(result.reasons.map((r) => r.code)).toContain(ReasonCode.RECEIPT_REQUIRED);
  });

  it('attaches to a partial decision too', () => {
    const result = evaluate(
      inputs({
        request: {
          treatmentCategory: 'DENTAL',
          expenseAmountCents: 30_000,
          serviceDate: SERVICE_DATE,
        },
        ytdCategorySpendCents: present(65_000),
      }),
    );
    expect(result.outcome).toBe(Outcome.PARTIALLY_ELIGIBLE);
    expect(result.conditions).toEqual(['RECEIPT_REQUIRED']);
  });

  it('is absent for a category that does not need one', () => {
    expect(evaluate(inputs()).conditions).toEqual([]);
  });
});

describe('every decision is attributable', () => {
  it('records the engine version and the plan configuration version', () => {
    const result = evaluate(inputs());
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.planConfigVersion).toBe(1);
  });

  it('is a pure function: the same inputs give the same decision', () => {
    const fixed = inputs();
    expect(evaluate(fixed)).toEqual(evaluate(fixed));
  });

  it('never mentions a person in a reason message', () => {
    for (const category of ['DENTAL', 'COSMETIC', 'PHYSICAL_THERAPY'] as const) {
      const result = evaluate(
        inputs({
          request: {
            treatmentCategory: category,
            expenseAmountCents: 20_000,
            serviceDate: SERVICE_DATE,
          },
        }),
      );
      for (const r of result.reasons) {
        expect(r.message).not.toMatch(/sarah|thompson|@|MBR-|NS-\d/i);
      }
    }
  });
});
