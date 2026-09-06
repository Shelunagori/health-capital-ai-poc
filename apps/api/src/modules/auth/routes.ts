import type { FastifyInstance } from 'fastify';
import { LoginRequestSchema } from '@health-capital/contracts';
import { AppError } from '../../platform/errors.js';
import { AuditAction, AuditOutcome, type AuditRecorder } from '../audit/index.js';
import type { AuthService } from './service.js';

export interface AuthRouteOptions {
  service: AuthService;
  audit: AuditRecorder;
  /** Requests per window for the login route, keyed by client address and submitted address. */
  loginRateLimitMax: number;
  rateLimitWindowMs: number;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  app.post(
    '/auth/login',
    {
      config: {
        public: true,
        rateLimit: {
          max: options.loginRateLimitMax,
          timeWindow: options.rateLimitWindowMs,
          // Runs after body parsing so the submitted address can be part of the key: this limits
          // attempts against a single account as well as attempts from a single client.
          hook: 'preHandler',
          keyGenerator: (request: { ip: string; body?: unknown }) => {
            const body = request.body;
            const email =
              typeof body === 'object' &&
              body !== null &&
              'email' in body &&
              typeof body.email === 'string'
                ? body.email.trim().toLowerCase()
                : '';
            return `login:${request.ip}:${email}`;
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        // Deliberately not reporting which field failed: the response is identical to a bad password.
        await options.audit.record({
          action: AuditAction.AUTH_LOGIN_FAILED,
          outcome: AuditOutcome.FAILURE,
          traceId: request.id,
          metadata: { reason: 'MALFORMED_REQUEST' },
        });
        throw new AppError('UNAUTHENTICATED', 'Invalid email or password');
      }

      let result;
      try {
        result = await options.service.login(parsed.data);
      } catch (err) {
        // The address that was tried is never recorded: an audit trail of attempted addresses
        // would itself be a list of who does and does not hold an account.
        await options.audit.record({
          action: AuditAction.AUTH_LOGIN_FAILED,
          outcome: AuditOutcome.FAILURE,
          traceId: request.id,
          metadata: { reason: 'INVALID_CREDENTIALS' },
        });
        throw err;
      }
      const { response, principal } = result;

      await options.audit.record({
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        outcome: AuditOutcome.SUCCESS,
        traceId: request.id,
        actorUserId: principal.userId,
        actorRole: principal.role,
        metadata: {},
      });

      request.log.info(
        {
          action: 'AUTH_LOGIN_SUCCEEDED',
          outcome: 'SUCCESS',
          userId: principal.userId,
          role: principal.role,
        },
        'login succeeded',
      );

      return reply.status(200).send(response);
    },
  );
}
