/**
 * Audit: an append-only record of who did what, when, and whether it was allowed.
 * The database refuses updates and deletes, so immutability does not rely on this code.
 */
export { AuditService, type AuditRecorder } from './service.js';
export {
  AuditAction,
  AuditOutcome,
  auditMetadataSchemas,
  type AuditEventInput,
  type AuditMetadata,
} from './events.js';
export { toSupportAuditEventDto, type AuditEventRow } from './dto.js';
export { registerAuditRoutes } from './routes.js';
