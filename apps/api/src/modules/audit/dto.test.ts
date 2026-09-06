import { describe, expect, it } from 'vitest';
import { SupportAuditEventDtoSchema } from '@health-capital/contracts';
import { toSupportAuditEventDto, type AuditEventRow } from './dto.js';

const row = (metadata: unknown, overrides: Partial<AuditEventRow> = {}): AuditEventRow => ({
  id: '88888888-8888-4888-8888-000000000001',
  occurredAt: new Date('2026-05-01T10:00:00.000Z'),
  traceId: 'trace-1',
  actorUserId: '77777777-7777-4777-8777-000000000003',
  actorRole: 'SUPPORT',
  action: 'PRIVILEGED_READ',
  outcome: 'ALLOW',
  resourceType: 'MEMBER',
  engineVersion: null,
  planConfigVersion: null,
  aiProvider: null,
  aiModel: null,
  promptTemplateId: null,
  promptVersion: null,
  reasonCode: 'BENEFITS_DISPUTE',
  caseRef: 'CASE-0042',
  metadata,
  ...overrides,
});

describe('the support audit view is an allowlist', () => {
  it('emits exactly the agreed keys', () => {
    const dto = toSupportAuditEventDto(
      row({ attemptedAction: 'READ_MEMBER_PROFILE', resourceKind: 'MEMBER' }),
    );
    expect(SupportAuditEventDtoSchema.parse(dto)).toEqual(dto);
    expect(Object.keys(dto).sort()).toEqual([
      'action',
      'actorRole',
      'actorUserId',
      'aiModel',
      'aiProvider',
      'caseRef',
      'details',
      'engineVersion',
      'id',
      'occurredAt',
      'outcome',
      'planConfigVersion',
      'promptTemplateId',
      'promptVersion',
      'reasonCode',
      'resourceType',
      'traceId',
    ]);
  });

  it('never carries the resource identifier', () => {
    // The row type has no `resourceId` at all, so the column cannot reach a response by accident.
    const dto = toSupportAuditEventDto(row({}));
    expect(dto).not.toHaveProperty('resourceId');
    expect(JSON.stringify(dto)).not.toContain('33333333');
  });

  it('drops anything in metadata that is not on the list', () => {
    // Even if a future writer smuggled these in, the viewer would not show them.
    const dto = toSupportAuditEventDto(
      row({
        attemptedAction: 'READ_MEMBER_LEDGER',
        amountCents: 65_000,
        treatmentCategory: 'DENTAL',
        memberId: '33333333-3333-4333-8333-000000000001',
        question: 'can I use my health capital for dental work',
      }),
    );

    const serialised = JSON.stringify(dto);
    expect(serialised).not.toContain('65000');
    expect(serialised).not.toContain('DENTAL');
    expect(serialised).not.toContain('33333333');
    expect(serialised).not.toContain('health capital for dental');
    expect(dto.details).toEqual({ deniedAction: 'READ_MEMBER_LEDGER' });
  });

  it('lifts the operational details it does recognise', () => {
    const dto = toSupportAuditEventDto(
      row(
        { adapterName: 'CardSystemAdapter', result: 'UNAVAILABLE', latencyMs: 42 },
        { action: 'ADAPTER_CALLED' },
      ),
    );
    expect(dto.details).toEqual({
      adapterName: 'CardSystemAdapter',
      adapterResult: 'UNAVAILABLE',
      latencyMs: 42,
    });
  });

  it('lifts redaction counts without the values that were redacted', () => {
    const dto = toSupportAuditEventDto(
      row(
        { stage: 'A', latencyMs: 120, redactions: [{ kind: 'EMAIL', count: 1 }] },
        { action: 'AI_CALL' },
      ),
    );
    expect(dto.details.redactionCounts).toEqual([{ kind: 'EMAIL', count: 1 }]);
  });

  it('tolerates metadata that is missing or the wrong shape', () => {
    for (const metadata of [null, undefined, 'a string', 42, []]) {
      expect(() => toSupportAuditEventDto(row(metadata))).not.toThrow();
    }
  });
});
