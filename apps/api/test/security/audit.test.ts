import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createTestDb } from '../helpers/db.js';
import { SEEDED, authHeader, seedPassword } from '../helpers/principals.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * The audit trail must record refusals and privileged reads, and must not become a way to read the
 * data it describes.
 */
describe('audit trail', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;
  let sarahId: string;
  let priyaId: string;

  let sarah: { authorization: string };
  let adminNorthstar: { authorization: string };
  let support: { authorization: string };

  /**
   * Assertions are scoped to the trace of the request under test. Audit rows are shared state and
   * other suites write to the same table, so counting rows globally would be a race, not a check.
   */
  const eventsFor = async (traceId: string) =>
    db.auditEvent.findMany({ where: { traceId }, orderBy: { occurredAt: 'asc' } });

  beforeAll(async () => {
    db = createTestDb();
    harness = await createTestApp({ db });
    app = harness.app;

    sarahId = (await db.member.findUniqueOrThrow({ where: { externalRef: 'MBR-001' } })).id;
    priyaId = (await db.member.findUniqueOrThrow({ where: { externalRef: 'MBR-003' } })).id;

    [sarah, adminNorthstar, support] = await Promise.all([
      authHeader(app, SEEDED.memberSarah),
      authHeader(app, SEEDED.adminNorthstar),
      authHeader(app, SEEDED.support),
    ]);
  });

  afterAll(async () => {
    await harness.close();
    await db.$disconnect();
  });

  it('records a refusal when an employer administrator reaches for member data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/members/${sarahId}/profile`,
      headers: adminNorthstar,
    });
    expect(res.statusCode).toBe(403);

    const events = await eventsFor(res.headers['x-trace-id'] as string);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      action: 'AUTHZ_DENIED',
      outcome: 'DENY',
      actorRole: 'EMPLOYER_ADMIN',
      resourceType: 'MEMBER',
    });
    expect(event?.metadata).toEqual({
      attemptedAction: 'READ_MEMBER_PROFILE',
      denialReason: 'ROLE_NOT_PERMITTED',
      resourceKind: 'MEMBER',
    });
  });

  it('records a refusal when a member reaches for another member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/members/${priyaId}/profile`,
      headers: sarah,
    });
    const events = await eventsFor(res.headers['x-trace-id'] as string);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ denialReason: 'NOT_OWNER' });
  });

  it('records a support privileged read with its reason code and case reference', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/members/${sarahId}/profile?reasonCode=BENEFITS_DISPUTE&caseRef=CASE-0042`,
      headers: support,
    });
    expect(res.statusCode).toBe(200);

    const events = await eventsFor(res.headers['x-trace-id'] as string);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'PRIVILEGED_READ',
      outcome: 'ALLOW',
      actorRole: 'SUPPORT',
      reasonCode: 'BENEFITS_DISPUTE',
      caseRef: 'CASE-0042',
    });
  });

  it('does not record a privileged read when a member reads their own data', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/profile', headers: sarah });
    expect(res.statusCode).toBe(200);
    // Reading your own record is ordinary access, not privileged access.
    expect(await eventsFor(res.headers['x-trace-id'] as string)).toEqual([]);
  });

  it('records logins without ever storing the address that was tried', async () => {
    const badAttempt = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: SEEDED.memberSarah, password: 'definitely-the-wrong-password' },
    });
    const goodAttempt = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: SEEDED.memberSarah, password: seedPassword() },
    });

    const failed = await eventsFor(badAttempt.headers['x-trace-id'] as string);
    const succeeded = await eventsFor(goodAttempt.headers['x-trace-id'] as string);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ action: 'AUTH_LOGIN_FAILED', outcome: 'FAILURE' });
    expect(failed[0]?.metadata).toEqual({ reason: 'INVALID_CREDENTIALS' });
    expect(succeeded[0]).toMatchObject({ action: 'AUTH_LOGIN_SUCCEEDED', actorRole: 'MEMBER' });

    const everything = JSON.stringify([...failed, ...succeeded]);
    expect(everything).not.toContain(SEEDED.memberSarah);
    expect(everything).not.toContain('definitely-the-wrong-password');
  });

  describe('the viewer', () => {
    it('is available to support only', async () => {
      for (const headers of [sarah, adminNorthstar]) {
        const res = await app.inject({ method: 'GET', url: '/audit/events', headers });
        expect(res.statusCode).toBe(403);
      }
      const allowed = await app.inject({ method: 'GET', url: '/audit/events', headers: support });
      expect(allowed.statusCode).toBe(200);
    });

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/audit/events' });
      expect(res.statusCode).toBe(401);
    });

    it('never returns the resource identifier or any raw row field', async () => {
      await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile`,
        headers: adminNorthstar,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/audit/events?limit=200',
        headers: support,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{ events: Record<string, unknown>[] }>();
      expect(body.events.length).toBeGreaterThan(0);
      // The member whose record was reached for is not identified in the viewer.
      expect(res.body).not.toContain(sarahId);
      for (const event of body.events) {
        expect(event).not.toHaveProperty('resourceId');
        expect(event).not.toHaveProperty('metadata');
      }
    });

    it('exposes no amounts, categories or eligibility outcomes', async () => {
      await db.auditEvent.create({
        data: {
          traceId: 'trace-leak-probe',
          action: 'ELIGIBILITY_EVALUATED',
          outcome: 'SUCCESS',
          resourceType: 'CARE_REQUEST',
          resourceId: sarahId,
          engineVersion: '1.0.0',
          planConfigVersion: 1,
          // A writer that tried to smuggle sensitive values into metadata.
          metadata: { ruleRefs: ['ELIG-CAT-03'], amountCents: 65_000, treatmentCategory: 'DENTAL' },
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/audit/events?traceId=trace-leak-probe',
        headers: support,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('65000');
      expect(res.body).not.toContain('DENTAL');
      expect(res.body).not.toContain(sarahId);
      expect(res.json<{ events: { details: unknown }[] }>().events[0]?.details).toEqual({
        ruleRefs: ['ELIG-CAT-03'],
      });
    });

    it('filters by trace so one request can be followed end to end', async () => {
      const denied = await app.inject({
        method: 'GET',
        url: `/members/${sarahId}/profile`,
        headers: adminNorthstar,
      });
      const traceId = denied.headers['x-trace-id'] as string;

      const res = await app.inject({
        method: 'GET',
        url: `/audit/events?traceId=${traceId}`,
        headers: support,
      });
      const body = res.json<{ events: { traceId: string; action: string }[]; count: number }>();
      expect(body.count).toBe(1);
      expect(body.events[0]).toMatchObject({ traceId, action: 'AUTHZ_DENIED' });
    });

    it('rejects an unsupported filter rather than ignoring it', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/audit/events?resourceId=' + sarahId,
        headers: support,
      });
      expect(res.statusCode).toBe(400);
    });

    it('is not cacheable', async () => {
      const res = await app.inject({ method: 'GET', url: '/audit/events', headers: support });
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  it('cannot be altered or erased through the application', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/members/${sarahId}/profile`,
      headers: adminNorthstar,
    });
    const event = await db.auditEvent.findFirstOrThrow({
      where: { traceId: res.headers['x-trace-id'] as string },
    });

    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { outcome: 'ALLOW' } }),
    ).rejects.toThrow(/append-only/i);
    await expect(db.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/i);
  });
});
