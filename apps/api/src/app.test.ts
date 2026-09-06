import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './platform/config.js';
import { createLogger } from './platform/logger.js';
import { AppError } from './platform/errors.js';

const ALLOWED_ORIGIN = 'http://localhost:3000';
const SECRET_HEADER_VALUE = 'Bearer super-secret-token-value-9f8e7d';

/** Captures every log line so tests can assert what never appears in logs. */
function captureLogs(): { sink: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { sink, lines: () => chunks.join('').split('\n').filter(Boolean) };
}

describe('platform HTTP baseline', () => {
  let app: FastifyInstance;
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(async () => {
    logs = captureLogs();
    const config = loadConfig({
      APP_ENV: 'test',
      CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
      BODY_LIMIT_BYTES: '2048',
    });
    const logger = createLogger({ level: 'info', destination: logs.sink });
    app = await buildApp({ config, logger });

    // Test-only routes to exercise the body limit and error handler.
    app.post('/__test/echo', (request) => ({ received: request.body }));
    app.get('/__test/boom', () => {
      throw new Error('database password is hunter2 at 10.0.0.5');
    });
    app.get('/__test/forbidden', () => {
      throw new AppError('FORBIDDEN', 'You may not view this resource');
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves liveness without touching dependencies', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', appEnv: 'test', version: expect.any(String) });
  });

  it('returns a server-generated trace id and ignores client-supplied request ids', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'attacker-chosen-id' },
    });
    const traceId = res.headers['x-trace-id'];
    expect(typeof traceId).toBe('string');
    expect(traceId).not.toBe('attacker-chosen-id');
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers and no-store on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows only allowlisted CORS origins', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED_ORIGIN },
    });
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.test' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://evil.example.test',
        'access-control-request-method': 'GET',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized JSON bodies with 413 and a stable error shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(4096) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the allowed size' },
      traceId: res.headers['x-trace-id'],
    });
  });

  it('never leaks internal error details to the client', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.body;
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('10.0.0.5');
    expect(body).not.toContain('stack');
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      traceId: expect.any(String),
    });
  });

  it('passes through safe AppError messages with the mapped status', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/forbidden' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({
      code: 'FORBIDDEN',
      message: 'You may not view this resource',
    });
  });

  it('returns the standard shape for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope?token=abc' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('logs only operational metadata: no Authorization values, bodies or query strings', async () => {
    await app.inject({
      method: 'POST',
      url: '/__test/echo?apiKey=leaky-query-value',
      headers: { 'content-type': 'application/json', authorization: SECRET_HEADER_VALUE },
      payload: JSON.stringify({ question: 'SENTINEL-QUESTION-TEXT-4471' }),
    });
    await app.inject({
      method: 'GET',
      url: '/__test/boom',
      headers: { authorization: SECRET_HEADER_VALUE },
    });

    const all = logs.lines().join('\n');
    expect(all).not.toContain(SECRET_HEADER_VALUE);
    expect(all).not.toContain('super-secret-token');
    expect(all).not.toContain('leaky-query-value');
    expect(all).not.toContain('SENTINEL-QUESTION-TEXT-4471');

    const completed = logs.lines().map((l) => JSON.parse(l) as Record<string, unknown>);
    const echo = completed.find(
      (l) => l['route'] === '/__test/echo' && l['msg'] === 'request completed',
    );
    expect(echo).toBeDefined();
    expect(echo).toMatchObject({ method: 'POST', statusCode: 200 });
    expect(echo).not.toHaveProperty('url');
    expect(echo).not.toHaveProperty('req');
  });
});
