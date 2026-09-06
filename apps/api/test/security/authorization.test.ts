import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createTestDb } from '../helpers/db.js';
import { SEEDED, authHeader } from '../helpers/principals.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Authorization boundaries against the seeded dataset. Every case here is an attempt that must
 * fail: a member reaching for another member, an employer reaching for health data, a caller
 * reaching across tenancies.
 */
describe('authorization boundaries', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;

  let sarahId: string;
  let priyaId: string;
  let jonasId: string;
  let northstarId: string;
  let harborId: string;

  let sarah: { authorization: string };
  let priya: { authorization: string };
  let adminNorthstar: { authorization: string };
  let adminHarbor: { authorization: string };
  let support: { authorization: string };

  beforeAll(async () => {
    db = createTestDb();
    harness = await createTestApp({ db });
    app = harness.app;

    const byRef = async (ref: string): Promise<string> =>
      (await db.member.findUniqueOrThrow({ where: { externalRef: ref }, select: { id: true } })).id;
    sarahId = await byRef('MBR-001');
    priyaId = await byRef('MBR-003');
    jonasId = await byRef('MBR-004');

    northstarId = (
      await db.employer.findUniqueOrThrow({
        where: { externalRef: 'EMP-001' },
        select: { id: true },
      })
    ).id;
    harborId = (
      await db.employer.findUniqueOrThrow({
        where: { externalRef: 'EMP-002' },
        select: { id: true },
      })
    ).id;

    [sarah, priya, adminNorthstar, adminHarbor, support] = await Promise.all([
      authHeader(app, SEEDED.memberSarah),
      authHeader(app, SEEDED.memberPriya),
      authHeader(app, SEEDED.adminNorthstar),
      authHeader(app, SEEDED.adminHarbor),
      authHeader(app, SEEDED.support),
    ]);
  });

  afterAll(async () => {
    await harness.close();
    await db.$disconnect();
  });

  describe('a member reaches only their own record', () => {
    it('reads their own profile', async () => {
      const res = await app.inject({ method: 'GET', url: '/me/profile', headers: sarah });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ memberId: sarahId, firstName: 'Sarah' });
    });

    it('is refused another member by identifier', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${priyaId}/profile`,
        headers: sarah,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
      // The refusal says nothing about whether that member exists.
      expect(res.body).not.toMatch(/priya|raman/i);
    });

    it('is refused a member identifier that does not exist, with the same answer', async () => {
      const missing = await app.inject({
        method: 'GET',
        url: '/members/33333333-3333-4333-8333-0000000000ff/profile',
        headers: sarah,
      });
      const other = await app.inject({
        method: 'GET',
        url: `/members/${priyaId}/profile`,
        headers: sarah,
      });
      expect(missing.statusCode).toBe(403);
      // Identical apart from the per-request trace identifier, so existence stays hidden.
      expect(missing.json<{ error: unknown }>().error).toEqual(
        other.json<{ error: unknown }>().error,
      );
    });

    it('reads its own record through the identifier route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile`,
        headers: sarah,
      });
      expect(res.statusCode).toBe(200);
    });

    it('cannot list an employer roster', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/employers/${northstarId}/members`,
        headers: sarah,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('an employer administrator never sees member health or financial data', () => {
    it('is refused a member profile, even for someone enrolled with them', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile`,
        headers: adminNorthstar,
      });
      expect(res.statusCode).toBe(403);
    });

    it('is refused even when supplying a reason code and case reference', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile?reasonCode=MEMBER_SUPPORT_TICKET&caseRef=CASE-0001`,
        headers: adminNorthstar,
      });
      expect(res.statusCode).toBe(403);
    });

    it('sees a roster with names and plans but nothing clinical or financial', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/employers/${northstarId}/members`,
        headers: adminNorthstar,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{ members: Record<string, unknown>[] }>();
      expect(body.members.length).toBeGreaterThan(0);
      for (const summary of body.members) {
        expect(Object.keys(summary).sort()).toEqual([
          'effectiveFrom',
          'effectiveTo',
          'employeeId',
          'firstName',
          'lastName',
          'memberId',
          'planName',
          'status',
        ]);
      }
      for (const forbidden of ['DENTAL', 'amountCents', 'balance', 'treatmentCategory', 'MBR-']) {
        expect(res.body).not.toContain(forbidden);
      }
    });

    it('cannot read another employer roster', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/employers/${harborId}/members`,
        headers: adminNorthstar,
      });
      expect(res.statusCode).toBe(403);
    });

    it('cannot read a summary for a member enrolled with another employer', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${priyaId}/summary`,
        headers: adminNorthstar,
      });
      expect(res.statusCode).toBe(403);
    });

    it('follows a member who changed employer, for their own period only', async () => {
      // Jonas moved from Harbor Works to Northstar Industries, so both may see a summary.
      for (const header of [adminNorthstar, adminHarbor]) {
        const res = await app.inject({
          method: 'GET',
          url: `/members/${jonasId}/summary`,
          headers: header,
        });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('support reads are gated on a stated reason', () => {
    it('is refused a member profile with no justification', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile`,
        headers: support,
      });
      expect(res.statusCode).toBe(403);
    });

    it('is refused when the case reference is free text rather than a reference', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile?reasonCode=FRAUD_REVIEW&caseRef=${encodeURIComponent('because I need to look')}`,
        headers: support,
      });
      expect(res.statusCode).toBe(403);
    });

    it('is refused when the reason code is outside the closed list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile?reasonCode=CURIOSITY&caseRef=CASE-0001`,
        headers: support,
      });
      expect(res.statusCode).toBe(403);
    });

    it('succeeds with a coded reason and a case reference', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile?reasonCode=BENEFITS_DISPUTE&caseRef=CASE-0042`,
        headers: support,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ memberId: sarahId });
    });

    it('may look across employers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/members/${priyaId}/summary`,
        headers: support,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ memberRef: 'MBR-003' });
    });
  });

  describe('unauthenticated and malformed requests', () => {
    it('refuses every member route without a token', async () => {
      for (const url of [
        '/me/profile',
        '/me/enrollments',
        `/members/${sarahId}/profile`,
        `/employers/${northstarId}/members`,
      ]) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(401);
      }
    });

    it('rejects a non-identifier in the path rather than querying with it', async () => {
      const res = await app.inject({
        method: 'GET',
        url: "/members/1' OR '1'='1/profile",
        headers: priya,
      });
      expect([400, 404]).toContain(res.statusCode);
    });

    it('marks authorized reads as not cacheable', async () => {
      const res = await app.inject({ method: 'GET', url: '/me/profile', headers: sarah });
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});

/**
 * A refusal that is not recorded is a refusal nobody can review later. Both member-scoped write
 * paths are checked, because both had a short-circuit that ran before the authorization step.
 */
describe('every refusal reaches the audit trail', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;
  let adminNorthstar: { authorization: string };

  beforeAll(async () => {
    db = createTestDb();
    harness = await createTestApp({ db });
    app = harness.app;
    adminNorthstar = await authHeader(app, SEEDED.adminNorthstar);
  });

  afterAll(async () => {
    await harness.close();
    await db.$disconnect();
  });

  it('records an employer administrator refused an eligibility evaluation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/eligibility/evaluate',
      headers: adminNorthstar,
      payload: {
        treatmentCategory: 'DENTAL',
        expenseAmountCents: 1_000,
        serviceDate: '2026-05-04',
      },
    });
    expect(res.statusCode).toBe(403);

    const events = await db.auditEvent.findMany({
      where: { traceId: res.headers['x-trace-id'] as string },
    });
    expect(events.map((e) => e.action)).toContain('AUTHZ_DENIED');
    expect(events[0]?.metadata).toMatchObject({
      attemptedAction: 'EVALUATE_OWN_ELIGIBILITY',
      denialReason: 'ROLE_NOT_PERMITTED',
    });
  });

  it('records an employer administrator refused guidance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/guidance/ask',
      headers: adminNorthstar,
      payload: { question: 'is dental covered' },
    });
    expect(res.statusCode).toBe(403);

    const events = await db.auditEvent.findMany({
      where: { traceId: res.headers['x-trace-id'] as string },
    });
    expect(events.map((e) => e.action)).toContain('AUTHZ_DENIED');
  });
});

/** The endpoints the employer and support views depend on, checked at their own boundaries. */
describe('employer plan and directory endpoints', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;
  let northstarId: string;
  let harborId: string;
  let adminNorthstar: { authorization: string };
  let support: { authorization: string };
  let sarah: { authorization: string };

  beforeAll(async () => {
    db = createTestDb();
    harness = await createTestApp({ db });
    app = harness.app;
    northstarId = (await db.employer.findUniqueOrThrow({ where: { externalRef: 'EMP-001' } })).id;
    harborId = (await db.employer.findUniqueOrThrow({ where: { externalRef: 'EMP-002' } })).id;
    [adminNorthstar, support, sarah] = await Promise.all([
      authHeader(app, SEEDED.adminNorthstar),
      authHeader(app, SEEDED.support),
      authHeader(app, SEEDED.memberSarah),
    ]);
  });

  afterAll(async () => {
    await harness.close();
    await db.$disconnect();
  });

  it('lets an administrator read their own plan rules', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/employers/${northstarId}/plans`,
      headers: adminNorthstar,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ plans: { coverage: { category: string }[] }[] }>();
    expect(body.plans[0]?.coverage.length).toBe(8);
    // Plan rules, not anyone's data.
    expect(res.body).not.toMatch(/Sarah|Thompson|NS-1001|MBR-/);
  });

  it('refuses another employer plan', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/employers/${harborId}/plans`,
      headers: adminNorthstar,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a member entirely', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/employers/${northstarId}/plans`,
      headers: sarah,
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists employers for support only', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/employers', headers: support })).statusCode,
    ).toBe(200);
    for (const headers of [adminNorthstar, sarah]) {
      expect((await app.inject({ method: 'GET', url: '/employers', headers })).statusCode).toBe(
        403,
      );
    }
  });

  it('returns only the caller own scope from the context endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/context', headers: adminNorthstar });
    expect(res.json()).toEqual({ role: 'EMPLOYER_ADMIN', memberId: null, employerId: northstarId });

    const asMember = await app.inject({ method: 'GET', url: '/me/context', headers: sarah });
    expect(asMember.json<{ employerId: null }>().employerId).toBeNull();
  });
});
