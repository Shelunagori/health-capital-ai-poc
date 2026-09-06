import { describe, expect, it } from 'vitest';
import type { EligibilityResult } from '../eligibility/index.js';
import {
  toAiSafeCategoriesResult,
  toAiSafeDecisionResult,
  toAiSafeExplanationContext,
  toAiSafeToolError,
} from './minimizer.js';
import { AiSafeExplanationContextSchema } from './types.js';

const result: EligibilityResult = {
  outcome: 'PARTIALLY_ELIGIBLE',
  coveredAmountCents: 15_000,
  reasons: [
    {
      ruleRef: 'ELIG-LIMIT-04',
      code: 'PARTIALLY_COVERED',
      message: 'Part of this expense is covered: the annual limit for this category leaves less.',
    },
  ],
  conditions: ['RECEIPT_REQUIRED'],
  engineVersion: '1.0.0',
  planConfigVersion: 1,
  missingInputs: [],
};

const source = {
  result,
  treatmentCategory: 'DENTAL',
  expenseAmountCents: 30_000,
  serviceDate: '2026-05-04',
  availableBalanceCents: 217_000,
  remainingCategoryLimitCents: 15_000,
};

describe('the explanation context is an allowlist', () => {
  const context = toAiSafeExplanationContext(source);

  it('emits exactly the agreed keys', () => {
    expect(Object.keys(context).sort()).toEqual([
      'availableBalanceCents',
      'conditions',
      'coveredAmountCents',
      'engineVersion',
      'expenseAmountCents',
      'outcome',
      'reasons',
      'remainingCategoryLimitCents',
      'serviceDate',
      'treatmentCategory',
    ]);
  });

  it('carries no identifier of any kind', () => {
    // Not a member id, not an enrollment id, not an opaque reference. A model writing one sentence
    // about one decision has no use for knowing whose decision it is.
    for (const key of [
      'memberId',
      'memberRef',
      'enrollmentId',
      'enrollmentExternalRef',
      'careRequestId',
    ]) {
      expect(context).not.toHaveProperty(key);
    }
    expect(JSON.stringify(context)).not.toMatch(/MBR-|ENR-|CARD-|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('sends rule references and codes, not the prose written for a member', () => {
    expect(context.reasons).toEqual([{ ruleRef: 'ELIG-LIMIT-04', code: 'PARTIALLY_COVERED' }]);
    expect(JSON.stringify(context)).not.toContain('Part of this expense');
  });

  it('rejects an unexpected field rather than forwarding it', () => {
    expect(() =>
      AiSafeExplanationContextSchema.parse({ ...context, memberRef: 'MBR-001' }),
    ).toThrow();
  });
});

describe('tool results are minimized too', () => {
  it('reports a decision as outcome, amounts, conditions and rule references', () => {
    const decision = toAiSafeDecisionResult(result, 'DENTAL', 30_000);
    expect(decision).toEqual({
      outcome: 'PARTIALLY_ELIGIBLE',
      coveredAmountCents: 15_000,
      requestedAmountCents: 30_000,
      treatmentCategory: 'DENTAL',
      conditions: ['RECEIPT_REQUIRED'],
      reasons: [{ ruleRef: 'ELIG-LIMIT-04', code: 'PARTIALLY_COVERED' }],
    });
  });

  it('reports covered categories without the plan clause references', () => {
    const categories = toAiSafeCategoriesResult([
      {
        category: 'DENTAL',
        covered: true,
        annualLimitCents: 80_000,
        substantiation: 'RECEIPT_REQUIRED',
      },
      { category: 'COSMETIC', covered: false, annualLimitCents: null, substantiation: 'NONE' },
    ]);
    expect(categories).toEqual({
      categories: [
        { category: 'DENTAL', covered: true, annualLimitCents: 80_000, receiptRequired: true },
        { category: 'COSMETIC', covered: false, annualLimitCents: null, receiptRequired: false },
      ],
    });
  });

  it('reports a tool failure as fixed text, never an exception', () => {
    const error = toAiSafeToolError('x'.repeat(400));
    expect(JSON.stringify(error).length).toBeLessThan(200);
  });
});
