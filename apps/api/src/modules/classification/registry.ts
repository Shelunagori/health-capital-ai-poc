/**
 * Field-level data classification.
 *
 * This registry is the single source of truth for how sensitive each persisted field is. It is
 * consumed by logger redaction, audit metadata redaction, role DTO checks and the AI minimizer.
 * A test fails when a field in `schema.prisma` has no entry here, so classification cannot be
 * skipped when the schema grows.
 *
 * Classifications are not weakened because the data is synthetic: the point of the POC is to show
 * the handling that real regulated data would require.
 */
export const DataClass = {
  /** Identifies a person: name, date of birth, address, payroll or contact identifiers. */
  PII: 'PII',
  /** Health-related: treatment category, service dates, decisions and their inputs. */
  PHI: 'PHI',
  /** Money attached to a person: balances, contributions, spend, covered amounts. */
  FIN: 'FIN',
  /** Credentials and signing material. Never logged, never returned, never reversible. */
  SECRET: 'SECRET',
  /** Operational data: surrogate keys, opaque external refs, versions, timestamps, enums. */
  INTERNAL: 'INTERNAL',
  /** Safe to disclose without restriction. */
  PUBLIC: 'PUBLIC',
} as const;

export type DataClass = (typeof DataClass)[keyof typeof DataClass];

const { PII, PHI, FIN, SECRET, INTERNAL } = DataClass;

export type FieldClassification = Readonly<Record<string, Readonly<Record<string, DataClass>>>>;

export const fieldClassification = {
  Employer: {
    id: INTERNAL,
    // Business-confidential rather than personal, but not public either.
    name: INTERNAL,
    externalRef: INTERNAL,
    createdAt: INTERNAL,
  },
  Plan: {
    id: INTERNAL,
    employerId: INTERNAL,
    name: INTERNAL,
    planYearStart: INTERNAL,
    planYearEnd: INTERNAL,
    coverageRules: INTERNAL,
    planConfigVersion: INTERNAL,
    planConfigAsOf: INTERNAL,
    planExternalRef: INTERNAL,
    createdAt: INTERNAL,
  },
  Member: {
    id: INTERNAL,
    // Opaque surrogate used toward synthetic external systems; never reaches an AI provider.
    externalRef: INTERNAL,
    firstName: PII,
    lastName: PII,
    dateOfBirth: PII,
    addressLine: PII,
    city: PII,
    postalCode: PII,
    createdAt: INTERNAL,
  },
  BenefitEnrollment: {
    id: INTERNAL,
    memberId: INTERNAL,
    employerId: INTERNAL,
    planId: INTERNAL,
    // Employer-scoped payroll identifier: identifies a person within an organisation.
    employeeId: PII,
    status: INTERNAL,
    effectiveFrom: INTERNAL,
    effectiveTo: INTERNAL,
    enrollmentExternalRef: INTERNAL,
    sourceAsOf: INTERNAL,
    createdAt: INTERNAL,
  },
  HealthCapitalAccount: {
    id: INTERNAL,
    enrollmentId: INTERNAL,
    currency: INTERNAL,
    cardExternalRef: INTERNAL,
    createdAt: INTERNAL,
  },
  LedgerEntry: {
    id: INTERNAL,
    accountId: INTERNAL,
    type: INTERNAL,
    amountCents: FIN,
    occurredAt: FIN,
    // Category spend reveals the kind of care received.
    benefitCategory: PHI,
    careRequestId: INTERNAL,
    // Operational label only. Member free text must never be copied here.
    description: INTERNAL,
    createdAt: INTERNAL,
  },
  User: {
    id: INTERNAL,
    email: PII,
    passwordHash: SECRET,
    role: INTERNAL,
    memberId: INTERNAL,
    employerId: INTERNAL,
    createdAt: INTERNAL,
  },
  CareRequest: {
    id: INTERNAL,
    memberId: INTERNAL,
    enrollmentId: INTERNAL,
    treatmentCategory: PHI,
    expenseAmountCents: FIN,
    // When care was received is health information, not just a timestamp.
    serviceDate: PHI,
    createdAt: INTERNAL,
  },
  EligibilityDecision: {
    id: INTERNAL,
    careRequestId: INTERNAL,
    memberId: INTERNAL,
    enrollmentId: INTERNAL,
    // A determination about a specific treatment for a specific person.
    outcome: PHI,
    coveredAmountCents: FIN,
    reasons: PHI,
    conditions: PHI,
    engineVersion: INTERNAL,
    planConfigVersion: INTERNAL,
    // Minimized, but still carries category, amounts and dates.
    inputsSnapshot: PHI,
    decidedBy: INTERNAL,
    evaluatedAt: INTERNAL,
  },
  AuditEvent: {
    id: INTERNAL,
    occurredAt: INTERNAL,
    traceId: INTERNAL,
    actorUserId: INTERNAL,
    actorRole: INTERNAL,
    action: INTERNAL,
    resourceType: INTERNAL,
    resourceId: INTERNAL,
    outcome: INTERNAL,
    engineVersion: INTERNAL,
    planConfigVersion: INTERNAL,
    aiProvider: INTERNAL,
    aiModel: INTERNAL,
    promptTemplateId: INTERNAL,
    promptVersion: INTERNAL,
    reasonCode: INTERNAL,
    caseRef: INTERNAL,
    // Constrained per-action shapes, redacted before write. Never free text or full records.
    metadata: INTERNAL,
  },
} as const satisfies FieldClassification;

export type ClassifiedModelName = keyof typeof fieldClassification;

/** Classification of one field, or undefined when the field is not in the registry. */
export function classifyField(model: string, field: string): DataClass | undefined {
  const modelFields: Readonly<Record<string, DataClass>> | undefined = (
    fieldClassification as FieldClassification
  )[model];
  return modelFields?.[field];
}

/**
 * Distinct field names carrying any of the given classes, across all models.
 * Used to derive defence-in-depth logger redaction paths.
 */
export function fieldNamesWithClass(classes: readonly DataClass[]): string[] {
  const wanted = new Set<DataClass>(classes);
  const names = new Set<string>();
  for (const fields of Object.values(fieldClassification as FieldClassification)) {
    for (const [field, dataClass] of Object.entries(fields)) {
      if (wanted.has(dataClass)) names.add(field);
    }
  }
  return [...names].sort();
}
