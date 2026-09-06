import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './platform/config.js';
import type { Db } from './platform/db.js';
import { registerSecurity } from './platform/http/security.js';
import { registerErrorHandler } from './platform/http/error-handler.js';
import { registerHealth } from './platform/http/health.js';
import { registerReady } from './platform/http/ready.js';
import {
  AuthService,
  createTokenSigner,
  registerAuthRoutes,
  registerAuthentication,
} from './modules/auth/index.js';
import { MemberRepository, registerMemberRoutes } from './modules/members/index.js';
import { AuditService, registerAuditRoutes } from './modules/audit/index.js';
import { AccessGuard } from './modules/authorization/index.js';
import { BenefitsService } from './modules/benefits/index.js';
import { registerEligibilityRoutes } from './modules/eligibility/index.js';
import { registerGuidanceRoutes } from './modules/guidance/index.js';
import { GeminiProvider, NullProvider, type AIProvider } from './modules/ai/index.js';
import {
  ScenarioController,
  SyntheticBenefitsAdministratorAdapter,
  SyntheticCardSystemAdapter,
  SyntheticEmployerSystemAdapter,
  type Adapters,
} from './modules/integrations/index.js';

export interface BuildAppOptions {
  config: AppConfig;
  /** Any pino-compatible logger; main.ts passes the instance from createLogger(). */
  logger: FastifyBaseLogger;
  db: Db;
  /** Lets a test drive the synthetic external systems without rebuilding the app. */
  scenarios?: ScenarioController;
  /** Overrides the AI provider, so a test can script one instead of calling a real service. */
  provider?: AIProvider;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Current behaviour of the synthetic external systems. */
    scenarios: ScenarioController;
    /** Adapters as composed at startup, before per-request audit wrapping. */
    adapters: Adapters;
  }
}

/**
 * Wires platform plugins and (from M1 onward) domain modules. Used by main.ts and by tests.
 * The returned instance is not yet `ready()`; callers may add routes before listening/injecting.
 */
export async function buildApp({
  config,
  logger,
  db,
  scenarios,
  provider,
}: BuildAppOptions): Promise<FastifyInstance> {
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
  registerReady(app, db);
  const audit = new AuditService(db, app.log);
  const guard = new AccessGuard(audit);

  const scenarioController = scenarios ?? new ScenarioController(config.integrationScenarios);
  const benefits = new BenefitsService(db);
  const adapters: Adapters = {
    employerSystem: new SyntheticEmployerSystemAdapter(db, scenarioController),
    benefitsAdministrator: new SyntheticBenefitsAdministratorAdapter(benefits, scenarioController),
    cardSystem: new SyntheticCardSystemAdapter(benefits, scenarioController),
  };
  app.decorate('scenarios', scenarioController);
  app.decorate('adapters', adapters);

  registerAuthRoutes(app, {
    service: new AuthService(db, tokens),
    audit,
    loginRateLimitMax: config.rateLimitLoginMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
  registerMemberRoutes(app, new MemberRepository(db), guard);
  registerAuditRoutes(app, db);
  // With no key configured the null provider declines every call, and everything that does not
  // need a model keeps working.
  const aiProvider: AIProvider =
    provider ??
    (config.geminiApiKey === undefined
      ? new NullProvider()
      : new GeminiProvider(config.geminiApiKey));

  registerEligibilityRoutes(app, {
    db,
    benefits,
    adapters,
    audit,
    auditRecorder: audit,
    guard,
  });
  registerGuidanceRoutes(app, {
    db,
    benefits,
    adapters,
    audit,
    guard,
    provider: aiProvider,
    rateLimitMax: config.rateLimitGuidanceMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });

  return app;
}
