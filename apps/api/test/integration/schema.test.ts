import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestDb } from '../helpers/db.js';

interface ColumnRow {
  column_name: string;
  is_nullable: string;
  data_type: string;
}

describe('database schema', () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const columnsOf = async (table: string): Promise<ColumnRow[]> =>
    db.$queryRawUnsafe<ColumnRow[]>(
      `SELECT column_name, is_nullable, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY column_name`,
      table,
    );

  it('creates every model as a table', async () => {
    const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'Employer',
        'Plan',
        'Member',
        'BenefitEnrollment',
        'HealthCapitalAccount',
        'LedgerEntry',
        'User',
        'CareRequest',
        'EligibilityDecision',
        'AuditEvent',
      ]),
    );
  });

  it('has no providerName column anywhere in the database', async () => {
    // Provider identity is not persisted: no deterministic rule consumes it. (`AuditEvent.aiProvider`
    // names the AI vendor, not a healthcare provider, so it is matched exactly rather than by prefix.)
    const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name ILIKE 'provider%'`,
    );
    expect(rows).toEqual([]);

    const careRequestColumns = (await columnsOf('CareRequest')).map((c) => c.column_name);
    expect(careRequestColumns).not.toContain('providerName');
    expect(careRequestColumns).toEqual([
      'createdAt',
      'enrollmentId',
      'expenseAmountCents',
      'id',
      'memberId',
      'serviceDate',
      'treatmentCategory',
    ]);
  });

  it('stores the opaque enrollment reference used by the employer system adapter', async () => {
    const columns = await columnsOf('BenefitEnrollment');
    const ref = columns.find((c) => c.column_name === 'enrollmentExternalRef');
    expect(ref).toBeDefined();
    expect(ref?.is_nullable).toBe('NO');

    const indexes = await db.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'BenefitEnrollment'`,
    );
    expect(
      indexes.some(
        (i) => i.indexdef.includes('UNIQUE') && i.indexdef.includes('enrollmentExternalRef'),
      ),
    ).toBe(true);
  });

  it('keeps money as integers', async () => {
    for (const [table, column] of [
      ['LedgerEntry', 'amountCents'],
      ['CareRequest', 'expenseAmountCents'],
      ['EligibilityDecision', 'coveredAmountCents'],
    ] as const) {
      const columns = await columnsOf(table);
      expect(columns.find((c) => c.column_name === column)?.data_type).toBe('integer');
    }
  });

  it('allows only one health capital account per enrollment', async () => {
    const indexes = await db.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'HealthCapitalAccount'`,
    );
    expect(
      indexes.some((i) => i.indexdef.includes('UNIQUE') && i.indexdef.includes('enrollmentId')),
    ).toBe(true);
  });

  it('declares the expected check constraints', async () => {
    const rows = await db.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`,
    );
    const names = rows.map((r) => r.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        'Plan_planYear_check',
        'BenefitEnrollment_effectiveRange_check',
        'BenefitEnrollment_terminated_requires_end_check',
        'LedgerEntry_amount_positive_check',
        'LedgerEntry_debit_requires_category_check',
        'CareRequest_amount_positive_check',
        'EligibilityDecision_undetermined_has_no_amount_check',
        'User_role_scope_check',
        'AuditEvent_caseRef_format_check',
      ]),
    );
  });
});

describe('database constraints reject invalid data', () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('rejects a debit with no benefit category', async () => {
    const account = await db.healthCapitalAccount.findFirstOrThrow();
    await expect(
      db.ledgerEntry.create({
        data: {
          accountId: account.id,
          type: 'DEBIT',
          amountCents: 1_000,
          occurredAt: new Date('2026-06-01T00:00:00.000Z'),
          benefitCategory: null,
          description: 'invalid debit',
        },
      }),
    ).rejects.toThrow(/LedgerEntry_debit_requires_category_check/);
  });

  it('rejects a non-positive amount', async () => {
    const account = await db.healthCapitalAccount.findFirstOrThrow();
    await expect(
      db.ledgerEntry.create({
        data: {
          accountId: account.id,
          type: 'CONTRIBUTION',
          amountCents: 0,
          occurredAt: new Date('2026-06-01T00:00:00.000Z'),
          description: 'invalid contribution',
        },
      }),
    ).rejects.toThrow(/LedgerEntry_amount_positive_check/);
  });

  it('rejects a member user that also carries an employer scope', async () => {
    const member = await db.member.findFirstOrThrow();
    const employer = await db.employer.findFirstOrThrow();
    await expect(
      db.user.create({
        data: {
          email: 'invalid.scope@example.test',
          passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
          role: 'MEMBER',
          memberId: member.id,
          employerId: employer.id,
        },
      }),
    ).rejects.toThrow(/User_role_scope_check/);
  });

  it('rejects a terminated enrollment with no end date', async () => {
    const enrollment = await db.benefitEnrollment.findFirstOrThrow();
    await expect(
      db.benefitEnrollment.create({
        data: {
          memberId: enrollment.memberId,
          employerId: enrollment.employerId,
          planId: enrollment.planId,
          employeeId: 'INVALID-9999',
          status: 'TERMINATED',
          effectiveFrom: new Date('2025-01-01'),
          effectiveTo: null,
          enrollmentExternalRef: 'ENR-999',
          sourceAsOf: new Date('2026-01-01T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow(/BenefitEnrollment_terminated_requires_end_check/);
  });
});
