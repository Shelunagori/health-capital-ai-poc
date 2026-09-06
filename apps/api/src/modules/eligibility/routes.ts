import type { FastifyInstance } from 'fastify';
import { EvaluateEligibilityRequestSchema } from '@health-capital/contracts';
import { AppError } from '../../platform/errors.js';
import { requirePrincipal } from '../auth/index.js';
import { Action, forbidden, type AccessGuard } from '../authorization/index.js';
import type { AuditRecorder } from '../audit/index.js';
import { auditedAdapters, type Adapters } from '../integrations/index.js';
import { templateExplanation } from './explanation.js';
import { EligibilityService } from './service.js';
import type { BenefitsService } from '../benefits/index.js';
import type { Db } from '../../platform/db.js';
import type { AuditService } from '../audit/index.js';

export interface EligibilityRouteOptions {
  db: Db;
  benefits: BenefitsService;
  adapters: Adapters;
  audit: AuditService;
  auditRecorder: AuditRecorder;
  guard: AccessGuard;
}

/**
 * The structured path to a decision: a member names a category, an amount and a date, and gets a
 * deterministic answer with the reasons behind it.
 *
 * This endpoint has no dependency on any AI provider. It is the whole product working without one.
 */
export function registerEligibilityRoutes(
  app: FastifyInstance,
  options: EligibilityRouteOptions,
): void {
  app.post('/me/eligibility/evaluate', async (request, reply) => {
    const principal = requirePrincipal(request);
    if (principal.memberId === null) throw forbidden();

    const parsed = EvaluateEligibilityRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Provide a treatment category, an amount in cents and a service date',
      );
    }

    const enrollments = await options.db.benefitEnrollment.findMany({
      where: { memberId: principal.memberId },
      select: { employerId: true },
    });

    await options.guard.require({
      traceId: request.id,
      principal,
      action: Action.EVALUATE_OWN_ELIGIBILITY,
      resource: {
        kind: 'MEMBER',
        memberId: principal.memberId,
        employerIds: enrollments.map((e) => e.employerId),
      },
      resourceId: principal.memberId,
    });

    const service = new EligibilityService(
      options.db,
      options.benefits,
      // Adapter calls are recorded against this request's trace, so an outage and the decision it
      // produced can be read together.
      auditedAdapters(options.adapters, options.auditRecorder, request.id),
      options.audit,
    );

    const { decision, result } = await service.evaluateAndStore({
      memberId: principal.memberId,
      treatmentCategory: parsed.data.treatmentCategory,
      expenseAmountCents: parsed.data.expenseAmountCents,
      serviceDate: new Date(parsed.data.serviceDate),
      traceId: request.id,
      actorUserId: principal.userId,
    });

    return reply.status(200).send({
      decision,
      // Written from the decision, so the wording can never disagree with the verdict.
      explanation: templateExplanation(result),
      explanationSource: 'template' as const,
    });
  });
}
