import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './platform/config.js';
import type { Db } from './platform/db.js';
import { registerSecurity } from './platform/http/security.js';
import { registerErrorHandler } from './platform/http/error-handler.js';
import { registerHealth } from './platform/http/health.js';
import {
  AuthService,
  createTokenSigner,
  registerAuthRoutes,
  registerAuthentication,
} from './modules/auth/index.js';
import { MemberRepository, registerMemberRoutes } from './modules/members/index.js';
import { AuditService, registerAuditRoutes } from './modules/audit/index.js';
import { AccessGuard } from './modules/authorization/index.js';

export interface BuildAppOptions {
  config: AppConfig;
  /** Any pino-compatible logger; main.ts passes the instance from createLogger(). */
  logger: FastifyBaseLogger;
  db: Db;
}

/**
 * Wires platform plugins and (from M1 onward) domain modules. Used by main.ts and by tests.
 * The returned instance is not yet `ready()`; callers may add routes before listening/injecting.
 */
export async function buildApp({ config, logger, db }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    // Trace id is always server-generated; client-supplied request ids are ignored.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    // Fastify's default request/response logging would include the URL and headers; we log our own
    // allowlisted fields in the onResponse hook below.
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'traceId' }),
    bodyLimit: config.bodyLimitBytes,
    trustProxy: config.appEnv === 'demo',
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-trace-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        traceId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });

  await registerSecurity(app, config);

  // A ceiling for any single client address across every route. Sensitive routes narrow it further.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitGlobalMax,
    timeWindow: config.rateLimitWindowMs,
    // Error shape and logging stay ours; the plugin only decides when a caller has had enough.
    addHeadersOnExceeding: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
    },
    addHeaders: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
      'retry-after': true,
    },
  });

  registerErrorHandler(app);

  const tokens = createTokenSigner(config.jwtSecret);
  registerAuthentication(app, tokens);

  registerHealth(app, config);
  const audit = new AuditService(db, app.log);
  const guard = new AccessGuard(audit);

  registerAuthRoutes(app, {
    service: new AuthService(db, tokens),
    audit,
    loginRateLimitMax: config.rateLimitLoginMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
  registerMemberRoutes(app, new MemberRepository(db), guard);
  registerAuditRoutes(app, db);

  return app;
}
