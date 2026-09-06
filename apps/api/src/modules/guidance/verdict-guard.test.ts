import { describe, expect, it } from 'vitest';
import type { AiSafeExplanationContext } from '../ai/index.js';
import { GuardFailure, checkExplanation, parseModelExplanation } from './verdict-guard.js';

const context = {
  treatmentCategory: 'DENTAL',
  expenseAmountCents: 30_000,
  serviceDate: '2026-05-04',
  outcome: 'PARTIALLY_ELIGIBLE',
  coveredAmountCents: 15_000,
  availableBalanceCents: 217_000,
  remainingCategoryLimitCents: 15_000,
  conditions: ['RECEIPT_REQUIRED'],
  reasons: [{ ruleRef: 'ELIG-LIMIT-04', code: 'PARTIALLY_COVERED' }],
  engineVersion: '1.0.0',
} as unknown as AiSafeExplanationContext;

const accept = (verdict: string, explanation: string) =>
  checkExplanation({ verdict, explanation }, 'PARTIALLY_ELIGIBLE', context);

describe('the model must agree with the decision', () => {
  it('accepts an explanation that echoes the outcome and uses given numbers', () => {
    expect(accept('PARTIALLY_ELIGIBLE', 'Your plan covers 150.00 of this dental expense.')).toEqual(
      {
        ok: true,
      },
    );
  });

  it('rejects a different verdict, however reasonable the wording sounds', () => {
    // This is the case that matters: a model claiming an outcome the rules did not reach.
    expect(accept('ELIGIBLE', 'Good news, this is fully covered.')).toEqual({
      ok: false,
      failure: GuardFailure.VERDICT_MISMATCH,
    });
  });

  it('rejects wording that contradicts the outcome even when the verdict matches', () => {
    expect(accept('PARTIALLY_ELIGIBLE', 'This is fully covered by your plan.')).toEqual({
      ok: false,
      failure: GuardFailure.CONTRADICTORY_WORDING,
    });
  });

  it('rejects a figure nobody supplied', () => {
    // Whether invented or calculated, it is not the platform's number.
    expect(accept('PARTIALLY_ELIGIBLE', 'You can claim 250.00 of this.')).toEqual({
      ok: false,
      failure: GuardFailure.UNKNOWN_NUMBER,
    });
  });

  it('allows a number written in either cents or major units', () => {
    expect(accept('PARTIALLY_ELIGIBLE', 'Covered: 15000 cents.').ok).toBe(true);
    expect(accept('PARTIALLY_ELIGIBLE', 'Covered: 150.00.').ok).toBe(true);
    expect(accept('PARTIALLY_ELIGIBLE', 'Covered: 150.').ok).toBe(true);
  });

  it('allows a thousands separator', () => {
    expect(accept('PARTIALLY_ELIGIBLE', 'Your balance is 2,170.00 in total.').ok).toBe(true);
  });

  it('allows the service date and rule references to be quoted back', () => {
    expect(
      accept('PARTIALLY_ELIGIBLE', 'For care on 2026-05-04, rule ELIG-LIMIT-04 applies.').ok,
    ).toBe(true);
  });

  it('rejects an empty explanation', () => {
    expect(accept('PARTIALLY_ELIGIBLE', '   ')).toEqual({
      ok: false,
      failure: GuardFailure.EMPTY_EXPLANATION,
    });
  });

  it('rejects a response that is not the agreed shape', () => {
    for (const candidate of [
      null,
      'a string',
      42,
      {},
      { verdict: 'ELIGIBLE' },
      { explanation: 'hi' },
    ]) {
      expect(
        checkExplanation(candidate, 'PARTIALLY_ELIGIBLE', context).ok,
        JSON.stringify(candidate),
      ).toBe(false);
    }
  });
});

describe('contradiction checks per outcome', () => {
  const withOutcome = (outcome: string) =>
    ({ ...context, outcome, coveredAmountCents: 30_000 }) as unknown as AiSafeExplanationContext;

  it('will not let an ineligible decision be described as a yes', () => {
    const result = checkExplanation(
      { verdict: 'INELIGIBLE', explanation: 'You can use your health capital for this.' },
      'INELIGIBLE',
      withOutcome('INELIGIBLE'),
    );
    expect(result).toEqual({ ok: false, failure: GuardFailure.CONTRADICTORY_WORDING });
  });

  it('will not let an undetermined decision be described either way', () => {
    for (const wording of ['This is eligible.', 'This is not eligible.']) {
      const result = checkExplanation(
        { verdict: 'UNDETERMINED', explanation: wording },
        'UNDETERMINED',
        withOutcome('UNDETERMINED'),
      );
      expect(result.ok, wording).toBe(false);
    }
  });

  it('accepts a plainly worded undetermined explanation', () => {
    const result = checkExplanation(
      {
        verdict: 'UNDETERMINED',
        explanation: 'We could not check this right now. Please try again shortly.',
      },
      'UNDETERMINED',
      withOutcome('UNDETERMINED'),
    );
    expect(result.ok).toBe(true);
  });
});

describe('parsing what the model returned', () => {
  it('accepts the agreed shape and rejects everything else', () => {
    expect(parseModelExplanation({ verdict: 'ELIGIBLE', explanation: 'ok' })).toEqual({
      verdict: 'ELIGIBLE',
      explanation: 'ok',
    });
    expect(parseModelExplanation({ verdict: 1, explanation: 'ok' })).toBeNull();
    expect(parseModelExplanation(undefined)).toBeNull();
  });
});
