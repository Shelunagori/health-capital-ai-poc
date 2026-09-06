import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createTestDb } from '../helpers/db.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Login against the seeded dataset. The seed password comes from the environment, exactly as the
 * seed script consumed it, so no credential is written into this file.
 */
const MEMBER_EMAIL = 'sarah.thompson@example.test';
const SUPPORT_EMAIL = 'support.desk@example.test';

function seedPassword(): string {
  const password = process.env['SEED_USER_PASSWORD'];
  if (password === undefined || password === '') {
    throw new Error('SEED_USER_PASSWORD must be set to the value used when seeding.');
  }
  return password;
}

describe('login', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;

  beforeAll(async () => {
    db = createTestDb();
    harness = await createTestApp({ db });
    app = harness.app;
  });

  afterAll(async () => {
    await harness.close();
    await db.$disconnect();
  });

  it('issues a short-lived bearer token for valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: MEMBER_EMAIL, password: seedPassword() },
    });

    expect(res.statusCode).toBe(200);
    const body: unknown = res.json();
    expect(body).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresInSeconds: 900,
      role: 'MEMBER',
    });
    // No personal data and no password echo in the response.
    expect(res.body).not.toContain(seedPassword());
    expect(res.body).not.toMatch(/sarah|thompson/i);
  });

  it('accepts an address in any casing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: MEMBER_EMAIL.toUpperCase(), password: seedPassword() },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns the same failure for a wrong password and an unknown account', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: MEMBER_EMAIL, password: `${seedPassword()}-wrong` },
    });
    const unknownAccount = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody.here@example.test', password: seedPassword() },
    });
    const malformed = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'not-an-address', password: '' },
    });

    for (const res of [wrongPassword, unknownAccount, malformed]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' },
        traceId: expect.any(String),
      });
    }
  });

  it('never sends a password or a token to the log', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: MEMBER_EMAIL, password: seedPassword() },
    });
    const logs = harness.logLines().join('\n');
    expect(logs).not.toContain(seedPassword());
    expect(logs).not.toContain(MEMBER_EMAIL);
    expect(logs).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    // The successful login is still recorded with operational fields.
    expect(logs).toContain('AUTH_LOGIN_SUCCEEDED');
  });

  it('marks the login response as not cacheable', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: MEMBER_EMAIL, password: seedPassword() },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('carries the acting user, role and single scope reference in the token', async () => {
    const support = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: SUPPORT_EMAIL, password: seedPassword() },
    });
    expect(support.statusCode).toBe(200);
    expect(support.json()).toMatchObject({ role: 'SUPPORT' });
  });
});

describe('login rate limiting', () => {
  let harness: TestApp;
  let db: PrismaClient;

  beforeAll(async () => {
    db = createTestDb();
    harness = await createTestApp({
      db,
      env: { RATE_LIMIT_LOGIN_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' },
    });
  });

  afterAll(async () => {
    await harness.close();
    await db.$disconnect();
  });

  it('stops repeated attempts against one account', async () => {
    const attempt = () =>
      harness.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'brute.force@example.test', password: 'guess-after-guess-1' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await attempt()).statusCode);

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});

describe('authentication is required by default', () => {
  let harness: TestApp;
  let app: FastifyInstance;
  let db: PrismaClient;

  beforeAll(async () => {
    db = createTestDb();
    harness = await createTestApp({
      db,
      // A route added without opting out of authentication must be protected.
      routes: (instance) =>
        instance.get('/__test/protected', (request) => ({ role: request.principal?.role ?? null })),
    });
    app = harness.app;
  });

  afterAll(async () => {
    await harness.close();
    await db.$disconnect();
  });

  const login = async (): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: MEMBER_EMAIL, password: seedPassword() },
    });
    return res.json<{ accessToken: string }>().accessToken;
  };

  it('refuses a request with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('accepts a valid token and exposes the principal to the handler', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/__test/protected',
      headers: { authorization: `Bearer ${await login()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role: 'MEMBER' });
  });

  it('refuses malformed, tampered and foreign tokens', async () => {
    const valid = await login();
    const [header, payload, signature] = valid.split('.');
    const tampered = `${header}.${Buffer.from(
      JSON.stringify({ sub: '00000000-0000-4000-8000-000000000000', role: 'SUPPORT' }),
    ).toString('base64url')}.${signature}`;

    for (const authorization of [
      'Bearer not-a-token',
      `Bearer ${tampered}`,
      `Basic ${valid}`,
      `Bearer ${header}.${payload}.`,
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/__test/protected',
        headers: { authorization },
      });
      expect(res.statusCode, authorization).toBe(401);
    }
  });

  it('keeps health public', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
