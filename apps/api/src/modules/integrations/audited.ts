import { AuditAction, AuditOutcome, type AuditRecorder } from '../audit/index.js';
import type {
  Adapters,
  AdapterResult,
  AvailableBalance,
  BenefitsAdministratorAdapter,
  CardSystemAdapter,
  EmployerSystemAdapter,
  EnrollmentRecord,
  PlanConfiguration,
} from './types.js';

/**
 * Wraps each adapter so every call to an external system is recorded: which adapter, what the
 * result was, and how long it took. Never the payload, and never the reference that was looked up,
 * because an opaque reference is still a pointer at one person.
 */
async function recordCall<T>(
  audit: AuditRecorder,
  traceId: string,
  adapterName: string,
  call: () => Promise<AdapterResult<T>>,
): Promise<AdapterResult<T>> {
  const startedAt = Date.now();
  const result = await call();
  await audit.record({
    action: AuditAction.ADAPTER_CALLED,
    outcome: result.ok ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
    traceId,
    metadata: {
      adapterName,
      result: result.ok ? 'OK' : result.reason,
      latencyMs: Date.now() - startedAt,
    },
  });
  return result;
}

/**
 * Adapters bound to one request's trace, so an outage shows up on the same trace as the decision
 * it produced.
 */
export function auditedAdapters(
  adapters: Adapters,
  audit: AuditRecorder,
  traceId: string,
): Adapters {
  const employerSystem: EmployerSystemAdapter = {
    name: adapters.employerSystem.name,
    getEnrollment: (ref: string): Promise<AdapterResult<EnrollmentRecord>> =>
      recordCall(audit, traceId, adapters.employerSystem.name, () =>
        adapters.employerSystem.getEnrollment(ref),
      ),
  };

  const benefitsAdministrator: BenefitsAdministratorAdapter = {
    name: adapters.benefitsAdministrator.name,
    getPlanConfiguration: (ref: string): Promise<AdapterResult<PlanConfiguration>> =>
      recordCall(audit, traceId, adapters.benefitsAdministrator.name, () =>
        adapters.benefitsAdministrator.getPlanConfiguration(ref),
      ),
  };

  const cardSystem: CardSystemAdapter = {
    name: adapters.cardSystem.name,
    getAvailableBalance: (ref: string): Promise<AdapterResult<AvailableBalance>> =>
      recordCall(audit, traceId, adapters.cardSystem.name, () =>
        adapters.cardSystem.getAvailableBalance(ref),
      ),
  };

  return { employerSystem, benefitsAdministrator, cardSystem };
}
