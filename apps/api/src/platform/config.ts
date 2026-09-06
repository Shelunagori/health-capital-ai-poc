import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 *
 * APP_ENV drives fail-closed behaviour:
 *  - local / test: synthetic data on a developer machine; localhost HTTP and non-TLS Postgres allowed.
 *  - demo: deployed environment; refuses to start when transport or storage settings are obviously unsafe.
 */
export const AppEnv = z.enum(['local', 'test', 'demo']);

/** Mirrors the integrations module's scenario names, kept here so configuration stays self-contained. */
const ScenarioName = z.enum([
  'normal',
  'unavailable',
  'timeout',
  'stale',
  'conflicting',
  'not_found',
]);
export type ScenarioName = z.infer<typeof ScenarioName>;
export type AppEnv = z.infer<typeof AppEnv>;

/** Values that look like they were copied from .env.example rather than generated. */
const PLACEHOLDER_PATTERN =
  /change[-_ ]?me|placeholder|replace[-_ ]?me|your[-_ ](secret|key|password)|xxx+/i;

export function looksLikePlaceholder(value: string | undefined): boolean {
  return value !== undefined && PLACEHOLDER_PATTERN.test(value);
}

const csv = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const RawEnvSchema = z.object({
  APP_ENV: AppEnv.default('local'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  PUBLIC_WEB_ORIGIN: z.string().url().optional(),
  PUBLIC_API_URL: z.string().url().optional(),
  // Required since the API gained authentication: it cannot serve a request without either.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') >= 32,
      'JWT_SECRET must be at least 32 bytes',
    ),
  GEMINI_API_KEY: z.string().optional(),
  /** Overrides the provider's own default model id. Optional: unset means use that default. */
  GEMINI_MODEL: z.string().trim().min(1).optional(),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(65_536),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  /** Ceiling for any single client address across all routes. */
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).default(300),
  /** Login attempts per window for one client address and submitted address. */
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(5),
  /** Guidance calls an external model, so it is limited more tightly than ordinary reads. */
  RATE_LIMIT_GUIDANCE_MAX: z.coerce.number().int().min(1).default(20),
  // Synthetic external-system behaviour, for demonstrating what happens during an outage.
  INTEGRATION_SCENARIO_EMPLOYER: ScenarioName.default('normal'),
  INTEGRATION_SCENARIO_BENEFITS: ScenarioName.default('normal'),
  INTEGRATION_SCENARIO_CARD: ScenarioName.default('normal'),
});

export interface AppConfig {
  readonly appEnv: AppEnv;
  readonly host: string;
  readonly port: number;
  readonly logLevel: z.infer<typeof RawEnvSchema>['LOG_LEVEL'];
  readonly corsAllowedOrigins: readonly string[];
  readonly publicWebOrigin: string | undefined;
  readonly publicApiUrl: string | undefined;
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly geminiApiKey: string | undefined;
  /** Undefined means the AI provider applies its own default. */
  readonly geminiModel: string | undefined;
  readonly bodyLimitBytes: number;
  readonly rateLimitWindowMs: number;
  readonly rateLimitGlobalMax: number;
  readonly rateLimitLoginMax: number;
  readonly rateLimitGuidanceMax: number;
  readonly integrationScenarios: {
    readonly employerSystem: ScenarioName;
    readonly benefitsAdministrator: ScenarioName;
    readonly cardSystem: ScenarioName;
  };
}

export class ConfigError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

/** Environment variables whose values must never appear in an error message, log line or stack. */
const SECRET_ENV_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GEMINI_API_KEY',
  'SEED_USER_PASSWORD',
] as const;

/** Extracts the password component of a database URL so it is scrubbed even in isolation. */
function databaseUrlPassword(url: string | undefined): string | undefined {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:([^@/\s]+)@/i.exec(url ?? '');
  return match?.[1];
}

function secretValuesFrom(env: NodeJS.ProcessEnv): string[] {
  const values = SECRET_ENV_KEYS.map((key) => env[key]);
  values.push(databaseUrlPassword(env['DATABASE_URL']));
  // Very short values would scrub harmless substrings out of otherwise useful messages.
  return values.filter((v): v is string => typeof v === 'string' && v.length >= 4);
}

/**
 * Configuration problems name the field and a safe reason. This is the belt-and-braces step that
 * guarantees no secret value can reach the message, whatever a validator chose to include.
 */
export function scrubSecrets(message: string, secrets: readonly string[]): string {
  return secrets.reduce((acc, secret) => acc.split(secret).join('[REDACTED]'), message);
}

const isHttps = (url: string | undefined): boolean =>
  url !== undefined && url.startsWith('https://');

/** `sslmode=require`, `verify-ca` or `verify-full` (Postgres URL query or libpq style). */
export function databaseUrlRequiresTls(url: string): boolean {
  return (
    /[?&]sslmode=(require|verify-ca|verify-full)(&|$)/i.test(url) || /[?&]ssl=true(&|$)/i.test(url)
  );
}

/**
 * Checks that only apply when APP_ENV=demo. Each returns a problem string or null.
 * Kept as data so the list is easy to review and test.
 */
const demoChecks: ReadonlyArray<(c: AppConfig) => string | null> = [
  (c) =>
    isHttps(c.publicWebOrigin)
      ? null
      : 'PUBLIC_WEB_ORIGIN must be set and use https:// in demo mode',
  (c) =>
    isHttps(c.publicApiUrl) ? null : 'PUBLIC_API_URL must be set and use https:// in demo mode',
  (c) =>
    databaseUrlRequiresTls(c.databaseUrl)
      ? null
      : 'DATABASE_URL must be set and require TLS (sslmode=require or stricter) in demo mode',
  (c) =>
    looksLikePlaceholder(c.databaseUrl)
      ? 'DATABASE_URL must not contain a placeholder value'
      : null,
  (c) => (looksLikePlaceholder(c.jwtSecret) ? 'JWT_SECRET must not be a placeholder value' : null),
  (c) =>
    looksLikePlaceholder(c.geminiApiKey) ? 'GEMINI_API_KEY must not be a placeholder value' : null,
  (c) =>
    c.corsAllowedOrigins.length > 0 ? null : 'CORS_ALLOWED_ORIGINS must not be empty in demo mode',
  (c) =>
    c.corsAllowedOrigins.includes('*') ? 'CORS_ALLOWED_ORIGINS must not contain a wildcard' : null,
  (c) =>
    c.corsAllowedOrigins.every(isHttps)
      ? null
      : 'CORS_ALLOWED_ORIGINS must contain only https:// origins in demo mode',
];

// Length and presence are enforced by the schema above, so nothing remains that applies to every
// environment. Kept as an explicit empty list so adding one has an obvious home.
const alwaysChecks: ReadonlyArray<(c: AppConfig) => string | null> = [];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secrets = secretValuesFrom(env);
  const parsed = RawEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => scrubSecrets(`${i.path.join('.')}: ${i.message}`, secrets)),
    );
  }
  const raw = parsed.data;
  const config: AppConfig = {
    appEnv: raw.APP_ENV,
    host: raw.HOST,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    corsAllowedOrigins: csv(raw.CORS_ALLOWED_ORIGINS),
    publicWebOrigin: raw.PUBLIC_WEB_ORIGIN,
    publicApiUrl: raw.PUBLIC_API_URL,
    databaseUrl: raw.DATABASE_URL,
    jwtSecret: raw.JWT_SECRET,
    geminiApiKey: raw.GEMINI_API_KEY,
    geminiModel: raw.GEMINI_MODEL,
    bodyLimitBytes: raw.BODY_LIMIT_BYTES,
    rateLimitWindowMs: raw.RATE_LIMIT_WINDOW_MS,
    rateLimitGlobalMax: raw.RATE_LIMIT_GLOBAL_MAX,
    rateLimitLoginMax: raw.RATE_LIMIT_LOGIN_MAX,
    rateLimitGuidanceMax: raw.RATE_LIMIT_GUIDANCE_MAX,
    integrationScenarios: {
      employerSystem: raw.INTEGRATION_SCENARIO_EMPLOYER,
      benefitsAdministrator: raw.INTEGRATION_SCENARIO_BENEFITS,
      cardSystem: raw.INTEGRATION_SCENARIO_CARD,
    },
  };

  const checks = config.appEnv === 'demo' ? [...alwaysChecks, ...demoChecks] : alwaysChecks;
  const problems = checks
    .map((check) => check(config))
    .filter((p): p is string => p !== null)
    .map((p) => scrubSecrets(p, secrets));
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
}
