import { z } from 'zod';

/**
 * The closed catalogue of audited actions, and the shape of what may be recorded alongside each.
 *
 * Metadata is constrained on purpose. Every schema below is `.strict()` and admits only references,
 * enumerations, counts, versions and durations. Free text, prompts, tool results, member questions
 * and whole records have no way in, because there is no field that would accept them.
 */
export const AuditAction = {
  AUTH_LOGIN_SUCCEEDED: 'AUTH_LOGIN_SUCCEEDED',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  AUTHZ_DENIED: 'AUTHZ_DENIED',
  PRIVILEGED_READ: 'PRIVILEGED_READ',
  ELIGIBILITY_EVALUATED: 'ELIGIBILITY_EVALUATED',
  ADAPTER_CALLED: 'ADAPTER_CALLED',
  AI_CALL: 'AI_CALL',
  TOOL_CALL: 'TOOL_CALL',
  AI_GUARD_TRIGGERED: 'AI_GUARD_TRIGGERED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditOutcome = {
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;
export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome];

const attemptedAction = z.string().max(64);
const ruleRef = z.string().max(32);

/** Why a login failed, without saying anything about which address was tried. */
const loginFailureReason = z.enum(['INVALID_CREDENTIALS', 'MALFORMED_REQUEST']);

export const auditMetadataSchemas = {
  AUTH_LOGIN_SUCCEEDED: z.object({}).strict(),
  AUTH_LOGIN_FAILED: z.object({ reason: loginFailureReason }).strict(),
  AUTHZ_DENIED: z
    .object({
      attemptedAction,
      denialReason: z.string().max(64),
      resourceKind: z.string().max(32),
    })
    .strict(),
  PRIVILEGED_READ: z.object({ attemptedAction, resourceKind: z.string().max(32) }).strict(),
  ELIGIBILITY_EVALUATED: z
    .object({
      ruleRefs: z.array(ruleRef).max(32),
      inputsMissing: z.number().int().min(0).optional(),
    })
    .strict(),
  ADAPTER_CALLED: z
    .object({
      adapterName: z.string().max(64),
      result: z.string().max(32),
      latencyMs: z.number().int().min(0),
    })
    .strict(),
  AI_CALL: z
    .object({
      stage: z.enum(['A', 'B']),
      latencyMs: z.number().int().min(0),
      redactions: z
        .array(z.object({ kind: z.string().max(24), count: z.number().int().min(0) }))
        .max(16),
    })
    .strict(),
  TOOL_CALL: z
    .object({
      toolName: z.string().max(64),
      argumentsValid: z.boolean(),
      rounds: z.number().int().min(0),
    })
    .strict(),
  AI_GUARD_TRIGGERED: z.object({ guard: z.string().max(64) }).strict(),
} as const satisfies Record<AuditAction, z.ZodType>;

export type AuditMetadata = {
  [A in AuditAction]: z.infer<(typeof auditMetadataSchemas)[A]>;
};

/** One recordable event. `resourceId` is stored for investigation but never shown in the viewer. */
export interface AuditEventInput<A extends AuditAction = AuditAction> {
  action: A;
  outcome: AuditOutcome;
  traceId: string;
  actorUserId?: string | null;
  actorRole?: 'MEMBER' | 'EMPLOYER_ADMIN' | 'SUPPORT' | null;
  resourceType?: string | null;
  resourceId?: string | null;
  reasonCode?: string | null;
  caseRef?: string | null;
  engineVersion?: string | null;
  planConfigVersion?: number | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  promptTemplateId?: string | null;
  promptVersion?: string | null;
  metadata: AuditMetadata[A];
}
