import type { AuditEventDetails, SupportAuditEventDto } from '@health-capital/contracts';

/**
 * Maps a stored audit row to the support view.
 *
 * The mapping is an allowlist in both directions: named columns, and named keys lifted out of
 * metadata. A new metadata field is invisible in the viewer until somebody adds it here, which is
 * what stops the trail becoming a side channel onto the data it describes.
 */
export interface AuditEventRow {
  id: string;
  occurredAt: Date;
  traceId: string;
  actorUserId: string | null;
  actorRole: 'MEMBER' | 'EMPLOYER_ADMIN' | 'SUPPORT' | null;
  action: string;
  outcome: 'ALLOW' | 'DENY' | 'SUCCESS' | 'FAILURE';
  resourceType: string | null;
  engineVersion: string | null;
  planConfigVersion: number | null;
  aiProvider: string | null;
  aiModel: string | null;
  promptTemplateId: string | null;
  promptVersion: string | null;
  reasonCode: string | null;
  caseRef: string | null;
  metadata: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const asInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;

function toDetails(metadata: unknown): AuditEventDetails {
  if (typeof metadata !== 'object' || metadata === null) return {};
  const source = metadata as Record<string, unknown>;

  const details: AuditEventDetails = {};
  const ruleRefs = source['ruleRefs'];
  if (Array.isArray(ruleRefs)) {
    details.ruleRefs = ruleRefs.filter((r): r is string => typeof r === 'string');
  }
  const redactions = source['redactions'];
  if (Array.isArray(redactions)) {
    details.redactionCounts = redactions.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const kind = asString(record['kind']);
      const count = asInt(record['count']);
      return kind !== undefined && count !== undefined ? [{ kind, count }] : [];
    });
  }

  const direct: [keyof AuditEventDetails, unknown][] = [
    ['toolName', asString(source['toolName'])],
    ['adapterName', asString(source['adapterName'])],
    ['adapterResult', asString(source['result'])],
    ['latencyMs', asInt(source['latencyMs'])],
    ['deniedAction', asString(source['attemptedAction'])],
    ['denialReason', asString(source['denialReason'])],
    ['resourceKind', asString(source['resourceKind'])],
    ['stage', asString(source['stage'])],
    ['guard', asString(source['guard'])],
    ['loginFailureReason', asString(source['reason'])],
  ];
  for (const [key, value] of direct) {
    if (value !== undefined) Object.assign(details, { [key]: value });
  }
  return details;
}

export function toSupportAuditEventDto(row: AuditEventRow): SupportAuditEventDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    traceId: row.traceId,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    action: row.action,
    outcome: row.outcome,
    resourceType: row.resourceType,
    engineVersion: row.engineVersion,
    planConfigVersion: row.planConfigVersion,
    aiProvider: row.aiProvider,
    aiModel: row.aiModel,
    promptTemplateId: row.promptTemplateId,
    promptVersion: row.promptVersion,
    reasonCode: row.reasonCode,
    caseRef: row.caseRef,
    details: toDetails(row.metadata),
  };
}
