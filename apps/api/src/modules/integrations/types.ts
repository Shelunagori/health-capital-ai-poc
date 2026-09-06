/**
 * External systems are unreliable by contract.
 *
 * Adapters never throw and never return a partial answer dressed as a whole one. They return one of
 * these results, and the caller decides what an unanswered question means. This is what keeps a
 * confirmed "no" distinguishable from "we could not find out", which is the difference between an
 * ineligible decision and an undetermined one.
 */
export const AdapterFailure = {
  /** The system answered, and the thing genuinely does not exist. An authoritative negative. */
  NOT_FOUND: 'NOT_FOUND',
  /** The system could not be reached. */
  UNAVAILABLE: 'UNAVAILABLE',
  /** The system did not answer in time. */
  TIMEOUT: 'TIMEOUT',
  /** The system answered from data too old to rely on. */
  STALE: 'STALE',
  /** The system's answer contradicts what we hold. */
  CONFLICT: 'CONFLICT',
} as const;
export type AdapterFailure = (typeof AdapterFailure)[keyof typeof AdapterFailure];

export type AdapterResult<T> =
  | { ok: true; data: T; asOf: Date; source: string }
  | { ok: false; reason: AdapterFailure; source: string };

export const adapterOk = <T>(data: T, asOf: Date, source: string): AdapterResult<T> => ({
  ok: true,
  data,
  asOf,
  source,
});

export const adapterFailed = <T>(reason: AdapterFailure, source: string): AdapterResult<T> => ({
  ok: false,
  reason,
  source,
});

/** Enrollment status as the employer's system reports it. */
export interface EnrollmentRecord {
  status: 'PENDING' | 'ACTIVE' | 'TERMINATED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface PlanConfiguration {
  planConfigVersion: number;
  coverageRules: unknown;
}

export interface AvailableBalance {
  availableCents: number;
}

/**
 * Confirms one specific enrollment. Enrollment-scoped, never member-scoped: a member is portable
 * across employers, so asking "is this person enrolled" has no single answer.
 */
export interface EmployerSystemAdapter {
  readonly name: string;
  getEnrollment(enrollmentExternalRef: string): Promise<AdapterResult<EnrollmentRecord>>;
}

export interface BenefitsAdministratorAdapter {
  readonly name: string;
  getPlanConfiguration(planExternalRef: string): Promise<AdapterResult<PlanConfiguration>>;
}

export interface CardSystemAdapter {
  readonly name: string;
  getAvailableBalance(cardExternalRef: string): Promise<AdapterResult<AvailableBalance>>;
}

export interface Adapters {
  employerSystem: EmployerSystemAdapter;
  benefitsAdministrator: BenefitsAdministratorAdapter;
  cardSystem: CardSystemAdapter;
}
