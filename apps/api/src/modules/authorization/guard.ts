import type { Principal } from '@health-capital/contracts';
import { AuditAction, AuditOutcome, type AuditRecorder } from '../audit/index.js';
import type { Action } from './actions.js';
import { authorize, forbidden, type AccessContext, type Resource } from './policy.js';

/**
 * Authorization with the audit trail attached.
 *
 * Handlers call this rather than the bare policy, so a refusal is always recorded and a support
 * caller reading someone else's data is always recorded. Auditing cannot be forgotten at a call
 * site, because it is not a separate step.
 */
export interface GuardContext {
  traceId: string;
  principal: Principal;
  action: Action;
  resource: Resource;
  access?: AccessContext;
  /** Identifier of the resource, stored for investigation and never shown in the audit viewer. */
  resourceId?: string | null;
}

export class AccessGuard {
  constructor(private readonly audit: AuditRecorder) {}

  /** Throws when the caller may not proceed. Returns whether the access was privileged. */
  async require(context: GuardContext): Promise<{ privileged: boolean }> {
    const decision = authorize(context.principal, context.action, context.resource, context.access);

    if (!decision.allowed) {
      await this.audit.record({
        action: AuditAction.AUTHZ_DENIED,
        outcome: AuditOutcome.DENY,
        traceId: context.traceId,
        actorUserId: context.principal.userId,
        actorRole: context.principal.role,
        resourceType: context.resource.kind,
        resourceId: context.resourceId ?? null,
        metadata: {
          attemptedAction: context.action,
          denialReason: decision.reason,
          resourceKind: context.resource.kind,
        },
      });
      throw forbidden();
    }

    if (decision.privileged) {
      await this.audit.record({
        action: AuditAction.PRIVILEGED_READ,
        outcome: AuditOutcome.ALLOW,
        traceId: context.traceId,
        actorUserId: context.principal.userId,
        actorRole: context.principal.role,
        resourceType: context.resource.kind,
        resourceId: context.resourceId ?? null,
        reasonCode: context.access?.reasonCode ?? null,
        caseRef: context.access?.caseRef ?? null,
        metadata: { attemptedAction: context.action, resourceKind: context.resource.kind },
      });
    }

    return { privileged: decision.privileged };
  }
}
