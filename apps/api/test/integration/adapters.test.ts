import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { BenefitsService } from '../../src/modules/benefits/index.js';
import {
  BALANCE_TOLERANCE_CENTS,
  Scenario,
  ScenarioController,
  SyntheticBenefitsAdministratorAdapter,
  SyntheticCardSystemAdapter,
  SyntheticEmployerSystemAdapter,
} from '../../src/modules/integrations/index.js';

/**
 * The adapters against seeded data. The point of these tests is the distinction the whole
 * eligibility story rests on: a confirmed "no" is not the same answer as "we could not find out".
 */
describe('synthetic external systems', () => {
  let db: PrismaClient;
  let benefits: BenefitsService;
  let scenarios: ScenarioController;
  let employerSystem: SyntheticEmployerSystemAdapter;
  let benefitsAdministrator: SyntheticBenefitsAdministratorAdapter;
  let cardSystem: SyntheticCardSystemAdapter;

  beforeAll(() => {
    db = createTestDb();
    benefits = new BenefitsService(db);
    scenarios = new ScenarioController();
    employerSystem = new SyntheticEmployerSystemAdapter(db, scenarios);
    benefitsAdministrator = new SyntheticBenefitsAdministratorAdapter(benefits, scenarios);
    cardSystem = new SyntheticCardSystemAdapter(benefits, scenarios);
  });

  afterEach(() => scenarios.reset());
  afterAll(async () => db.$disconnect());

  describe('the employer system confirms one enrollment at a time', () => {
    it('answers for a reference it recognises', async () => {
      const result = await employerSystem.getEnrollment('ENR-001');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('ACTIVE');
      expect(result.source).toBe('EmployerSystemAdapter');
      expect(result.asOf).toBeInstanceOf(Date);
    });

    it('reports a terminated enrollment as terminated, with its end date', async () => {
      const result = await employerSystem.getEnrollment('ENR-004');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('TERMINATED');
      expect(result.data.effectiveTo).not.toBeNull();
    });

    it('treats an unrecognised reference as an answer, not a failure to answer', async () => {
      const result = await employerSystem.getEnrollment('ENR-999');
      expect(result).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    });

    it.each([
      [Scenario.UNAVAILABLE, 'UNAVAILABLE'],
      [Scenario.TIMEOUT, 'TIMEOUT'],
      [Scenario.STALE, 'STALE'],
      [Scenario.NOT_FOUND, 'NOT_FOUND'],
    ])('reports %s as %s', async (scenario, reason) => {
      scenarios.set('employerSystem', scenario);
      expect(await employerSystem.getEnrollment('ENR-001')).toMatchObject({ ok: false, reason });
    });

    it('can contradict what we hold, which is a different thing again', async () => {
      const healthy = await employerSystem.getEnrollment('ENR-001');
      scenarios.set('employerSystem', Scenario.CONFLICTING);
      const conflicting = await employerSystem.getEnrollment('ENR-001');

      expect(healthy.ok && conflicting.ok).toBe(true);
      if (!healthy.ok || !conflicting.ok) return;
      expect(conflicting.data.status).not.toBe(healthy.data.status);
    });
  });

  describe('the benefits administrator supplies plan configuration', () => {
    it('returns the version and the coverage rules', async () => {
      const result = await benefitsAdministrator.getPlanConfiguration('PLAN-001');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.planConfigVersion).toBe(1);
      expect(Array.isArray(result.data.coverageRules)).toBe(true);
    });

    it('reports an unknown plan reference as not found', async () => {
      expect(await benefitsAdministrator.getPlanConfiguration('PLAN-999')).toMatchObject({
        ok: false,
        reason: 'NOT_FOUND',
      });
    });

    it('answers from data too old to rely on when conflicting', async () => {
      scenarios.set('benefitsAdministrator', Scenario.CONFLICTING);
      const result = await benefitsAdministrator.getPlanConfiguration('PLAN-001');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Date.now() - result.asOf.getTime()).toBeGreaterThan(30 * 86_400_000);
    });

    it('fails when the system is unreachable', async () => {
      scenarios.set('benefitsAdministrator', Scenario.UNAVAILABLE);
      expect(await benefitsAdministrator.getPlanConfiguration('PLAN-001')).toMatchObject({
        ok: false,
        reason: 'UNAVAILABLE',
      });
    });
  });

  describe('the card system reports available money', () => {
    it('agrees with our ledger when healthy', async () => {
      const account = await benefits.findAccountByCardRef('CARD-001');
      expect(account).not.toBeNull();

      const result = await cardSystem.getAvailableBalance('CARD-001');
      expect(result.ok).toBe(true);
      if (!result.ok || account === null) return;
      expect(result.data.availableCents).toBe(account.ledgerBalanceCents);
    });

    it('disagrees beyond tolerance when conflicting', async () => {
      const account = await benefits.findAccountByCardRef('CARD-001');
      scenarios.set('cardSystem', Scenario.CONFLICTING);
      const result = await cardSystem.getAvailableBalance('CARD-001');

      expect(result.ok).toBe(true);
      if (!result.ok || account === null) return;
      expect(Math.abs(result.data.availableCents - account.ledgerBalanceCents)).toBeGreaterThan(
        BALANCE_TOLERANCE_CENTS,
      );
    });

    it('reports an unknown card reference as not found', async () => {
      expect(await cardSystem.getAvailableBalance('CARD-999')).toMatchObject({
        ok: false,
        reason: 'NOT_FOUND',
      });
    });

    it('fails when the system does not answer in time', async () => {
      scenarios.set('cardSystem', Scenario.TIMEOUT);
      expect(await cardSystem.getAvailableBalance('CARD-001')).toMatchObject({
        ok: false,
        reason: 'TIMEOUT',
      });
    });
  });

  it('never throws, whatever the scenario', async () => {
    for (const scenario of Object.values(Scenario)) {
      scenarios.set('employerSystem', scenario);
      scenarios.set('benefitsAdministrator', scenario);
      scenarios.set('cardSystem', scenario);
      await expect(employerSystem.getEnrollment('ENR-001')).resolves.toBeDefined();
      await expect(benefitsAdministrator.getPlanConfiguration('PLAN-001')).resolves.toBeDefined();
      await expect(cardSystem.getAvailableBalance('CARD-001')).resolves.toBeDefined();
    }
  });
});

describe('benefits reads against the seeded ledger', () => {
  let db: PrismaClient;
  let benefits: BenefitsService;

  beforeAll(() => {
    db = createTestDb();
    benefits = new BenefitsService(db);
  });

  afterAll(async () => db.$disconnect());

  it('computes a balance from contributions, debits and adjustments', async () => {
    const account = await benefits.findAccountByEnrollment(
      (
        await db.benefitEnrollment.findUniqueOrThrow({
          where: { enrollmentExternalRef: 'ENR-001' },
        })
      ).id,
    );
    expect(account).not.toBeNull();
    // 150,000 + 150,000 contributed, 40,000 + 30,000 + 18,000 spent, 5,000 refunded.
    expect(account?.ledgerBalanceCents).toBe(217_000);
  });

  it('computes category spend within the plan year', async () => {
    const enrollment = await db.benefitEnrollment.findUniqueOrThrow({
      where: { enrollmentExternalRef: 'ENR-001' },
    });
    const account = await benefits.findAccountByEnrollment(enrollment.id);
    const plan = await benefits.findPlan(enrollment.planId);
    expect(account).not.toBeNull();
    expect(plan).not.toBeNull();
    if (account === null || plan === null) return;

    expect(await benefits.getYtdCategorySpend(account.accountId, 'DENTAL', plan.planYear)).toBe(
      65_000,
    );
    expect(await benefits.getYtdCategorySpend(account.accountId, 'VISION', plan.planYear)).toBe(0);
  });

  it('reads plan coverage rules as parsed data', async () => {
    const plan = await benefits.findPlanByExternalRef('PLAN-001');
    expect(plan?.coverageRules).toHaveLength(8);
    expect(plan?.coverageRules?.find((r) => r.category === 'DENTAL')).toMatchObject({
      covered: true,
      annualLimitCents: 80_000,
      substantiation: 'RECEIPT_REQUIRED',
      ruleRef: 'PLAN-DEN-05',
    });
  });

  it('returns null for accounts and plans that do not exist', async () => {
    expect(await benefits.findAccountByCardRef('CARD-999')).toBeNull();
    expect(await benefits.findPlanByExternalRef('PLAN-999')).toBeNull();
  });
});

describe('readiness', () => {
  it('reports ready once migrations have been applied', async () => {
    const { createTestApp } = await import('../helpers/app.js');
    const db = createTestDb();
    const harness = await createTestApp({ db });
    try {
      const res = await harness.app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ready' });
    } finally {
      await harness.close();
      await db.$disconnect();
    }
  });

  it('is reachable without a token, like liveness', async () => {
    const { createTestApp } = await import('../helpers/app.js');
    const db = createTestDb();
    const harness = await createTestApp({ db });
    try {
      const res = await harness.app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).not.toBe(401);
    } finally {
      await harness.close();
      await db.$disconnect();
    }
  });

  it('reports not ready when the database cannot be reached', async () => {
    const { createTestApp } = await import('../helpers/app.js');
    const { createDb } = await import('../../src/platform/db.js');
    // A client pointed at nothing: the probe must answer, not hang or throw.
    const db = createDb({ databaseUrl: 'postgresql://nobody:nobody@127.0.0.1:1/nothing' });
    const harness = await createTestApp({ db });
    try {
      const res = await harness.app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'not-ready' });
      // The reason stays coarse: a probe does not describe the database to whoever asks.
      expect(res.body).not.toContain('nobody');
    } finally {
      await harness.close();
    }
  });
});
