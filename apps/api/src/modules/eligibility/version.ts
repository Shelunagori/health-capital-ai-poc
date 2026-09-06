/**
 * Version of the rule *code*. Distinct from a plan's `planConfigVersion`, which versions the
 * *parameters* a plan supplies. A decision records both, so it can be explained later even after
 * either has moved on.
 *
 * Bump this whenever the meaning of a rule changes, including when a rule is added or removed.
 */
export const ENGINE_VERSION = '1.0.0';
