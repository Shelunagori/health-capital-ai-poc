/**
 * Deterministic synthetic seed data.
 *
 * Everything here is fictional and company-neutral: invented employer names, invented people,
 * `example.test` email addresses and neutral opaque references. No real customer, employee,
 * partner, company, product or domain names, and no real health, identity or financial data.
 *
 * Identifiers are fixed so re-seeding produces the same database and tests can rely on it.
 * Passwords are never in this file: the seed script reads one from the environment and stores
 * only its Argon2id hash.
 */

export const EXTERNAL_REF_PATTERNS = {
  employer: /^EMP-\d{3}$/,
  plan: /^PLAN-\d{3}$/,
  member: /^MBR-\d{3}$/,
  enrollment: /^ENR-\d{3}$/,
  card: /^CARD-\d{3}$/,
} as const;

export const SEED_EMAIL_DOMAIN = 'example.test';

export type Substantiation = 'NONE' | 'RECEIPT_REQUIRED';

/** Mirrors the BenefitCategory enum in schema.prisma. A test asserts the two stay in step. */
export type BenefitCategoryName =
  | 'PHYSICAL_THERAPY'
  | 'DENTAL'
  | 'VISION'
  | 'MENTAL_HEALTH'
  | 'PRESCRIPTION'
  | 'COSMETIC'
  | 'GYM_MEMBERSHIP'
  | 'OTHER';

export interface CoverageRule {
  category: BenefitCategoryName;
  covered: boolean;
  annualLimitCents: number | null;
  substantiation: Substantiation;
  ruleRef: string;
}

export interface SeedEmployer {
  id: string;
  name: string;
  externalRef: string;
}

export interface SeedPlan {
  id: string;
  employerId: string;
  name: string;
  planYearStart: string;
  planYearEnd: string;
  coverageRules: CoverageRule[];
  planConfigVersion: number;
  planConfigAsOf: string;
  planExternalRef: string;
}

export interface SeedMember {
  id: string;
  externalRef: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  addressLine: string;
  city: string;
  postalCode: string;
}

export interface SeedEnrollment {
  id: string;
  memberId: string;
  employerId: string;
  planId: string;
  employeeId: string;
  status: 'PENDING' | 'ACTIVE' | 'TERMINATED';
  effectiveFrom: string;
  effectiveTo: string | null;
  enrollmentExternalRef: string;
  sourceAsOf: string;
}

export interface SeedAccount {
  id: string;
  enrollmentId: string;
  currency: string;
  cardExternalRef: string;
}

export interface SeedLedgerEntry {
  id: string;
  accountId: string;
  type: 'CONTRIBUTION' | 'DEBIT' | 'ADJUSTMENT';
  amountCents: number;
  occurredAt: string;
  benefitCategory: BenefitCategoryName | null;
  description: string;
}

export interface SeedUser {
  id: string;
  email: string;
  role: 'MEMBER' | 'EMPLOYER_ADMIN' | 'SUPPORT';
  memberId: string | null;
  employerId: string | null;
}

const EMPLOYER_NORTHSTAR = '11111111-1111-4111-8111-000000000001';
const EMPLOYER_HARBOR = '11111111-1111-4111-8111-000000000002';

const PLAN_NORTHSTAR = '22222222-2222-4222-8222-000000000001';
const PLAN_HARBOR = '22222222-2222-4222-8222-000000000002';

const MEMBER_THOMPSON = '33333333-3333-4333-8333-000000000001';
const MEMBER_ALVAREZ = '33333333-3333-4333-8333-000000000002';
const MEMBER_RAMAN = '33333333-3333-4333-8333-000000000003';
const MEMBER_WEBER = '33333333-3333-4333-8333-000000000004';

const ENROLLMENT_THOMPSON = '44444444-4444-4444-8444-000000000001';
const ENROLLMENT_ALVAREZ = '44444444-4444-4444-8444-000000000002';
const ENROLLMENT_RAMAN = '44444444-4444-4444-8444-000000000003';
/** Weber's previous employer relationship, ended before the current plan year. */
const ENROLLMENT_WEBER_PAST = '44444444-4444-4444-8444-000000000004';
const ENROLLMENT_WEBER_CURRENT = '44444444-4444-4444-8444-000000000005';

const ACCOUNT_THOMPSON = '55555555-5555-4555-8555-000000000001';
const ACCOUNT_ALVAREZ = '55555555-5555-4555-8555-000000000002';
const ACCOUNT_RAMAN = '55555555-5555-4555-8555-000000000003';
const ACCOUNT_WEBER_PAST = '55555555-5555-4555-8555-000000000004';
const ACCOUNT_WEBER_CURRENT = '55555555-5555-4555-8555-000000000005';

/** The plan year every seeded plan runs on, so eligibility scenarios have a fixed frame. */
export const SEED_PLAN_YEAR_START = '2026-01-01';
export const SEED_PLAN_YEAR_END = '2026-12-31';

export const seedEmployers: SeedEmployer[] = [
  { id: EMPLOYER_NORTHSTAR, name: 'Northstar Industries', externalRef: 'EMP-001' },
  { id: EMPLOYER_HARBOR, name: 'Harbor Works', externalRef: 'EMP-002' },
];

export const seedPlans: SeedPlan[] = [
  {
    id: PLAN_NORTHSTAR,
    employerId: EMPLOYER_NORTHSTAR,
    name: 'Northstar Standard Health Capital',
    planYearStart: SEED_PLAN_YEAR_START,
    planYearEnd: SEED_PLAN_YEAR_END,
    planConfigVersion: 1,
    planConfigAsOf: '2026-01-05T09:00:00.000Z',
    planExternalRef: 'PLAN-001',
    coverageRules: [
      {
        category: 'PHYSICAL_THERAPY',
        covered: true,
        annualLimitCents: 120_000,
        substantiation: 'NONE',
        ruleRef: 'PLAN-PT-04',
      },
      {
        category: 'DENTAL',
        covered: true,
        annualLimitCents: 80_000,
        substantiation: 'RECEIPT_REQUIRED',
        ruleRef: 'PLAN-DEN-05',
      },
      {
        category: 'VISION',
        covered: true,
        annualLimitCents: 40_000,
        substantiation: 'NONE',
        ruleRef: 'PLAN-VIS-06',
      },
      {
        category: 'MENTAL_HEALTH',
        covered: true,
        annualLimitCents: null,
        substantiation: 'NONE',
        ruleRef: 'PLAN-MH-07',
      },
      {
        category: 'PRESCRIPTION',
        covered: true,
        annualLimitCents: 60_000,
        substantiation: 'RECEIPT_REQUIRED',
        ruleRef: 'PLAN-RX-08',
      },
      {
        category: 'COSMETIC',
        covered: false,
        annualLimitCents: null,
        substantiation: 'NONE',
        ruleRef: 'PLAN-COS-09',
      },
      {
        category: 'GYM_MEMBERSHIP',
        covered: false,
        annualLimitCents: null,
        substantiation: 'NONE',
        ruleRef: 'PLAN-GYM-10',
      },
      {
        category: 'OTHER',
        covered: false,
        annualLimitCents: null,
        substantiation: 'NONE',
        ruleRef: 'PLAN-OTH-11',
      },
    ],
  },
  {
    id: PLAN_HARBOR,
    employerId: EMPLOYER_HARBOR,
    name: 'Harbor Works Essential Health Capital',
    planYearStart: SEED_PLAN_YEAR_START,
    planYearEnd: SEED_PLAN_YEAR_END,
    planConfigVersion: 1,
    planConfigAsOf: '2026-01-07T09:00:00.000Z',
    planExternalRef: 'PLAN-002',
    coverageRules: [
      {
        category: 'PHYSICAL_THERAPY',
        covered: true,
        annualLimitCents: 60_000,
        substantiation: 'RECEIPT_REQUIRED',
        ruleRef: 'PLAN-PT-21',
      },
      {
        category: 'DENTAL',
        covered: true,
        annualLimitCents: 50_000,
        substantiation: 'NONE',
        ruleRef: 'PLAN-DEN-22',
      },
      {
        category: 'VISION',
        covered: true,
        annualLimitCents: 25_000,
        substantiation: 'NONE',
        ruleRef: 'PLAN-VIS-23',
      },
      {
        category: 'MENTAL_HEALTH',
        covered: true,
        annualLimitCents: 90_000,
        substantiation: 'NONE',
        ruleRef: 'PLAN-MH-24',
      },
      {
        category: 'PRESCRIPTION',
        covered: true,
        annualLimitCents: 30_000,
        substantiation: 'RECEIPT_REQUIRED',
        ruleRef: 'PLAN-RX-25',
      },
      {
        category: 'GYM_MEMBERSHIP',
        covered: true,
        annualLimitCents: 15_000,
        substantiation: 'RECEIPT_REQUIRED',
        ruleRef: 'PLAN-GYM-26',
      },
      {
        category: 'COSMETIC',
        covered: false,
        annualLimitCents: null,
        substantiation: 'NONE',
        ruleRef: 'PLAN-COS-27',
      },
      {
        category: 'OTHER',
        covered: false,
        annualLimitCents: null,
        substantiation: 'NONE',
        ruleRef: 'PLAN-OTH-28',
      },
    ],
  },
];

export const seedMembers: SeedMember[] = [
  {
    id: MEMBER_THOMPSON,
    externalRef: 'MBR-001',
    firstName: 'Sarah',
    lastName: 'Thompson',
    dateOfBirth: '1987-03-14',
    addressLine: '14 Alder Street',
    city: 'Riverton',
    postalCode: '40218',
  },
  {
    id: MEMBER_ALVAREZ,
    externalRef: 'MBR-002',
    firstName: 'Miguel',
    lastName: 'Alvarez',
    dateOfBirth: '1992-11-02',
    addressLine: '9 Kingfisher Lane',
    city: 'Riverton',
    postalCode: '40221',
  },
  {
    id: MEMBER_RAMAN,
    externalRef: 'MBR-003',
    firstName: 'Priya',
    lastName: 'Raman',
    dateOfBirth: '1979-06-27',
    addressLine: '221 Quarry Road',
    city: 'Eastmoor',
    postalCode: '51104',
  },
  {
    id: MEMBER_WEBER,
    externalRef: 'MBR-004',
    firstName: 'Jonas',
    lastName: 'Weber',
    dateOfBirth: '1995-01-19',
    addressLine: '3 Fen Court',
    city: 'Eastmoor',
    postalCode: '51108',
  },
];

export const seedEnrollments: SeedEnrollment[] = [
  {
    id: ENROLLMENT_THOMPSON,
    memberId: MEMBER_THOMPSON,
    employerId: EMPLOYER_NORTHSTAR,
    planId: PLAN_NORTHSTAR,
    employeeId: 'NS-1001',
    status: 'ACTIVE',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    enrollmentExternalRef: 'ENR-001',
    sourceAsOf: '2026-01-10T06:00:00.000Z',
  },
  {
    id: ENROLLMENT_ALVAREZ,
    memberId: MEMBER_ALVAREZ,
    employerId: EMPLOYER_NORTHSTAR,
    planId: PLAN_NORTHSTAR,
    employeeId: 'NS-1002',
    status: 'ACTIVE',
    effectiveFrom: '2025-06-01',
    effectiveTo: null,
    enrollmentExternalRef: 'ENR-002',
    sourceAsOf: '2026-01-10T06:00:00.000Z',
  },
  {
    id: ENROLLMENT_RAMAN,
    memberId: MEMBER_RAMAN,
    employerId: EMPLOYER_HARBOR,
    planId: PLAN_HARBOR,
    employeeId: 'HW-2001',
    status: 'ACTIVE',
    effectiveFrom: '2025-02-01',
    effectiveTo: null,
    enrollmentExternalRef: 'ENR-003',
    sourceAsOf: '2026-01-11T06:00:00.000Z',
  },
  {
    // Terminated relationship: supports enrollment-history and known-negative scenarios.
    id: ENROLLMENT_WEBER_PAST,
    memberId: MEMBER_WEBER,
    employerId: EMPLOYER_HARBOR,
    planId: PLAN_HARBOR,
    employeeId: 'HW-2002',
    status: 'TERMINATED',
    effectiveFrom: '2024-01-01',
    effectiveTo: '2025-09-30',
    enrollmentExternalRef: 'ENR-004',
    sourceAsOf: '2025-10-02T06:00:00.000Z',
  },
  {
    // The same person, later, at a different employer: Member is portable, enrollment is not.
    id: ENROLLMENT_WEBER_CURRENT,
    memberId: MEMBER_WEBER,
    employerId: EMPLOYER_NORTHSTAR,
    planId: PLAN_NORTHSTAR,
    employeeId: 'NS-1003',
    status: 'ACTIVE',
    effectiveFrom: '2025-10-01',
    effectiveTo: null,
    enrollmentExternalRef: 'ENR-005',
    sourceAsOf: '2026-01-10T06:00:00.000Z',
  },
];

export const seedAccounts: SeedAccount[] = [
  {
    id: ACCOUNT_THOMPSON,
    enrollmentId: ENROLLMENT_THOMPSON,
    currency: 'EUR',
    cardExternalRef: 'CARD-001',
  },
  {
    id: ACCOUNT_ALVAREZ,
    enrollmentId: ENROLLMENT_ALVAREZ,
    currency: 'EUR',
    cardExternalRef: 'CARD-002',
  },
  {
    id: ACCOUNT_RAMAN,
    enrollmentId: ENROLLMENT_RAMAN,
    currency: 'EUR',
    cardExternalRef: 'CARD-003',
  },
  {
    id: ACCOUNT_WEBER_PAST,
    enrollmentId: ENROLLMENT_WEBER_PAST,
    currency: 'EUR',
    cardExternalRef: 'CARD-004',
  },
  {
    id: ACCOUNT_WEBER_CURRENT,
    enrollmentId: ENROLLMENT_WEBER_CURRENT,
    currency: 'EUR',
    cardExternalRef: 'CARD-005',
  },
];

const entry = (
  suffix: number,
  accountId: string,
  type: SeedLedgerEntry['type'],
  amountCents: number,
  occurredAt: string,
  benefitCategory: BenefitCategoryName | null,
  description: string,
): SeedLedgerEntry => ({
  id: `66666666-6666-4666-8666-${String(suffix).padStart(12, '0')}`,
  accountId,
  type,
  amountCents,
  occurredAt,
  benefitCategory,
  description,
});

/**
 * Contributions plus category-tagged debits, so year-to-date category spend is computable before
 * any eligibility code exists. Amounts are positive magnitudes; the entry type carries the sign.
 *
 * Thompson is deliberately close to the dental annual limit (65,000 of 80,000 cents used) so a
 * later partial-coverage scenario is available without editing seed data.
 */
export const seedLedgerEntries: SeedLedgerEntry[] = [
  entry(
    1,
    ACCOUNT_THOMPSON,
    'CONTRIBUTION',
    150_000,
    '2026-01-15T00:00:00.000Z',
    null,
    'Employer contribution Q1',
  ),
  entry(
    2,
    ACCOUNT_THOMPSON,
    'CONTRIBUTION',
    150_000,
    '2026-04-15T00:00:00.000Z',
    null,
    'Employer contribution Q2',
  ),
  entry(
    3,
    ACCOUNT_THOMPSON,
    'DEBIT',
    40_000,
    '2026-02-03T00:00:00.000Z',
    'DENTAL',
    'Dental treatment',
  ),
  entry(
    4,
    ACCOUNT_THOMPSON,
    'DEBIT',
    30_000,
    '2026-03-19T00:00:00.000Z',
    'DENTAL',
    'Dental treatment',
  ),
  entry(
    5,
    ACCOUNT_THOMPSON,
    'ADJUSTMENT',
    5_000,
    '2026-03-25T00:00:00.000Z',
    'DENTAL',
    'Partial refund from provider',
  ),
  entry(
    6,
    ACCOUNT_THOMPSON,
    'DEBIT',
    18_000,
    '2026-04-02T00:00:00.000Z',
    'PHYSICAL_THERAPY',
    'Physiotherapy sessions',
  ),

  entry(
    7,
    ACCOUNT_ALVAREZ,
    'CONTRIBUTION',
    120_000,
    '2026-01-15T00:00:00.000Z',
    null,
    'Employer contribution Q1',
  ),
  entry(
    8,
    ACCOUNT_ALVAREZ,
    'DEBIT',
    24_000,
    '2026-02-20T00:00:00.000Z',
    'PHYSICAL_THERAPY',
    'Physiotherapy sessions',
  ),
  entry(
    9,
    ACCOUNT_ALVAREZ,
    'DEBIT',
    9_500,
    '2026-05-06T00:00:00.000Z',
    'PRESCRIPTION',
    'Prescription refill',
  ),

  entry(
    10,
    ACCOUNT_RAMAN,
    'CONTRIBUTION',
    90_000,
    '2026-01-20T00:00:00.000Z',
    null,
    'Employer contribution Q1',
  ),
  entry(
    11,
    ACCOUNT_RAMAN,
    'DEBIT',
    22_000,
    '2026-03-11T00:00:00.000Z',
    'VISION',
    'Prescription lenses',
  ),
  entry(
    12,
    ACCOUNT_RAMAN,
    'DEBIT',
    14_000,
    '2026-04-28T00:00:00.000Z',
    'MENTAL_HEALTH',
    'Counselling sessions',
  ),

  // Historical activity on the terminated enrollment, in the previous plan year.
  entry(
    13,
    ACCOUNT_WEBER_PAST,
    'CONTRIBUTION',
    80_000,
    '2025-01-15T00:00:00.000Z',
    null,
    'Employer contribution',
  ),
  entry(
    14,
    ACCOUNT_WEBER_PAST,
    'DEBIT',
    31_000,
    '2025-05-14T00:00:00.000Z',
    'DENTAL',
    'Dental treatment',
  ),
  entry(
    15,
    ACCOUNT_WEBER_PAST,
    'DEBIT',
    12_000,
    '2025-08-01T00:00:00.000Z',
    'GYM_MEMBERSHIP',
    'Fitness membership',
  ),

  entry(
    16,
    ACCOUNT_WEBER_CURRENT,
    'CONTRIBUTION',
    110_000,
    '2026-01-15T00:00:00.000Z',
    null,
    'Employer contribution Q1',
  ),
  entry(
    17,
    ACCOUNT_WEBER_CURRENT,
    'DEBIT',
    7_500,
    '2026-02-11T00:00:00.000Z',
    'PRESCRIPTION',
    'Prescription refill',
  ),
];

export const seedUsers: SeedUser[] = [
  {
    id: '77777777-7777-4777-8777-000000000001',
    email: `sarah.thompson@${SEED_EMAIL_DOMAIN}`,
    role: 'MEMBER',
    memberId: MEMBER_THOMPSON,
    employerId: null,
  },
  {
    id: '77777777-7777-4777-8777-000000000002',
    email: `miguel.alvarez@${SEED_EMAIL_DOMAIN}`,
    role: 'MEMBER',
    memberId: MEMBER_ALVAREZ,
    employerId: null,
  },
  {
    id: '77777777-7777-4777-8777-000000000003',
    email: `priya.raman@${SEED_EMAIL_DOMAIN}`,
    role: 'MEMBER',
    memberId: MEMBER_RAMAN,
    employerId: null,
  },
  {
    id: '77777777-7777-4777-8777-000000000004',
    email: `jonas.weber@${SEED_EMAIL_DOMAIN}`,
    role: 'MEMBER',
    memberId: MEMBER_WEBER,
    employerId: null,
  },
  {
    id: '77777777-7777-4777-8777-000000000005',
    email: `admin.northstar@${SEED_EMAIL_DOMAIN}`,
    role: 'EMPLOYER_ADMIN',
    memberId: null,
    employerId: EMPLOYER_NORTHSTAR,
  },
  {
    id: '77777777-7777-4777-8777-000000000006',
    email: `admin.harbor@${SEED_EMAIL_DOMAIN}`,
    role: 'EMPLOYER_ADMIN',
    memberId: null,
    employerId: EMPLOYER_HARBOR,
  },
  {
    id: '77777777-7777-4777-8777-000000000007',
    email: `support.desk@${SEED_EMAIL_DOMAIN}`,
    role: 'SUPPORT',
    memberId: null,
    employerId: null,
  },
];
