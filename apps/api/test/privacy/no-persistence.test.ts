import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createTestDb } from '../helpers/db.js';
import { SEEDED, authHeader } from '../helpers/principals.js';
import { describeHits, findValueInDatabase } from '../helpers/scan.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { FakeProvider } from '../../src/modules/ai/index.js';

/**
 * What a member types must not survive the request.
 *
 * A sentinel phrase makes this checkable: it appears nowhere in the codebase or the seed, so if it
 * turns up in a column, an audit row or a log line, it got there from the question.
 */
const SENTINEL = 'ZZQ-SENTINEL-PHRASE-8471';
const CONTACT_EMAIL = 'private.contact.8471@example.test';
const PHONE = '+44 7700 918471';

describe('a member question does not survive the request', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;
  let provider: FakeProvider;
  let sarah: { authorization: string };

  beforeAll(async () => {
    db = createTestDb();
    provider = new FakeProvider({
      toolTurns: [
        {
          text: null,
          toolCalls: [
            {
              name: 'evaluate_expense_eligibility',
              args: {
                treatmentCategory: 'DENTAL',
                expenseAmountCents: 20_000,
                serviceDate: '2026-05-04',
              },
            },
          ],
        },
      ],
      structured: { verdict: 'ELIGIBLE', explanation: 'Your plan covers this dental expense.' },
    });
    harness = await createTestApp({ db, provider });
    app = harness.app;
    sarah = await authHeader(app, SEEDED.memberSarah);

    // One question carrying a sentinel phrase, a contact address and a telephone number.
    const res = await app.inject({
      method: 'POST',
      url: '/me/guidance/ask',
      headers: sarah,
      payload: {
        question:
          `I am Sarah Thompson of 14 Alder Street, Riverton 40218, employee NS-1001, born 1987-03-14. ` +
          `${SENTINEL}. Reach me at ${CONTACT_EMAIL} or ${PHONE}. ` +
          `Can I use my health capital for 200 dollars of dental work?`,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  afterAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE TABLE "EligibilityDecision" CASCADE');
    await db.careRequest.deleteMany();
    await harness.close();
    await db.$disconnect();
  });

  it('is in no column of any table', async () => {
    const hits = await findValueInDatabase(db, SENTINEL);
    expect(hits, `sentinel found in ${describeHits(hits)}`).toEqual([]);
  });

  it('leaves no contact details behind either', async () => {
    for (const value of [CONTACT_EMAIL, '7700 918471', 'private.contact']) {
      const hits = await findValueInDatabase(db, value);
      expect(hits, `${value} found in ${describeHits(hits)}`).toEqual([]);
    }
  });

  it('is in no audit event, in any form', async () => {
    const events = JSON.stringify(await db.auditEvent.findMany());
    expect(events).not.toContain(SENTINEL);
    expect(events).not.toContain(CONTACT_EMAIL);
    // No hash of it either: a hash of someone's words is still derived from their words.
    expect(events).not.toMatch(/questionHash|promptHash|"hash"/i);
  });

  it('is in no log line', () => {
    const logs = harness.logLines().join('\n');
    expect(logs).not.toContain(SENTINEL);
    expect(logs).not.toContain(CONTACT_EMAIL);
    expect(logs).not.toContain('Alder Street');
    expect(logs).not.toContain('918471');
  });

  it('records only that a call happened, with which template and how much was removed', async () => {
    const calls = await db.auditEvent.findMany({ where: { action: 'AI_CALL' } });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.promptTemplateId).toMatch(/^guidance\.stage[AB]$/);
      expect(call.promptVersion).toBe('1');
      const metadata = call.metadata as { stage: string; redactions: { kind: string }[] };
      expect(['A', 'B']).toContain(metadata.stage);
      // Counts, never values.
      expect(JSON.stringify(metadata.redactions)).not.toContain('@');
    }
  });

  it('stores the structured expense, which is what a decision actually needs', async () => {
    const careRequests = await db.careRequest.findMany();
    expect(careRequests.length).toBeGreaterThan(0);
    expect(careRequests[0]).toMatchObject({
      treatmentCategory: 'DENTAL',
      expenseAmountCents: 20_000,
    });
    // And nothing resembling free text: the model chose a category, it did not write prose we kept.
    expect(Object.keys(careRequests[0] ?? {})).not.toContain('providerName');
    expect(Object.keys(careRequests[0] ?? {})).not.toContain('note');
  });
});

describe('what actually crossed the boundary', () => {
  let harness: TestApp;
  let db: PrismaClient;
  let provider: FakeProvider;

  beforeAll(async () => {
    db = createTestDb();
    provider = new FakeProvider({
      toolTurns: [
        {
          text: null,
          toolCalls: [
            {
              name: 'evaluate_expense_eligibility',
              args: {
                treatmentCategory: 'DENTAL',
                expenseAmountCents: 20_000,
                serviceDate: '2026-05-04',
              },
            },
          ],
        },
      ],
      structured: { verdict: 'ELIGIBLE', explanation: 'Your plan covers this dental expense.' },
    });
    harness = await createTestApp({ db, provider });
    const sarah = await authHeader(harness.app, SEEDED.memberSarah);

    await harness.app.inject({
      method: 'POST',
      url: '/me/guidance/ask',
      headers: sarah,
      payload: {
        question:
          `I am Sarah Thompson, employee NS-1001, reference MBR-001, born 1987-03-14, at 14 Alder Street. ` +
          `${SENTINEL}. Can I claim 200 dollars of dental?`,
      },
    });
  });

  afterAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE TABLE "EligibilityDecision" CASCADE');
    await db.careRequest.deleteMany();
    await harness.close();
    await db.$disconnect();
  });

  it('carries no seeded personal value to the provider', () => {
    const sent = provider.sentPayloads();
    for (const value of [
      'Sarah',
      'Thompson',
      'Alder Street',
      'Riverton',
      '40218',
      'NS-1001',
      'MBR-001',
      '1987-03-14',
    ]) {
      expect(sent, value).not.toContain(value);
    }
  });

  it('carries no identifier of any kind to the provider', () => {
    const sent = provider.sentPayloads();
    // No database identifiers, and no opaque external references either.
    expect(sent).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(sent).not.toMatch(/\b(?:MBR|ENR|EMP|PLAN|CARD)-\d+/);
    expect(sent).not.toContain('memberRef');
    expect(sent).not.toContain('memberId');
  });

  it('gives the second stage no member text at all', () => {
    const structured = JSON.stringify(provider.structuredRequests);
    expect(structured).not.toContain(SENTINEL);
    expect(structured).not.toContain('dental?');
    expect(structured).not.toContain('Can I claim');
  });

  it('gives the second stage only the agreed fields', () => {
    const request = provider.structuredRequests[0];
    expect(request).toBeDefined();
    expect(Object.keys(request?.context ?? {}).sort()).toEqual([
      'availableBalanceCents',
      'conditions',
      'coveredAmountCents',
      'engineVersion',
      'expenseAmountCents',
      'outcome',
      'reasons',
      'remainingCategoryLimitCents',
      'serviceDate',
      'treatmentCategory',
    ]);
  });

  it('gives the first stage the sanitized question and the healthcare intent it needs', () => {
    const request = provider.toolRequests[0];
    expect(request).toBeDefined();
    expect(request?.query.text).toContain('dental');
    expect(request?.query.text).not.toContain('Sarah');
    expect(request?.query.text).not.toContain('NS-1001');
    // The sentinel is ordinary words, so it survives: sanitizing removes identifiers, not meaning.
    expect(request?.query.redactions.length).toBeGreaterThan(0);
  });
});
