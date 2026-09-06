import { describe, expect, it } from 'vitest';
import { AuditAction, auditMetadataSchemas } from './events.js';

describe('audit metadata shapes are closed', () => {
  it('covers every action in the catalogue', () => {
    expect(Object.keys(auditMetadataSchemas).sort()).toEqual(Object.values(AuditAction).sort());
  });

  it('rejects an unexpected field rather than storing it', () => {
    const result = auditMetadataSchemas.AUTHZ_DENIED.safeParse({
      attemptedAction: 'READ_MEMBER_PROFILE',
      denialReason: 'ROLE_NOT_PERMITTED',
      resourceKind: 'MEMBER',
      memberName: 'Sarah Thompson',
    });
    expect(result.success).toBe(false);
  });

  it('rejects free text where a code is expected', () => {
    expect(
      auditMetadataSchemas.AUTH_LOGIN_FAILED.safeParse({ reason: 'they typed it wrong' }).success,
    ).toBe(false);
    expect(
      auditMetadataSchemas.AUTH_LOGIN_FAILED.safeParse({ reason: 'INVALID_CREDENTIALS' }).success,
    ).toBe(true);
  });

  it('has no field anywhere that would accept a member question or a prompt', () => {
    const serialised = JSON.stringify(
      Object.values(auditMetadataSchemas).map((schema) => Object.keys(schema.shape)),
    );
    for (const forbidden of [
      'question',
      'prompt',
      'text',
      'body',
      'message',
      'justification',
      'hash',
    ]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('accepts a login success with no metadata at all', () => {
    expect(auditMetadataSchemas.AUTH_LOGIN_SUCCEEDED.safeParse({}).success).toBe(true);
    expect(auditMetadataSchemas.AUTH_LOGIN_SUCCEEDED.safeParse({ userId: 'x' }).success).toBe(
      false,
    );
  });
});
