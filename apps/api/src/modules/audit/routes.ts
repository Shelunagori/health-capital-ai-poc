import type { FastifyInstance } from 'fastify';
import { AuditEventQuerySchema } from '@health-capital/contracts';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { requirePrincipal } from '../auth/index.js';
import { Action, authorize, forbidden } from '../authorization/index.js';
import { toSupportAuditEventDto, type AuditEventRow } from './dto.js';

/**
 * The support view of the audit trail. Support only, and never raw rows: every response goes
 * through the allowlist mapper, so the trail cannot be used to read the data it describes.
 */
export function registerAuditRoutes(app: FastifyInstance, db: Db): void {
  app.get('/audit/events', async (request) => {
    const principal = requirePrincipal(request);
    if (!authorize(principal, Action.READ_AUDIT_EVENTS, { kind: 'AUDIT' }).allowed)
      throw forbidden();

    const parsed = AuditEventQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Unsupported audit filter');
    const { traceId, action, outcome, actorRole, limit } = parsed.data;

    const rows: AuditEventRow[] = await db.auditEvent.findMany({
      where: {
        ...(traceId === undefined ? {} : { traceId }),
        ...(action === undefined ? {} : { action: action as never }),
        ...(outcome === undefined ? {} : { outcome }),
        ...(actorRole === undefined ? {} : { actorRole }),
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      // Selected explicitly: `resourceId` is deliberately not read, so it cannot reach a response.
      select: {
        id: true,
        occurredAt: true,
        traceId: true,
        actorUserId: true,
        actorRole: true,
        action: true,
        outcome: true,
        resourceType: true,
        engineVersion: true,
        planConfigVersion: true,
        aiProvider: true,
        aiModel: true,
        promptTemplateId: true,
        promptVersion: true,
        reasonCode: true,
        caseRef: true,
        metadata: true,
      },
    });

    return { events: rows.map(toSupportAuditEventDto), count: rows.length };
  });
}
