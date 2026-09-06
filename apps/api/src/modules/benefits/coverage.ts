import { z } from 'zod';

/**
 * Plan coverage rules are data, not code. The plan row stores them as JSON, refreshed from the
 * benefits administrator, and this schema is the only way they enter the application.
 *
 * Rule *logic* stays in versioned code; only these parameters vary per plan.
 */
export const SubstantiationSchema = z.enum(['NONE', 'RECEIPT_REQUIRED']);
export type Substantiation = z.infer<typeof SubstantiationSchema>;

export const CoverageRuleSchema = z
  .object({
    category: z.enum([
      'PHYSICAL_THERAPY',
      'DENTAL',
      'VISION',
      'MENTAL_HEALTH',
      'PRESCRIPTION',
      'COSMETIC',
      'GYM_MEMBERSHIP',
      'OTHER',
    ]),
    covered: z.boolean(),
    /** Null means covered without an annual ceiling. */
    annualLimitCents: z.number().int().min(0).nullable(),
    substantiation: SubstantiationSchema,
    /** Stable reference to the plan clause, quoted back in a decision's reasons. */
    ruleRef: z.string().min(1).max(32),
  })
  .strict();
export type CoverageRule = z.infer<typeof CoverageRuleSchema>;

export const CoverageRulesSchema = z.array(CoverageRuleSchema).min(1);

/**
 * Parses stored coverage rules. Returns null rather than throwing when the stored value does not
 * match: a plan whose configuration cannot be read is missing data, and eligibility treats missing
 * data as undetermined rather than guessing.
 */
export function parseCoverageRules(value: unknown): CoverageRule[] | null {
  const parsed = CoverageRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function findCoverageRule(
  rules: readonly CoverageRule[],
  category: string,
): CoverageRule | null {
  return rules.find((rule) => rule.category === category) ?? null;
}
