import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verify } from '@node-rs/argon2';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestDb } from '../helpers/db.js';

/** Matches an Argon2id PHC string: `$argon2id$v=19$m=...,t=...,p=...$salt$hash`. */
const ARGON2ID_PHC = /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

describe('seeded dataset', () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('loads the expected row counts', async () => {
    expect(await db.employer.count()).toBe(2);
    expect(await db.plan.count()).toBe(2);
    expect(await db.member.count()).toBe(4);
    expect(await db.benefitEnrollment.count()).toBe(5);
    expect(await db.healthCapitalAccount.count()).toBe(5);
    expect(await db.ledgerEntry.count()).toBe(17);
    expect(await db.user.count()).toBe(7);
  });

  it('stores only Argon2id hashes, never a seed password', async () => {
    const users = await db.user.findMany();
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user.passwordHash, user.email).toMatch(ARGON2ID_PHC);
      expect(user.passwordHash).not.toContain('SEED_USER_PASSWORD');
    }

    // The hash verifies against the password used to seed, and not against anything else.
    const password = process.env['SEED_USER_PASSWORD'];
    if (password !== undefined && password !== '') {
      const first = users[0];
      expect(first).toBeDefined();
      expect(await verify(first!.passwordHash, password)).toBe(true);
      expect(await verify(first!.passwordHash, `${password}-wrong`)).toBe(false);
    }
  });

  it('uses example.test addresses for every account', async () => {
    const users = await db.user.findMany({ select: { email: true } });
    for (const user of users) expect(user.email.endsWith('@example.test')).toBe(true);
  });

  it('records an enrollment history including a terminated relationship', async () => {
    const terminated = await db.benefitEnrollment.findMany({ where: { status: 'TERMINATED' } });
    expect(terminated.length).toBeGreaterThanOrEqual(1);
    for (const enrollment of terminated) expect(enrollment.effectiveTo).not.toBeNull();

    // One member has moved employers, so the portable identity carries more than one enrollment.
    const grouped = await db.benefitEnrollment.groupBy({
      by: ['memberId'],
      _count: { _all: true },
    });
    const withHistory = grouped.filter((row) => row._count._all > 1);
    expect(withHistory.length).toBeGreaterThanOrEqual(1);

    const memberId = withHistory[0]?.memberId;
    if (memberId === undefined) throw new Error('expected a member with more than one enrollment');
    const employers = await db.benefitEnrollment.findMany({
      where: { memberId },
      select: { employerId: true },
    });
    expect(new Set(employers.map((e) => e.employerId)).size).toBeGreaterThan(1);
  });

  it('tags every debit with a category so category spend is computable', async () => {
    const uncategorised = await db.ledgerEntry.count({
      where: { type: 'DEBIT', benefitCategory: null },
    });
    expect(uncategorised).toBe(0);

    const byCategory = await db.ledgerEntry.groupBy({
      by: ['benefitCategory'],
      where: { type: 'DEBIT' },
      _count: { _all: true },
    });
    expect(byCategory.length).toBeGreaterThanOrEqual(4);
  });

  it('computes year-to-date category spend from the seeded ledger', async () => {
    const member = await db.member.findUniqueOrThrow({ where: { externalRef: 'MBR-001' } });
    const enrollment = await db.benefitEnrollment.findFirstOrThrow({
      where: { memberId: member.id },
      include: { account: true, plan: true },
    });
    const accountId = enrollment.account?.id;
    if (accountId === undefined) throw new Error('expected the enrollment to have an account');

    const entries = await db.ledgerEntry.findMany({
      where: {
        accountId,
        benefitCategory: 'DENTAL',
        occurredAt: { gte: enrollment.plan.planYearStart, lte: enrollment.plan.planYearEnd },
      },
    });
    const spend = entries.reduce(
      (total, entry) => total + (entry.type === 'DEBIT' ? entry.amountCents : -entry.amountCents),
      0,
    );
    expect(spend).toBe(65_000);
  });

  it('gives every active enrollment a health capital account with a contribution', async () => {
    const enrollments = await db.benefitEnrollment.findMany({
      include: { account: { include: { entries: true } } },
    });
    for (const enrollment of enrollments) {
      expect(enrollment.account, enrollment.enrollmentExternalRef).not.toBeNull();
      const contributions =
        enrollment.account?.entries.filter((e) => e.type === 'CONTRIBUTION') ?? [];
      expect(contributions.length).toBeGreaterThan(0);
    }
  });

  it('stores plan coverage rules as data, with stable rule references', async () => {
    const plan = await db.plan.findUniqueOrThrow({ where: { planExternalRef: 'PLAN-001' } });
    const rules = plan.coverageRules as { category: string; covered: boolean; ruleRef: string }[];
    expect(rules).toHaveLength(8);
    expect(rules.find((r) => r.category === 'COSMETIC')?.covered).toBe(false);
    expect(rules.find((r) => r.category === 'PHYSICAL_THERAPY')?.ruleRef).toBe('PLAN-PT-04');
    expect(plan.planConfigVersion).toBe(1);
  });

  it('fabricates no care history: seeded ledger entries stand alone', async () => {
    // The seed provides balances and category spend, not decisions. Later milestones create care
    // requests and decisions from real evaluations, never from fixtures.
    const linked = await db.ledgerEntry.count({ where: { careRequestId: { not: null } } });
    expect(linked).toBe(0);

    const seededDecisions = await db.eligibilityDecision.count({
      where: { decidedBy: 'RULES_ENGINE', engineVersion: { not: { contains: 'fixture' } } },
    });
    expect(seededDecisions).toBe(0);
  });
});
