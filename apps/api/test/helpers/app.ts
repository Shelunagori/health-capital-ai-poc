import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/platform/config.js';
import { createLogger } from '../../src/platform/logger.js';
import { createDb } from '../../src/platform/db.js';
import type { Db } from '../../src/platform/db.js';
import { testDatabaseUrl } from './db.js';

/** A secret of the required length, generated per run so nothing credential-shaped is committed. */
export const TEST_JWT_SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;

export const TEST_ORIGIN = 'http://localhost:3000';

export interface TestAppOptions {
  /** Overrides merged over the defaults before validation. */
  env?: Record<string, string>;
  /** Supply a database when the test needs one; omit for tests that never query. */
  db?: Db;
  /** Registers extra routes before the instance boots, for tests that need a fixture route. */
  routes?: (app: FastifyInstance) => void;
}

export interface TestApp {
  app: FastifyInstance;
  config: AppConfig;
  logLines: () => string[];
  close: () => Promise<void>;
}

/** Captures log output so tests can assert what never reaches a log line. */
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

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const logs = captureLogs();
  const config = loadConfig({
    APP_ENV: 'test',
    CORS_ALLOWED_ORIGINS: TEST_ORIGIN,
    DATABASE_URL:
      process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? testDatabaseUrl(),
    JWT_SECRET: TEST_JWT_SECRET,
    // Generous by default so a busy test file is not throttled; individual tests narrow it.
    RATE_LIMIT_GLOBAL_MAX: '10000',
    RATE_LIMIT_LOGIN_MAX: '10000',
    ...options.env,
  });

  const db = options.db ?? createDb({ databaseUrl: config.databaseUrl });
  const app = await buildApp({
    config,
    logger: createLogger({ level: 'info', destination: logs.sink }),
    db,
  });
  options.routes?.(app);
  await app.ready();

  return {
    app,
    config,
    logLines: logs.lines,
    close: async () => {
      await app.close();
      if (options.db === undefined) await db.$disconnect();
    },
  };
}
