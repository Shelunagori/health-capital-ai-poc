import axe, { type AxeResults, type Result } from 'axe-core';

/**
 * Runs the accessibility rules against rendered markup.
 *
 * This catches the mechanical failures: an input with no label, a control with no accessible name,
 * a heading order that jumps, a table with no header association. It does not catch whether the
 * page makes sense to someone using it, which is a judgement no rule engine makes.
 */
export async function findAccessibilityViolations(container: HTMLElement): Promise<Result[]> {
  const results: AxeResults = await axe.run(container, {
    // Colour contrast needs real layout, which jsdom does not do; the palette is checked separately.
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return results.violations;
}

/** A readable failure: which rule, and which element broke it. */
export function describeViolations(violations: readonly Result[]): string {
  return violations
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`)
    .join('\n');
}
