import type { FastifyInstance } from 'fastify';
import { AskGuidanceRequestSchema } from '@health-capital/contracts';
import { AppError } from '../../platform/errors.js';
import { requirePrincipal } from '../auth/index.js';
import { Action, forbidden, type AccessGuard } from '../authorization/index.js';
import type { AuditService } from '../audit/index.js';
import type { AIProvider } from '../ai/index.js';
import type { BenefitsService } from '../benefits/index.js';
import { EligibilityService } from '../eligibility/index.js';
import { auditedAdapters, type Adapters } from '../integrations/index.js';
import type { Db } from '../../platform/db.js';
import { GuidanceService } from './service.js';
import { ToolExecutor } from './tools.js';

/** Stands in for a caller who holds no member reference. Never matched: such a caller is refused on role. */
const UNASSIGNED_MEMBER = '00000000-0000-0000-0000-000000000000';

export interface GuidanceRouteOptions {
  db: Db;
  benefits: BenefitsService;
  adapters: Adapters;
  audit: AuditService;
  guard: AccessGuard;
  provider: AIProvider;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

/**
 * Natural-language guidance, for members only.
 *
 * The question is read, used, and dropped. It is not written to the database, not put in an audit
 * event, and not logged. No hash of it is kept either, because a hash of someone's words is still
 * derived from their words.
 */
export function registerGuidanceRoutes(app: FastifyInstance, options: GuidanceRouteOptions): void {
  app.post(
    '/me/guidance/ask',
    {
      config: {
        rateLimit: { max: options.rateLimitMax, timeWindow: options.rateLimitWindowMs },
      },
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);

      const parsed = AskGuidanceRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Provide a question');

      const enrollments =
        principal.memberId === null
          ? []
          : await options.db.benefitEnrollment.findMany({
              where: { memberId: principal.memberId },
              select: { employerId: true, employeeId: true },
            });

      // Authorization runs before any short-circuit, so a refusal is always recorded. A caller with
      // no member reference is refused on role, so the placeholder identifier is never compared.
      await options.guard.require({
        traceId: request.id,
        principal,
        action: Action.ASK_GUIDANCE,
        resource: {
          kind: 'MEMBER',
          memberId: principal.memberId ?? UNASSIGNED_MEMBER,
          employerIds: enrollments.map((e) => e.employerId),
        },
        resourceId: principal.memberId,
      });

      if (principal.memberId === null) throw forbidden();

      // The caller's own stored values, so the sanitizer can remove them from the question by exact
      // match as well as by pattern.
      const member = await options.db.member.findUnique({
        where: { id: principal.memberId },
        select: {
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          addressLine: true,
          city: true,
          postalCode: true,
          externalRef: true,
        },
      });
      const user = await options.db.user.findUnique({
        where: { id: principal.userId },
        select: { email: true },
      });

      const service = new GuidanceService({
        provider: options.provider,
        audit: options.audit,
        executor: new ToolExecutor({
          db: options.db,
          benefits: options.benefits,
          eligibility: new EligibilityService(
            options.db,
            options.benefits,
            auditedAdapters(options.adapters, options.audit, request.id),
            options.audit,
          ),
          audit: options.audit,
        }),
      });

      const response = await service.ask({
        principal,
        traceId: request.id,
        question: parsed.data.question,
        profile: {
          firstName: member?.firstName,
          lastName: member?.lastName,
          dateOfBirth: member?.dateOfBirth,
          addressLine: member?.addressLine,
          city: member?.city,
          postalCode: member?.postalCode,
          memberExternalRef: member?.externalRef,
          email: user?.email,
          employeeId: enrollments[0]?.employeeId,
        },
      });

      return reply.status(200).send(response);
    },
  );
}
