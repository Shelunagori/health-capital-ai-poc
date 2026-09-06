import { z } from 'zod';
import { RoleSchema } from './auth.js';

/**
 * The support view of one audit event.
 *
 * This is an allowlist, not a filtered row. Raw audit records are never returned. Specifically
 * absent: the resource identifier, every monetary amount, every treatment category and every
 * eligibility outcome. The viewer answers "who did what, when, and was it allowed", which is what
 * an operational trail is for. Anything more is a privileged read of the underlying data, with its
 * own reason code and case reference.
 */
export const AuditEventDetailsSchema = z
  .object({
    ruleRefs: z.array(z.string()).optional(),
    toolName: z.string().optional(),
    adapterName: z.string().optional(),
    adapterResult: z.string().optional(),
    latencyMs: z.number().int().optional(),
    redactionCounts: z.array(z.object({ kind: z.string(), count: z.number().int() })).optional(),
    deniedAction: z.string().optional(),
    denialReason: z.string().optional(),
    resourceKind: z.string().optional(),
    stage: z.string().optional(),
    guard: z.string().optional(),
    loginFailureReason: z.string().optional(),
  })
  .strict();
export type AuditEventDetails = z.infer<typeof AuditEventDetailsSchema>;

export const SupportAuditEventDtoSchema = z
  .object({
    id: z.string().uuid(),
    occurredAt: z.string(),
    traceId: z.string(),
    actorUserId: z.string().uuid().nullable(),
    actorRole: RoleSchema.nullable(),
    action: z.string(),
    outcome: z.enum(['ALLOW', 'DENY', 'SUCCESS', 'FAILURE']),
    resourceType: z.string().nullable(),
    engineVersion: z.string().nullable(),
    planConfigVersion: z.number().int().nullable(),
    aiProvider: z.string().nullable(),
    aiModel: z.string().nullable(),
    promptTemplateId: z.string().nullable(),
    promptVersion: z.string().nullable(),
    reasonCode: z.string().nullable(),
    caseRef: z.string().nullable(),
    details: AuditEventDetailsSchema,
  })
  .strict();
export type SupportAuditEventDto = z.infer<typeof SupportAuditEventDtoSchema>;

export const AuditEventQuerySchema = z
  .object({
    traceId: z.string().max(64).optional(),
    action: z.string().max(64).optional(),
    outcome: z.enum(['ALLOW', 'DENY', 'SUCCESS', 'FAILURE']).optional(),
    actorRole: RoleSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type AuditEventQuery = z.infer<typeof AuditEventQuerySchema>;

export const AuditEventPageSchema = z
  .object({ events: z.array(SupportAuditEventDtoSchema), count: z.number().int() })
  .strict();
export type AuditEventPage = z.infer<typeof AuditEventPageSchema>;
