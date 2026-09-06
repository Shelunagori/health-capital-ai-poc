import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createTestDb } from '../helpers/db.js';
import { SEEDED, authHeader } from '../helpers/principals.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { ScenarioController, Scenario } from '../../src/modules/integrations/index.js';
import {
  evaluate,
  snapshotToInputs,
  type DecisionSnapshot,
} from '../../src/modules/eligibility/index.js';

/**
 * The structured eligibility path end to end, against seeded data and with no AI provider involved.
 * This is the product working on its own.
 */
describe('evaluating an expense', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;
  let scenarios: ScenarioController;
  let sarah: { authorization: string };
  let jonas: { authorization: string };
  let sarahId: string;

  const createdCareRequests: string[] = [];

  const evaluateAs = async (
    headers: { authorization: string },
    payload: { treatmentCategory: string; expenseAmountCents: number; serviceDate: string },
  ) => app.inject({ method: 'POST', url: '/me/eligibility/evaluate', headers, payload });

  beforeAll(async () => {
    db = createTestDb();
    scenarios = new ScenarioController();
    harness = await createTestApp({ db, scenarios });
    app = harness.app;
    sarahId = (await db.member.findUniqueOrThrow({ where: { externalRef: 'MBR-001' } })).id;
    [sarah, jonas] = await Promise.all([
      authHeader(app, SEEDED.memberSarah),
      authHeader(app, SEEDED.memberJonas),
    ]);
  });

  afterEach(() => scenarios.reset());

  afterAll(async () => {
    // Decisions are immutable, so their care requests are removed with the trigger briefly off.
    await db.$executeRawUnsafe('TRUNCATE TABLE "EligibilityDecision" CASCADE');
    if (createdCareRequests.length > 0) {
      await db.careRequest.deleteMany({ where: { id: { in: createdCareRequests } } });
    }
    await db.careRequest.deleteMany({ where: { memberId: sarahId } });
    await harness.close();
    await db.$disconnect();
  });

  it('says yes for a covered expense within limit and balance', async () => {
    const res = await evaluateAs(sarah, {
      treatmentCategory: 'PHYSICAL_THERAPY',
      expenseAmountCents: 18_000,
      serviceDate: '2026-05-04',
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      decision: {
        outcome: string;
        coveredAmountCents: number;
        reasons: { ruleRef: string }[];
        careRequestId: string;
      };
      explanation: string;
      explanationSource: string;
    }>();
    createdCareRequests.push(body.decision.careRequestId);

    expect(body.decision.outcome).toBe('ELIGIBLE');
    expect(body.decision.coveredAmountCents).toBe(18_000);
    expect(body.decision.reasons[0]?.ruleRef).toBe('ELIG-COVER-06');
    // Without an AI provider the wording comes from the platform, and the product still works.
    expect(body.explanationSource).toBe('template');
    expect(body.explanation).toContain('You can use your health capital');
  });

  it('covers part of an expense when the annual limit leaves less', async () => {
    // Seeded dental spend is 65,000 of an 80,000 limit.
    const res = await evaluateAs(sarah, {
      treatmentCategory: 'DENTAL',
      expenseAmountCents: 30_000,
      serviceDate: '2026-05-04',
    });
    const body = res.json<{
      decision: {
        outcome: string;
        coveredAmountCents: number;
        conditions: string[];
        careRequestId: string;
      };
    }>();
    createdCareRequests.push(body.decision.careRequestId);

    expect(body.decision.outcome).toBe('PARTIALLY_ELIGIBLE');
    expect(body.decision.coveredAmountCents).toBe(15_000);
    expect(body.decision.conditions).toEqual(['RECEIPT_REQUIRED']);
  });

  it('says no for a category the plan excludes', async () => {
    const res = await evaluateAs(sarah, {
      treatmentCategory: 'COSMETIC',
      expenseAmountCents: 50_000,
      serviceDate: '2026-05-04',
    });
    const body = res.json<{
      decision: { outcome: string; reasons: { code: string }[]; careRequestId: string };
    }>();
    createdCareRequests.push(body.decision.careRequestId);

    expect(body.decision.outcome).toBe('INELIGIBLE');
    expect(body.decision.reasons[0]?.code).toBe('CATEGORY_NOT_COVERED');
  });

  it('says no for care before the member joined this employer', async () => {
    // Jonas moved employers; his current enrollment starts in October 2025.
    const res = await evaluateAs(jonas, {
      treatmentCategory: 'PRESCRIPTION',
      expenseAmountCents: 5_000,
      serviceDate: '2026-02-11',
    });
    const body = res.json<{ decision: { outcome: string; careRequestId: string } }>();
    createdCareRequests.push(body.decision.careRequestId);
    expect(body.decision.outcome).toBe('ELIGIBLE');

    const earlier = await evaluateAs(jonas, {
      treatmentCategory: 'PRESCRIPTION',
      expenseAmountCents: 5_000,
      serviceDate: '2024-06-01',
    });
    const earlierBody = earlier.json<{
      decision: { outcome: string; reasons: { code: string }[] };
    }>();
    // The old enrollment covers that date but the plan year does not, so it is a clear no.
    expect(earlierBody.decision.outcome).toBe('INELIGIBLE');
  });

  it('stores an immutable decision with a replayable snapshot', async () => {
    const res = await evaluateAs(sarah, {
      treatmentCategory: 'VISION',
      expenseAmountCents: 12_000,
      serviceDate: '2026-05-04',
    });
    const body = res.json<{
      decision: { decisionId: string; careRequestId: string; outcome: string };
    }>();
    createdCareRequests.push(body.decision.careRequestId);

    const stored = await db.eligibilityDecision.findUniqueOrThrow({
      where: { id: body.decision.decisionId },
    });
    expect(stored.decidedBy).toBe('RULES_ENGINE');
    expect(stored.engineVersion).toBe('1.0.0');

    // The stored inputs are sufficient to reach the same conclusion again.
    const replayed = snapshotToInputs(stored.inputsSnapshot as unknown as DecisionSnapshot);
    expect(replayed).not.toBeNull();
    if (replayed !== null) expect(evaluate(replayed).outcome).toBe(body.decision.outcome);

    await expect(
      db.eligibilityDecision.update({ where: { id: stored.id }, data: { outcome: 'ELIGIBLE' } }),
    ).rejects.toThrow(/append-only/i);
  });

  it('stores no name, address or identifier in the snapshot', async () => {
    const res = await evaluateAs(sarah, {
      treatmentCategory: 'MENTAL_HEALTH',
      expenseAmountCents: 9_000,
      serviceDate: '2026-05-04',
    });
    const body = res.json<{ decision: { decisionId: string; careRequestId: string } }>();
    createdCareRequests.push(body.decision.careRequestId);

    const stored = await db.eligibilityDecision.findUniqueOrThrow({
      where: { id: body.decision.decisionId },
    });
    const serialised = JSON.stringify(stored.inputsSnapshot);
    for (const forbidden of ['Sarah', 'Thompson', 'Alder', 'NS-1001', 'MBR-001', '1987-03-14']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it('creates a new decision each time rather than changing the old one', async () => {
    const first = await evaluateAs(sarah, {
      treatmentCategory: 'VISION',
      expenseAmountCents: 7_000,
      serviceDate: '2026-05-05',
    });
    const second = await evaluateAs(sarah, {
      treatmentCategory: 'VISION',
      expenseAmountCents: 7_000,
      serviceDate: '2026-05-05',
    });
    const a = first.json<{ decision: { decisionId: string; careRequestId: string } }>().decision;
    const b = second.json<{ decision: { decisionId: string; careRequestId: string } }>().decision;
    createdCareRequests.push(a.careRequestId, b.careRequestId);

    expect(a.decisionId).not.toBe(b.decisionId);
    expect(a.careRequestId).not.toBe(b.careRequestId);
  });

  it('records the evaluation against the request trace', async () => {
    const res = await evaluateAs(sarah, {
      treatmentCategory: 'PHYSICAL_THERAPY',
      expenseAmountCents: 1_000,
      serviceDate: '2026-05-06',
    });
    createdCareRequests.push(
      res.json<{ decision: { careRequestId: string } }>().decision.careRequestId,
    );

    const traceId = res.headers['x-trace-id'] as string;
    const events = await db.auditEvent.findMany({ where: { traceId } });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('ELIGIBILITY_EVALUATED');
    // The adapters consulted during the decision appear on the same trace.
    expect(actions).toContain('ADAPTER_CALLED');
    expect(JSON.stringify(events)).not.toContain('Sarah');
  });

  describe('when an external system cannot answer', () => {
    it.each([Scenario.UNAVAILABLE, Scenario.TIMEOUT, Scenario.STALE])(
      'is undetermined rather than a guess when the employer system is %s',
      async (scenario) => {
        scenarios.set('employerSystem', scenario);
        const res = await evaluateAs(sarah, {
          treatmentCategory: 'PHYSICAL_THERAPY',
          expenseAmountCents: 18_000,
          serviceDate: '2026-05-04',
        });
        const body = res.json<{
          decision: { outcome: string; coveredAmountCents: null };
          explanation: string;
        }>();
        expect(body.decision.outcome).toBe('UNDETERMINED');
        expect(body.decision.coveredAmountCents).toBeNull();
        expect(body.explanation).toContain('could not check');
      },
    );

    it('is undetermined when the card system cannot be reached', async () => {
      scenarios.set('cardSystem', Scenario.UNAVAILABLE);
      const res = await evaluateAs(sarah, {
        treatmentCategory: 'PHYSICAL_THERAPY',
        expenseAmountCents: 18_000,
        serviceDate: '2026-05-04',
      });
      const body = res.json<{ decision: { outcome: string; careRequestId: string } }>();
      createdCareRequests.push(body.decision.careRequestId);
      expect(body.decision.outcome).toBe('UNDETERMINED');
    });

    it('is undetermined when the card system disagrees with the ledger', async () => {
      scenarios.set('cardSystem', Scenario.CONFLICTING);
      const res = await evaluateAs(sarah, {
        treatmentCategory: 'PHYSICAL_THERAPY',
        expenseAmountCents: 18_000,
        serviceDate: '2026-05-04',
      });
      const body = res.json<{
        decision: { outcome: string; reasons: { code: string }[]; careRequestId: string };
      }>();
      createdCareRequests.push(body.decision.careRequestId);
      expect(body.decision.outcome).toBe('UNDETERMINED');
      expect(body.decision.reasons[0]?.code).toBe('BALANCE_CONFLICT');
    });

    it('says no, not undetermined, when the employer confirms there is no such enrollment', async () => {
      scenarios.set('employerSystem', Scenario.NOT_FOUND);
      const res = await evaluateAs(sarah, {
        treatmentCategory: 'PHYSICAL_THERAPY',
        expenseAmountCents: 18_000,
        serviceDate: '2026-05-04',
      });
      const body = res.json<{ decision: { outcome: string; reasons: { code: string }[] } }>();
      expect(body.decision.outcome).toBe('INELIGIBLE');
      expect(body.decision.reasons[0]?.code).toBe('NO_ENROLLMENT');
    });
  });

  describe('the request itself', () => {
    it('rejects a category outside the closed vocabulary', async () => {
      const res = await evaluateAs(sarah, {
        treatmentCategory: 'ACUPUNCTURE',
        expenseAmountCents: 1_000,
        serviceDate: '2026-05-04',
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a non-positive or fractional amount', async () => {
      for (const expenseAmountCents of [0, -100, 12.5]) {
        const res = await evaluateAs(sarah, {
          treatmentCategory: 'DENTAL',
          expenseAmountCents,
          serviceDate: '2026-05-04',
        });
        expect(res.statusCode, String(expenseAmountCents)).toBe(400);
      }
    });

    it('rejects free text where a structured field is expected', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/me/eligibility/evaluate',
        headers: sarah,
        payload: {
          treatmentCategory: 'DENTAL',
          expenseAmountCents: 1_000,
          serviceDate: '2026-05-04',
          note: 'I have been having pain in my lower left molar since March',
        },
      });
      // A field nobody agreed to is refused rather than stored.
      expect(res.statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/me/eligibility/evaluate',
        payload: {
          treatmentCategory: 'DENTAL',
          expenseAmountCents: 1_000,
          serviceDate: '2026-05-04',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('is not cacheable', async () => {
      const res = await evaluateAs(sarah, {
        treatmentCategory: 'VISION',
        expenseAmountCents: 1_500,
        serviceDate: '2026-05-07',
      });
      createdCareRequests.push(
        res.json<{ decision: { careRequestId: string } }>().decision.careRequestId,
      );
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});
