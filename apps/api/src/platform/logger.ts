import { pino, type Logger, type LoggerOptions, type DestinationStream } from 'pino';
import type { AppConfig } from './config.js';

/**
 * Logging contract: operational metadata only.
 *
 * Never log request bodies, query strings, Authorization/Cookie values, passwords, tokens, API keys,
 * database credentials, member questions, prompts, tool results, model payloads, or Prisma entities.
 * The `SafeLogFields` type is the primary control; pino redaction below is defense in depth.
 */
export interface SafeLogFields {
  traceId?: string;
  method?: string;
  /** Route pattern (e.g. `/members/:id`), never the concrete URL. */
  route?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  role?: string;
  action?: string;
  outcome?: string;
  engineVersion?: string;
  planConfigVersion?: number;
  promptTemplateId?: string;
  promptVersion?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  count?: number;
  code?: string;
  errorType?: string;
  /** Short, static, developer-written message describing the event. */
  msg?: string;
}

/**
 * The operational field names that may appear in a log line. Exported so the classification module
 * can be told which names are safe even when the same name is sensitive on some persisted model.
 */
export const SAFE_LOG_FIELD_NAMES: readonly string[] = [
  'traceId',
  'method',
  'route',
  'statusCode',
  'durationMs',
  'userId',
  'role',
  'action',
  'outcome',
  'engineVersion',
  'planConfigVersion',
  'promptTemplateId',
  'promptVersion',
  'provider',
  'model',
  'latencyMs',
  'count',
  'code',
  'errorType',
  'msg',
];

/**
 * Defense-in-depth redaction of well-known sensitive keys wherever they appear.
 * The composition root adds the classification registry's PII/PHI/SECRET field names via
 * `extraRedactPaths`, so this module stays independent of the domain.
 */
export const REDACT_PATHS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'apiKey',
  'secret',
  'jwtSecret',
  'databaseUrl',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.apiKey',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

export interface CreateLoggerOptions {
  level: AppConfig['logLevel'];
  pretty?: boolean;
  /** Extra pino redaction paths, e.g. derived from the data-classification registry. */
  extraRedactPaths?: readonly string[];
  /** Test hook: capture output instead of writing to stdout. */
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const base: LoggerOptions = {
    level: options.level,
    base: { service: 'health-capital-api' },
    redact: {
      paths: [...new Set([...REDACT_PATHS, ...(options.extraRedactPaths ?? [])])],
      censor: '[REDACTED]',
    },
    // Only the error type and message are serialised; no request/response objects are ever passed.
    serializers: {
      err: (err: unknown) => {
        if (err instanceof Error) {
          return { type: err.name, message: err.message, stack: err.stack };
        }
        return { type: 'unknown' };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (options.destination) {
    return pino(base, options.destination);
  }
  if (options.pretty) {
    return pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true } } });
  }
  return pino(base);
}
