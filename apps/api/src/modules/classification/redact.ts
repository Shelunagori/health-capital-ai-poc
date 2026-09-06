import { DataClass, fieldNamesWithClass } from './registry.js';

export const REDACTED = '[REDACTED]';

/** Classes that must never appear in a log line, and that audit metadata strips before writing. */
export const SENSITIVE_CLASSES: readonly DataClass[] = [
  DataClass.PII,
  DataClass.PHI,
  DataClass.SECRET,
];

/**
 * Replaces values whose field name is classified in one of `classes` with a redaction marker.
 * Walks plain objects and arrays; leaves other values untouched.
 *
 * Field names are matched against every model in the registry, so this is deliberately broad:
 * it is a safety net, not a substitute for constructing the right shape in the first place.
 */
export function redactByClass(
  value: unknown,
  classes: readonly DataClass[] = SENSITIVE_CLASSES,
): unknown {
  const sensitiveNames = new Set(fieldNamesWithClass(classes));
  return redact(value, sensitiveNames, 0);
}

const MAX_DEPTH = 8;

function redact(value: unknown, sensitiveNames: ReadonlySet<string>, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, sensitiveNames, depth + 1));
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sensitiveNames.has(key) ? REDACTED : redact(item, sensitiveNames, depth + 1);
  }
  return out;
}

/**
 * pino `redact` paths derived from the registry: every field name classified PII, PHI or SECRET,
 * matched at the top level and one level down.
 *
 * `excludeNames` keeps operational log fields usable when a name is sensitive on one model but is
 * also part of the safe structured log shape (for example `outcome`, which is a plain enum in an
 * audit log line but health-related on an eligibility decision). The primary control remains the
 * typed field allowlist in the logger; this list is the second layer.
 */
export function classificationRedactPaths(excludeNames: readonly string[] = []): string[] {
  const excluded = new Set(excludeNames);
  const names = fieldNamesWithClass(SENSITIVE_CLASSES).filter((name) => !excluded.has(name));
  return names.flatMap((name) => [name, `*.${name}`]);
}
