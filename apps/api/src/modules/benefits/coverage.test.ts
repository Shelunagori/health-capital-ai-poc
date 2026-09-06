import { describe, expect, it } from 'vitest';
import { findCoverageRule, parseCoverageRules } from './coverage.js';

const valid = [
  {
    category: 'DENTAL',
    covered: true,
    annualLimitCents: 80_000,
    substantiation: 'RECEIPT_REQUIRED',
    ruleRef: 'PLAN-DEN-05',
  },
  {
    category: 'COSMETIC',
    covered: false,
    annualLimitCents: null,
    substantiation: 'NONE',
    ruleRef: 'PLAN-COS-09',
  },
];

describe('coverage rules are data with a checked shape', () => {
  it('accepts well-formed rules', () => {
    expect(parseCoverageRules(valid)).toEqual(valid);
  });

  it('returns null rather than throwing when the stored value is unusable', () => {
    // A plan whose configuration cannot be read is missing data. The caller decides what that
    // means, and for eligibility it means undetermined rather than a guess.
    for (const bad of [null, undefined, {}, [], 'rules', [{ category: 'DENTAL' }]]) {
      expect(parseCoverageRules(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects a category outside the closed vocabulary', () => {
    expect(parseCoverageRules([{ ...valid[0], category: 'ACUPUNCTURE' }])).toBeNull();
  });

  it('rejects an unknown field rather than silently keeping it', () => {
    expect(parseCoverageRules([{ ...valid[0], secretDiscount: true }])).toBeNull();
  });

  it('rejects a negative annual limit', () => {
    expect(parseCoverageRules([{ ...valid[0], annualLimitCents: -1 }])).toBeNull();
  });

  it('finds a rule by category and reports a missing one as null', () => {
    const rules = parseCoverageRules(valid) ?? [];
    expect(findCoverageRule(rules, 'DENTAL')?.ruleRef).toBe('PLAN-DEN-05');
    expect(findCoverageRule(rules, 'VISION')).toBeNull();
  });
});
