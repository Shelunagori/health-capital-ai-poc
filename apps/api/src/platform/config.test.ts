import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ConfigError,
  databaseUrlRequiresTls,
  loadConfig,
  looksLikePlaceholder,
  scrubSecrets,
} from './config.js';

// Fixture values are generated per run: nothing that looks like a credential is committed, and the
// scrubbing assertions below are stronger for using a value that cannot appear anywhere by accident.
const SAFE_SECRET = `${randomUUID()}${randomUUID()}`;

const demoEnv = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'demo',
  PUBLIC_WEB_ORIGIN: 'https://demo.example.test',
  PUBLIC_API_URL: 'https://api.demo.example.test',
  CORS_ALLOWED_ORIGINS: 'https://demo.example.test',
  DATABASE_URL: 'postgresql://user:pw@db.internal:5432/app?sslmode=require',
  JWT_SECRET: SAFE_SECRET,
  ...overrides,
});

const problemsOf = (env: NodeJS.ProcessEnv): string[] => {
  try {
    loadConfig(env);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return [...err.problems];
    throw err;
  }
};

describe('loadConfig in local mode', () => {
  it('accepts localhost HTTP origins and a non-TLS database (synthetic local data only)', () => {
    const config = loadConfig({
      APP_ENV: 'local',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/health_capital',
    });
    expect(config.appEnv).toBe('local');
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:3000']);
    expect(config.bodyLimitBytes).toBe(65_536);
  });

  it('defaults APP_ENV to local', () => {
    expect(loadConfig({}).appEnv).toBe('local');
  });

  it('still rejects a short JWT secret when one is provided', () => {
    expect(problemsOf({ APP_ENV: 'local', JWT_SECRET: 'short' })).toEqual([
      'JWT_SECRET, when set, must be at least 32 bytes',
    ]);
  });
});

describe('loadConfig in demo mode fails closed', () => {
  it('accepts a fully safe demo configuration', () => {
    expect(problemsOf(demoEnv())).toEqual([]);
  });

  it('rejects a DATABASE_URL without TLS', () => {
    expect(
      problemsOf(demoEnv({ DATABASE_URL: 'postgresql://user:pw@db.internal:5432/app' })),
    ).toContain(
      'DATABASE_URL must be set and require TLS (sslmode=require or stricter) in demo mode',
    );
  });

  it('rejects sslmode=prefer as not strict enough', () => {
    expect(
      problemsOf(
        demoEnv({ DATABASE_URL: 'postgresql://user:pw@db.internal:5432/app?sslmode=prefer' }),
      ),
    ).toContain(
      'DATABASE_URL must be set and require TLS (sslmode=require or stricter) in demo mode',
    );
  });

  it('rejects non-HTTPS public origins', () => {
    const problems = problemsOf(
      demoEnv({
        PUBLIC_WEB_ORIGIN: 'http://demo.example.test',
        PUBLIC_API_URL: 'http://api.example.test',
      }),
    );
    expect(problems).toContain('PUBLIC_WEB_ORIGIN must be set and use https:// in demo mode');
    expect(problems).toContain('PUBLIC_API_URL must be set and use https:// in demo mode');
  });

  it('rejects a missing, short or placeholder JWT secret', () => {
    expect(problemsOf(demoEnv({ JWT_SECRET: undefined }))).toContain(
      'JWT_SECRET must be set and be at least 32 bytes in demo mode',
    );
    expect(problemsOf(demoEnv({ JWT_SECRET: 'tooshort' }))).toContain(
      'JWT_SECRET, when set, must be at least 32 bytes',
    );
    expect(
      problemsOf(demoEnv({ JWT_SECRET: 'change-me-generate-a-real-secret-of-at-least-32-bytes' })),
    ).toContain('JWT_SECRET must not be a placeholder value');
  });

  it('rejects placeholder provider and database credentials', () => {
    expect(problemsOf(demoEnv({ GEMINI_API_KEY: 'change-me' }))).toContain(
      'GEMINI_API_KEY must not be a placeholder value',
    );
    expect(
      problemsOf(
        demoEnv({ DATABASE_URL: 'postgresql://user:CHANGE_ME@db:5432/app?sslmode=require' }),
      ),
    ).toContain('DATABASE_URL must not contain a placeholder value');
  });

  it('rejects empty, wildcard and non-HTTPS CORS allowlists', () => {
    expect(problemsOf(demoEnv({ CORS_ALLOWED_ORIGINS: '' }))).toContain(
      'CORS_ALLOWED_ORIGINS must not be empty in demo mode',
    );
    expect(problemsOf(demoEnv({ CORS_ALLOWED_ORIGINS: '*' }))).toContain(
      'CORS_ALLOWED_ORIGINS must not contain a wildcard',
    );
    expect(problemsOf(demoEnv({ CORS_ALLOWED_ORIGINS: 'http://demo.example.test' }))).toContain(
      'CORS_ALLOWED_ORIGINS must contain only https:// origins in demo mode',
    );
  });

  it('reports every problem at once', () => {
    const problems = problemsOf({ APP_ENV: 'demo' });
    expect(problems.length).toBeGreaterThanOrEqual(5);
  });
});

describe('helpers', () => {
  it('recognises TLS-requiring database URLs', () => {
    expect(databaseUrlRequiresTls('postgresql://a:b@h/db?sslmode=require')).toBe(true);
    expect(databaseUrlRequiresTls('postgresql://a:b@h/db?schema=public&sslmode=verify-full')).toBe(
      true,
    );
    expect(databaseUrlRequiresTls('postgresql://a:b@h/db?sslmode=disable')).toBe(false);
    expect(databaseUrlRequiresTls('postgresql://a:b@h/db')).toBe(false);
  });

  it('recognises placeholder values', () => {
    expect(looksLikePlaceholder('change-me')).toBe(true);
    expect(looksLikePlaceholder('REPLACE_ME')).toBe(true);
    expect(looksLikePlaceholder(SAFE_SECRET)).toBe(false);
    expect(looksLikePlaceholder(undefined)).toBe(false);
  });
});

describe('configuration errors never echo secret values', () => {
  const DB_PASSWORD = `db-${randomUUID()}`;
  const JWT_VALUE = `jwt-${randomUUID()}-${randomUUID()}`;
  const API_KEY = `key-${randomUUID()}`;

  /** Every place a caller could read an error from: each problem, the message, and the stack. */
  const surfacesOf = (env: NodeJS.ProcessEnv): string => {
    try {
      loadConfig(env);
      return '';
    } catch (err) {
      if (err instanceof ConfigError) {
        return [...err.problems, err.message, err.stack ?? ''].join('\n');
      }
      throw err;
    }
  };

  it('omits database credentials, JWT secret and API key from a failing demo configuration', () => {
    const surfaces = surfacesOf({
      APP_ENV: 'demo',
      // Every one of these is invalid for demo mode, so all checks fire at once.
      PUBLIC_WEB_ORIGIN: 'http://demo.example.test',
      PUBLIC_API_URL: 'http://api.example.test',
      CORS_ALLOWED_ORIGINS: '*',
      DATABASE_URL: `postgresql://appuser:${DB_PASSWORD}@db.internal:5432/app`,
      JWT_SECRET: JWT_VALUE,
      GEMINI_API_KEY: API_KEY,
    });

    expect(surfaces).not.toBe('');
    expect(surfaces).not.toContain(DB_PASSWORD);
    expect(surfaces).not.toContain(JWT_VALUE);
    expect(surfaces).not.toContain(API_KEY);
    expect(surfaces).not.toContain('appuser:');
    // The field name and a safe reason are still reported.
    expect(surfaces).toContain('DATABASE_URL must be set and require TLS');
  });

  it('omits secret values from schema-level validation failures', () => {
    const surfaces = surfacesOf({
      APP_ENV: 'demo',
      PORT: 'not-a-number',
      DATABASE_URL: `postgresql://appuser:${DB_PASSWORD}@db.internal:5432/app?sslmode=require`,
      JWT_SECRET: JWT_VALUE,
    });

    expect(surfaces).toContain('PORT');
    expect(surfaces).not.toContain(DB_PASSWORD);
    expect(surfaces).not.toContain(JWT_VALUE);
  });

  it('scrubs every occurrence of a secret, including repeats', () => {
    expect(scrubSecrets('a SECRETVALUE b SECRETVALUE', ['SECRETVALUE'])).toBe(
      'a [REDACTED] b [REDACTED]',
    );
    expect(scrubSecrets('nothing to scrub', ['SECRETVALUE'])).toBe('nothing to scrub');
  });
});
