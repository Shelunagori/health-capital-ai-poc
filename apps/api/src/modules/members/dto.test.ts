import { describe, expect, it } from 'vitest';
import {
  EmployerMemberSummaryDtoSchema,
  MemberSelfDtoSchema,
  SupportMemberSummaryDtoSchema,
} from '@health-capital/contracts';
import { DataClass, classifyField } from '../classification/index.js';
import {
  toEmployerMemberSummaryDto,
  toMemberSelfDto,
  toSupportMemberSummaryDto,
  type EnrollmentRow,
  type MemberRow,
} from './dto.js';

const member: MemberRow = {
  id: '33333333-3333-4333-8333-000000000001',
  externalRef: 'MBR-001',
  firstName: 'Sarah',
  lastName: 'Thompson',
  dateOfBirth: new Date('1987-03-14'),
  addressLine: '14 Alder Street',
  city: 'Riverton',
  postalCode: '40218',
};

const enrollment: EnrollmentRow = {
  id: '44444444-4444-4444-8444-000000000001',
  employeeId: 'NS-1001',
  status: 'ACTIVE',
  effectiveFrom: new Date('2024-01-01'),
  effectiveTo: null,
  employer: { name: 'Northstar Industries' },
  plan: { name: 'Northstar Standard Health Capital' },
};

/** Field names the registry classifies as health or financial data, on any model. */
const SENSITIVE_NAMES = [
  'treatmentCategory',
  'benefitCategory',
  'serviceDate',
  'expenseAmountCents',
  'amountCents',
  'coveredAmountCents',
  'outcome',
  'reasons',
  'conditions',
  'inputsSnapshot',
];

describe('the employer view carries no health or financial data', () => {
  const dto = toEmployerMemberSummaryDto(member, enrollment);

  it('emits exactly the agreed fields', () => {
    expect(EmployerMemberSummaryDtoSchema.parse(dto)).toEqual(dto);
    expect(Object.keys(dto).sort()).toEqual([
      'effectiveFrom',
      'effectiveTo',
      'employeeId',
      'firstName',
      'lastName',
      'memberId',
      'planName',
      'status',
    ]);
  });

  it('contains no field the registry classifies as PHI or financial', () => {
    for (const key of Object.keys(dto)) {
      expect(SENSITIVE_NAMES, `employer view exposes ${key}`).not.toContain(key);
    }
    for (const name of SENSITIVE_NAMES) {
      expect(dto).not.toHaveProperty(name);
    }
  });

  it('omits the member address and date of birth', () => {
    for (const field of ['dateOfBirth', 'addressLine', 'city', 'postalCode'] as const) {
      expect(classifyField('Member', field)).toBe(DataClass.PII);
      expect(dto).not.toHaveProperty(field);
    }
  });

  it('never leaks the opaque member reference', () => {
    expect(dto).not.toHaveProperty('memberRef');
    expect(JSON.stringify(dto)).not.toContain('MBR-001');
  });
});

describe('the member view of themselves', () => {
  it('emits the profile and nothing else', () => {
    const dto = toMemberSelfDto(member);
    expect(MemberSelfDtoSchema.parse(dto)).toEqual(dto);
    expect(dto.dateOfBirth).toBe('1987-03-14');
    expect(dto).not.toHaveProperty('externalRef');
  });
});

describe('the support view', () => {
  it('adds the reference and employer to the summary, still with no health or financial data', () => {
    const dto = toSupportMemberSummaryDto(member, enrollment);
    expect(SupportMemberSummaryDtoSchema.parse(dto)).toEqual(dto);
    expect(dto.memberRef).toBe('MBR-001');
    for (const name of SENSITIVE_NAMES) expect(dto).not.toHaveProperty(name);
  });
});
