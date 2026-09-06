import { describe, expect, it } from 'vitest';
import { templateExplanation } from './explanation.js';
import { Outcome, type EligibilityResult } from './rules.js';
import { ENGINE_VERSION } from './version.js';

const base: EligibilityResult = {
  outcome: Outcome.ELIGIBLE,
  coveredAmountCents: 18_000,
  reasons: [{ ruleRef: 'ELIG-COVER-06', code: 'FULLY_COVERED', message: 'Covered in full.' }],
  conditions: [],
  engineVersion: ENGINE_VERSION,
  planConfigVersion: 1,
  missingInputs: [],
};

describe('the explanation the platform writes on its own', () => {
  it('says yes for an eligible decision', () => {
    expect(templateExplanation(base)).toContain('You can use your health capital');
  });

  it('states the covered amount for a partial decision', () => {
    const text = templateExplanation({
      ...base,
      outcome: Outcome.PARTIALLY_ELIGIBLE,
      coveredAmountCents: 15_000,
    });
    expect(text).toContain('part of this expense');
    expect(text).toContain('150.00');
  });

  it('says no for an ineligible decision', () => {
    expect(
      templateExplanation({ ...base, outcome: Outcome.INELIGIBLE, coveredAmountCents: 0 }),
    ).toContain('You cannot use your health capital');
  });

  it('says it could not check, and does not guess, when undetermined', () => {
    const text = templateExplanation({
      ...base,
      outcome: Outcome.UNDETERMINED,
      coveredAmountCents: null,
    });
    expect(text).toContain('could not check');
    expect(text).not.toMatch(/you can use|you cannot use/i);
  });

  it('mentions the receipt when one is required', () => {
    expect(templateExplanation({ ...base, conditions: ['RECEIPT_REQUIRED'] })).toContain('receipt');
  });

  it('never contradicts the verdict it was written from', () => {
    for (const outcome of Object.values(Outcome)) {
      const text = templateExplanation({
        ...base,
        outcome,
        coveredAmountCents: outcome === Outcome.UNDETERMINED ? null : 1_000,
      });
      if (outcome === Outcome.INELIGIBLE)
        expect(text).not.toMatch(/you can use your health capital/i);
      if (outcome === Outcome.ELIGIBLE) expect(text).not.toMatch(/cannot|could not check/i);
    }
  });
});
