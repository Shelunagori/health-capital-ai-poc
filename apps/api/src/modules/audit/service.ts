import type { FastifyBaseLogger } from 'fastify';
import { redactByClass } from '../classification/index.js';
import type { Db } from '../../platform/db.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { auditMetadataSchemas, type AuditAction, type AuditEventInput } from './events.js';

/**
 * Writes audit events.
 *
 * Two guarantees. Metadata is validated against the schema for its action before it is written, so
 * a field nobody agreed to cannot appear in the trail. It then passes through classification-based
 * redaction, so a value that slipped through under a sensitive field name is replaced rather than
 * stored.
 *
 * Writes are awaited rather than queued: for a proof of concept, an event that is worth recording
 * is worth recording before the response is sent.
 */
/** The slice of the client an audit write needs, so a transaction can be passed in as easily as the pool. */
export type AuditDb = Pick<Db, 'auditEvent'>;

export class AuditService {
  constructor(
    private readonly db: AuditDb,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * A recorder bound to a transaction, so a domain write and its audit event commit or fail
   * together. Without this an audit row could survive a rolled-back decision, or the reverse.
   */
  withClient(client: AuditDb): AuditService {
    return new AuditService(client, this.logger);
  }

  async record<A extends AuditAction>(event: AuditEventInput<A>): Promise<void> {
    const schema = auditMetadataSchemas[event.action];
    const parsed = schema.safeParse(event.metadata);
    if (!parsed.success) {
      // Refuse to store a shape nobody agreed to, and say so without echoing the offending value.
      this.logger.error(
        { action: event.action, outcome: 'FAILURE', code: 'AUDIT_METADATA_REJECTED' },
        'audit metadata did not match its schema',
      );
      return;
    }

    // Redaction returns a plain JSON-shaped object; Prisma's JSON input type needs it stated.
    const metadata = redactByClass(parsed.data) as Prisma.InputJsonValue;

    try {
      await this.db.auditEvent.create({
        data: {
          traceId: event.traceId,
          action: event.action,
          outcome: event.outcome,
          actorUserId: event.actorUserId ?? null,
          actorRole: event.actorRole ?? null,
          resourceType: event.resourceType ?? null,
          resourceId: event.resourceId ?? null,
          reasonCode: (event.reasonCode ?? null) as never,
          caseRef: event.caseRef ?? null,
          engineVersion: event.engineVersion ?? null,
          planConfigVersion: event.planConfigVersion ?? null,
          aiProvider: event.aiProvider ?? null,
          aiModel: event.aiModel ?? null,
          promptTemplateId: event.promptTemplateId ?? null,
          promptVersion: event.promptVersion ?? null,
          metadata,
        },
      });
    } catch {
      // A failed audit write must not turn a refusal into a server error, and must not be silent.
      this.logger.error(
        {
          traceId: event.traceId,
          action: event.action,
          outcome: 'FAILURE',
          code: 'AUDIT_WRITE_FAILED',
        },
        'audit event could not be written',
      );
    }
  }
}

/** The narrow surface other modules depend on, so nothing needs the whole service to record. */
export interface AuditRecorder {
  record<A extends AuditAction>(event: AuditEventInput<A>): Promise<void>;
}
