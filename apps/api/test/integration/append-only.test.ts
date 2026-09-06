import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestDb } from '../helpers/db.js';

/**
 * Immutability is enforced by database triggers, not by application discipline, so these tests
 * attempt the mutations directly through the ORM and expect the database to refuse them.
 */
describe('append-only tables', () => {
  let db: PrismaClient;
  const createdAuditIds: string[] = [];
  const createdDecisionIds: string[] = [];
  const createdCareRequestIds: string[] = [];

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(async () => {
    // Rows written here are immutable, so they are removed with a privileged raw delete that
    // temporarily disables the trigger. Nothing in the application has this power.
    if (createdAuditIds.length > 0 || createdDecisionIds.length > 0) {
      await db.$executeRawUnsafe(
        'ALTER TABLE "AuditEvent" DISABLE TRIGGER "AuditEvent_append_only"',
      );
      await db.$executeRawUnsafe(
        'ALTER TABLE "EligibilityDecision" DISABLE TRIGGER "EligibilityDecision_append_only"',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM "EligibilityDecision" WHERE id = ANY($1::uuid[])',
        createdDecisionIds,
      );
      await db.$executeRawUnsafe(
        'DELETE FROM "AuditEvent" WHERE id = ANY($1::uuid[])',
        createdAuditIds,
      );
      await db.$executeRawUnsafe(
        'ALTER TABLE "AuditEvent" ENABLE TRIGGER "AuditEvent_append_only"',
      );
      await db.$executeRawUnsafe(
        'ALTER TABLE "EligibilityDecision" ENABLE TRIGGER "EligibilityDecision_append_only"',
      );
    }
    if (createdCareRequestIds.length > 0) {
      await db.careRequest.deleteMany({ where: { id: { in: createdCareRequestIds } } });
    }
    await db.$disconnect();
  });

  it('accepts an audit event but refuses to update or delete it', async () => {
    const event = await db.auditEvent.create({
      data: {
        traceId: 'trace-append-only-1',
        action: 'AUTHZ_DENIED',
        outcome: 'DENY',
        resourceType: 'CareRequest',
        reasonCode: 'DATA_QUALITY_INVESTIGATION',
        caseRef: 'CASE-0001',
        metadata: { deniedAction: 'READ_CARE_REQUEST' },
      },
    });
    createdAuditIds.push(event.id);

    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { outcome: 'ALLOW' } }),
    ).rejects.toThrow(/append-only/i);

    await expect(db.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/i);

    const stored = await db.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.outcome).toBe('DENY');
  });

  it('rejects a case reference that does not match the constrained format', async () => {
    await expect(
      db.auditEvent.create({
        data: {
          traceId: 'trace-append-only-2',
          action: 'PRIVILEGED_READ',
          outcome: 'ALLOW',
          reasonCode: 'FRAUD_REVIEW',
          caseRef: 'not a case reference',
          metadata: {},
        },
      }),
    ).rejects.toThrow(/AuditEvent_caseRef_format_check/);
  });

  it('accepts an eligibility decision but refuses to update or delete it', async () => {
    const enrollment = await db.benefitEnrollment.findFirstOrThrow({
      where: { status: 'ACTIVE' },
    });
    const careRequest = await db.careRequest.create({
      data: {
        memberId: enrollment.memberId,
        enrollmentId: enrollment.id,
        treatmentCategory: 'PHYSICAL_THERAPY',
        expenseAmountCents: 18_000,
        serviceDate: new Date('2026-05-04'),
      },
    });
    createdCareRequestIds.push(careRequest.id);

    const decision = await db.eligibilityDecision.create({
      data: {
        careRequestId: careRequest.id,
        memberId: enrollment.memberId,
        enrollmentId: enrollment.id,
        outcome: 'ELIGIBLE',
        coveredAmountCents: 18_000,
        reasons: [
          { ruleRef: 'ELIG-COVER-06', code: 'FULLY_COVERED', message: 'Within limit and funds' },
        ],
        conditions: [],
        engineVersion: '0.0.0-m1-fixture',
        planConfigVersion: 1,
        inputsSnapshot: { treatmentCategory: 'PHYSICAL_THERAPY', expenseAmountCents: 18_000 },
      },
    });
    createdDecisionIds.push(decision.id);

    expect(decision.decidedBy).toBe('RULES_ENGINE');

    await expect(
      db.eligibilityDecision.update({
        where: { id: decision.id },
        data: { outcome: 'INELIGIBLE' },
      }),
    ).rejects.toThrow(/append-only/i);

    await expect(db.eligibilityDecision.delete({ where: { id: decision.id } })).rejects.toThrow(
      /append-only/i,
    );

    const stored = await db.eligibilityDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(stored.outcome).toBe('ELIGIBLE');
    expect(stored.engineVersion).toBe('0.0.0-m1-fixture');
  });

  it('requires an undetermined decision to carry no covered amount', async () => {
    const enrollment = await db.benefitEnrollment.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    const careRequest = await db.careRequest.create({
      data: {
        memberId: enrollment.memberId,
        enrollmentId: enrollment.id,
        treatmentCategory: 'DENTAL',
        expenseAmountCents: 5_000,
        serviceDate: new Date('2026-05-05'),
      },
    });
    createdCareRequestIds.push(careRequest.id);

    await expect(
      db.eligibilityDecision.create({
        data: {
          careRequestId: careRequest.id,
          memberId: enrollment.memberId,
          enrollmentId: enrollment.id,
          outcome: 'UNDETERMINED',
          coveredAmountCents: 5_000,
          reasons: [],
          conditions: [],
          engineVersion: '0.0.0-m1-fixture',
          planConfigVersion: 1,
          inputsSnapshot: {},
        },
      }),
    ).rejects.toThrow(/EligibilityDecision_undetermined_has_no_amount_check/);
  });
});
