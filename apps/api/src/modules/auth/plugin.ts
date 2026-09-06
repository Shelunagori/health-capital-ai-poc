import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Principal } from '@health-capital/contracts';
import { AppError } from '../../platform/errors.js';
import { bearerToken, type TokenSigner } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated caller. Never populated from request input, only from a verified token. */
    principal: Principal | null;
  }
  interface FastifyContextConfig {
    /** Marks a route as reachable without authentication. Everything else is default-deny. */
    public?: boolean;
  }
}

/**
 * Authentication is default-deny: every route requires a valid bearer token unless it opts out
 * with `config: { public: true }`. A new route is therefore protected unless someone deliberately
 * says otherwise, rather than protected only if someone remembers to add a guard.
 */
export function registerAuthentication(app: FastifyInstance, tokens: TokenSigner): void {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // No route matched: let the not-found handler answer rather than reporting an auth failure.
    if (request.routeOptions.url === undefined) return;
    if (request.routeOptions.config.public === true) return;

    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    }

    try {
      request.principal = await tokens.verify(token);
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token');
    }
  });
}

/**
 * The authenticated caller for a handler. Throws rather than returning null so a handler can never
 * silently proceed unauthenticated.
 */
export function requirePrincipal(request: FastifyRequest): Principal {
  if (request.principal === null) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return request.principal;
}
