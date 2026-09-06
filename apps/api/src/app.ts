import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppConfig } from './platform/config.js';
import { registerSecurity } from './platform/http/security.js';
import { registerErrorHandler } from './platform/http/error-handler.js';
import { registerHealth } from './platform/http/health.js';

export interface BuildAppOptions {
  config: AppConfig;
  /** Any pino-compatible logger; main.ts passes the instance from createLogger(). */
  logger: FastifyBaseLogger;
}

/**
 * Wires platform plugins and (from M1 onward) domain modules. Used by main.ts and by tests.
 * The returned instance is not yet `ready()`; callers may add routes before listening/injecting.
 */
export async function buildApp({ config, logger }: BuildAppOptions): Promise<FastifyInstance> {
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
  registerErrorHandler(app);
  registerHealth(app, config);

  return app;
}
