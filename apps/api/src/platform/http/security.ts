import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import type { AppConfig } from '../config.js';

/**
 * Baseline HTTP security controls that ship with the very first endpoint:
 * security headers, strict CORS allowlist, and no-store caching for every response.
 * The JSON body limit is applied at Fastify construction (see app.ts).
 */
export async function registerSecurity(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(helmet, {
    // The API serves JSON only; a restrictive CSP is still a useful default.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  const allowed = new Set(config.corsAllowedOrigins);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients send no Origin header; they are not subject to CORS.
      if (origin === undefined) {
        cb(null, false);
        return;
      }
      cb(null, allowed.has(origin));
    },
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['x-trace-id'],
    maxAge: 600,
  });

  // Responses may contain member data; never let a browser or proxy cache them.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
  });
}
