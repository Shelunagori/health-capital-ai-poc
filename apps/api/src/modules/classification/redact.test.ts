import { describe, expect, it } from 'vitest';
import { DataClass } from './registry.js';
import { REDACTED, classificationRedactPaths, redactByClass } from './redact.js';

describe('redactByClass', () => {
  it('removes PII, PHI and secret values by field name', () => {
    const input = {
      id: 'e6f5c2b8-0000-4000-8000-000000000001',
      firstName: 'Sarah',
      lastName: 'Thompson',
      employeeId: 'NS-1001',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
      treatmentCategory: 'DENTAL',
      planConfigVersion: 3,
    };

    expect(redactByClass(input)).toEqual({
      id: 'e6f5c2b8-0000-4000-8000-000000000001',
      firstName: REDACTED,
      lastName: REDACTED,
      employeeId: REDACTED,
      passwordHash: REDACTED,
      treatmentCategory: REDACTED,
      planConfigVersion: 3,
    });
  });

  it('walks nested objects and arrays', () => {
    const input = {
      trace: { members: [{ firstName: 'Priya', externalRef: 'MBR-003' }] },
      counts: [1, 2, 3],
    };

    expect(redactByClass(input)).toEqual({
      trace: { members: [{ firstName: REDACTED, externalRef: 'MBR-003' }] },
      counts: [1, 2, 3],
    });
  });

  it('honours a narrower class selection', () => {
    const input = { firstName: 'Sarah', passwordHash: 'hash', amountCents: 1200 };

    expect(redactByClass(input, [DataClass.SECRET])).toEqual({
      firstName: 'Sarah',
      passwordHash: REDACTED,
      amountCents: 1200,
    });
    expect(redactByClass(input, [DataClass.FIN])).toEqual({
      firstName: 'Sarah',
      passwordHash: 'hash',
      amountCents: REDACTED,
    });
  });

  it('passes primitives, null and dates through unchanged', () => {
    const date = new Date('2026-02-03T00:00:00.000Z');
    expect(redactByClass('plain')).toBe('plain');
    expect(redactByClass(null)).toBeNull();
    expect(redactByClass(42)).toBe(42);
    expect(redactByClass({ occurredAt: date, description: 'note' })).toEqual({
      occurredAt: date,
      description: 'note',
    });
  });

  it('stops recursing on deeply nested structures rather than looping', () => {
    let nested: Record<string, unknown> = { firstName: 'Sarah' };
    for (let i = 0; i < 20; i += 1) nested = { child: nested };
    expect(() => redactByClass(nested)).not.toThrow();
  });
});

describe('classificationRedactPaths', () => {
  it('produces top-level and one-level-down paths for sensitive names', () => {
    const paths = classificationRedactPaths();
    expect(paths).toContain('passwordHash');
    expect(paths).toContain('*.passwordHash');
    expect(paths).toContain('firstName');
    expect(paths).toContain('treatmentCategory');
  });

  it('never redacts operational fields that are safe to log', () => {
    const paths = classificationRedactPaths();
    expect(paths).not.toContain('traceId');
    expect(paths).not.toContain('planConfigVersion');
    // `outcome` is health-related on a decision but a plain enum in an audit log line, so the
    // caller can exclude it and keep the operational field usable.
    expect(paths).toContain('outcome');
    expect(classificationRedactPaths(['outcome'])).not.toContain('outcome');
    expect(classificationRedactPaths(['outcome'])).not.toContain('*.outcome');
  });
});
