import { describe, expect, it } from 'vitest';
import { DataClass, classifyField, fieldClassification, fieldNamesWithClass } from './registry.js';
import { readPrismaModelNames, readPrismaScalarFields } from './prisma-schema.js';

describe('classification drift guard', () => {
  const schemaFields = readPrismaScalarFields();

  it('reads the schema it is guarding', () => {
    // A parser that silently returns nothing would make every other assertion here vacuous.
    expect(schemaFields.length).toBeGreaterThan(50);
    expect(readPrismaModelNames()).toContain('EligibilityDecision');
  });

  it('classifies every persisted field in schema.prisma', () => {
    const unclassified = schemaFields
      .filter(({ model, field }) => classifyField(model, field) === undefined)
      .map(({ model, field }) => `${model}.${field}`);

    expect(
      unclassified,
      'Add these fields to modules/classification/registry.ts before persisting them.',
    ).toEqual([]);
  });

  it('has no registry entries for fields that no longer exist', () => {
    const inSchema = new Set(schemaFields.map(({ model, field }) => `${model}.${field}`));
    const stale = Object.entries(fieldClassification).flatMap(([model, fields]) =>
      Object.keys(fields)
        .map((field) => `${model}.${field}`)
        .filter((key) => !inSchema.has(key)),
    );

    expect(stale, 'Remove these stale entries from the classification registry.').toEqual([]);
  });

  it('covers every model in the schema', () => {
    const registryModels = new Set(Object.keys(fieldClassification));
    const missing = readPrismaModelNames().filter((model) => !registryModels.has(model));
    expect(missing).toEqual([]);
  });
});

describe('classification decisions', () => {
  it('treats credentials as SECRET', () => {
    expect(classifyField('User', 'passwordHash')).toBe(DataClass.SECRET);
  });

  it('treats identity and contact data as PII', () => {
    expect(classifyField('User', 'email')).toBe(DataClass.PII);
    expect(classifyField('Member', 'firstName')).toBe(DataClass.PII);
    expect(classifyField('Member', 'lastName')).toBe(DataClass.PII);
    expect(classifyField('Member', 'dateOfBirth')).toBe(DataClass.PII);
    expect(classifyField('Member', 'addressLine')).toBe(DataClass.PII);
    expect(classifyField('Member', 'city')).toBe(DataClass.PII);
    expect(classifyField('Member', 'postalCode')).toBe(DataClass.PII);
    expect(classifyField('BenefitEnrollment', 'employeeId')).toBe(DataClass.PII);
  });

  it('treats care and decision data as PHI', () => {
    expect(classifyField('CareRequest', 'treatmentCategory')).toBe(DataClass.PHI);
    expect(classifyField('CareRequest', 'serviceDate')).toBe(DataClass.PHI);
    expect(classifyField('LedgerEntry', 'benefitCategory')).toBe(DataClass.PHI);
    expect(classifyField('EligibilityDecision', 'outcome')).toBe(DataClass.PHI);
    expect(classifyField('EligibilityDecision', 'reasons')).toBe(DataClass.PHI);
    expect(classifyField('EligibilityDecision', 'conditions')).toBe(DataClass.PHI);
    // Minimized for the AI boundary, but still health-related data at rest.
    expect(classifyField('EligibilityDecision', 'inputsSnapshot')).toBe(DataClass.PHI);
  });

  it('treats amounts as FIN', () => {
    expect(classifyField('CareRequest', 'expenseAmountCents')).toBe(DataClass.FIN);
    expect(classifyField('LedgerEntry', 'amountCents')).toBe(DataClass.FIN);
    expect(classifyField('EligibilityDecision', 'coveredAmountCents')).toBe(DataClass.FIN);
  });

  it('treats opaque external references as INTERNAL, never PII', () => {
    expect(classifyField('BenefitEnrollment', 'enrollmentExternalRef')).toBe(DataClass.INTERNAL);
    expect(classifyField('Member', 'externalRef')).toBe(DataClass.INTERNAL);
    expect(classifyField('Plan', 'planExternalRef')).toBe(DataClass.INTERNAL);
    expect(classifyField('HealthCapitalAccount', 'cardExternalRef')).toBe(DataClass.INTERNAL);
  });

  it('returns undefined for unknown models and fields', () => {
    expect(classifyField('NoSuchModel', 'id')).toBeUndefined();
    expect(classifyField('Member', 'noSuchField')).toBeUndefined();
  });

  it('lists distinct sensitive field names', () => {
    const names = fieldNamesWithClass([DataClass.SECRET]);
    expect(names).toEqual(['passwordHash']);
    expect(fieldNamesWithClass([DataClass.PII])).toContain('employeeId');
  });
});

describe('schema shape guarantees', () => {
  const schemaFields = readPrismaScalarFields();
  const fieldsOf = (model: string): string[] =>
    schemaFields.filter((f) => f.model === model).map((f) => f.field);

  it('does not persist a provider name on care requests', () => {
    // No deterministic rule consumes provider identity, so storing it would breach minimization.
    expect(fieldsOf('CareRequest')).not.toContain('providerName');
    expect(schemaFields.map((f) => f.field)).not.toContain('providerName');
  });

  it('keeps employer and plan links on the enrollment, not on the portable member', () => {
    const memberFields = fieldsOf('Member');
    expect(memberFields).not.toContain('employerId');
    expect(memberFields).not.toContain('planId');
    // Email belongs to the login identity, not the person record.
    expect(memberFields).not.toContain('email');
    expect(fieldsOf('BenefitEnrollment')).toEqual(
      expect.arrayContaining(['employerId', 'planId', 'status', 'effectiveFrom', 'effectiveTo']),
    );
  });

  it('gives the enrollment an opaque reference for the employer system adapter', () => {
    const field = schemaFields.find(
      (f) => f.model === 'BenefitEnrollment' && f.field === 'enrollmentExternalRef',
    );
    expect(field).toBeDefined();
    expect(field?.type).toBe('String');
    expect(field?.isOptional).toBe(false);
  });

  it('uses one shared category vocabulary for care requests and ledger entries', () => {
    const treatment = schemaFields.find(
      (f) => f.model === 'CareRequest' && f.field === 'treatmentCategory',
    );
    const spend = schemaFields.find(
      (f) => f.model === 'LedgerEntry' && f.field === 'benefitCategory',
    );
    expect(treatment?.type).toBe('BenefitCategory');
    expect(spend?.type).toBe('BenefitCategory');
  });

  it('records both the rule engine version and the plan configuration version on a decision', () => {
    expect(fieldsOf('EligibilityDecision')).toEqual(
      expect.arrayContaining(['engineVersion', 'planConfigVersion', 'inputsSnapshot', 'decidedBy']),
    );
  });

  it('keeps free text out of the audit event shape', () => {
    const auditFields = fieldsOf('AuditEvent');
    expect(auditFields).toContain('reasonCode');
    expect(auditFields).toContain('caseRef');
    expect(auditFields).not.toContain('justification');
    expect(auditFields).not.toContain('promptHash');
    expect(auditFields).not.toContain('questionHash');
  });
});
