import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPrismaScalarFields } from '../src/modules/classification/prisma-schema.js';
import {
  EXTERNAL_REF_PATTERNS,
  SEED_EMAIL_DOMAIN,
  SEED_PLAN_YEAR_END,
  SEED_PLAN_YEAR_START,
  seedAccounts,
  seedEmployers,
  seedEnrollments,
  seedLedgerEntries,
  seedMembers,
  seedPlans,
  seedUsers,
} from './seed-data.js';

const CATEGORIES = [
  'PHYSICAL_THERAPY',
  'DENTAL',
  'VISION',
  'MENTAL_HEALTH',
  'PRESCRIPTION',
  'COSMETIC',
  'GYM_MEMBERSHIP',
  'OTHER',
];

describe('seed categories match the schema enum', () => {
  it('uses exactly the categories declared in schema.prisma', () => {
    const schemaSource = readFileSync(new URL('./schema.prisma', import.meta.url).pathname, 'utf8');
    const block = /enum BenefitCategory \{([^}]*)\}/.exec(schemaSource)?.[1] ?? '';
    const declared = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'));
    expect(declared.sort()).toEqual([...CATEGORIES].sort());
  });

  it('declares the category column on both models', () => {
    const fields = readPrismaScalarFields();
    expect(
      fields.find((f) => f.model === 'CareRequest' && f.field === 'treatmentCategory')?.type,
    ).toBe('BenefitCategory');
    expect(
      fields.find((f) => f.model === 'LedgerEntry' && f.field === 'benefitCategory')?.type,
    ).toBe('BenefitCategory');
  });
});

describe('seed data is company-neutral', () => {
  it('uses only example.test email addresses', () => {
    for (const user of seedUsers) {
      expect(user.email.endsWith(`@${SEED_EMAIL_DOMAIN}`), user.email).toBe(true);
    }
    expect(SEED_EMAIL_DOMAIN).toBe('example.test');
  });

  it('uses neutral opaque external reference families', () => {
    for (const employer of seedEmployers) {
      expect(employer.externalRef).toMatch(EXTERNAL_REF_PATTERNS.employer);
    }
    for (const plan of seedPlans) {
      expect(plan.planExternalRef).toMatch(EXTERNAL_REF_PATTERNS.plan);
    }
    for (const member of seedMembers) {
      expect(member.externalRef).toMatch(EXTERNAL_REF_PATTERNS.member);
    }
    for (const enrollment of seedEnrollments) {
      expect(enrollment.enrollmentExternalRef).toMatch(EXTERNAL_REF_PATTERNS.enrollment);
    }
    for (const account of seedAccounts) {
      expect(account.cardExternalRef).toMatch(EXTERNAL_REF_PATTERNS.card);
    }
  });

  it('draws every human-readable name from an approved neutral vocabulary', () => {
    // Any new seed string must be added here deliberately, which is where a brand name would be
    // caught during review. The repository-wide brand guard is the second line of defence.
    const approvedOrganisations = ['Northstar Industries', 'Harbor Works'];
    const approvedPlanNames = [
      'Northstar Standard Health Capital',
      'Harbor Works Essential Health Capital',
    ];
    const approvedPeople = ['Sarah Thompson', 'Miguel Alvarez', 'Priya Raman', 'Jonas Weber'];
    const approvedCities = ['Riverton', 'Eastmoor'];

    expect(seedEmployers.map((e) => e.name).sort()).toEqual([...approvedOrganisations].sort());
    expect(seedPlans.map((p) => p.name).sort()).toEqual([...approvedPlanNames].sort());
    expect(seedMembers.map((m) => `${m.firstName} ${m.lastName}`).sort()).toEqual(
      [...approvedPeople].sort(),
    );
    for (const member of seedMembers) {
      expect(approvedCities).toContain(member.city);
    }
  });

  it('never carries a plaintext password or credential field', () => {
    const serialised = JSON.stringify({ seedUsers, seedMembers, seedEmployers });
    expect(serialised).not.toMatch(/password/i);
    expect(serialised).not.toMatch(/secret/i);
    expect(serialised).not.toMatch(/token/i);
    for (const user of seedUsers) {
      expect(Object.keys(user)).toEqual(['id', 'email', 'role', 'memberId', 'employerId']);
    }
  });
});

describe('seed data is internally consistent', () => {
  it('gives every record a unique identifier and reference', () => {
    const allIds = [
      ...seedEmployers.map((e) => e.id),
      ...seedPlans.map((p) => p.id),
      ...seedMembers.map((m) => m.id),
      ...seedEnrollments.map((e) => e.id),
      ...seedAccounts.map((a) => a.id),
      ...seedLedgerEntries.map((l) => l.id),
      ...seedUsers.map((u) => u.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);

    const refs = [
      ...seedEmployers.map((e) => e.externalRef),
      ...seedPlans.map((p) => p.planExternalRef),
      ...seedMembers.map((m) => m.externalRef),
      ...seedEnrollments.map((e) => e.enrollmentExternalRef),
      ...seedAccounts.map((a) => a.cardExternalRef),
    ];
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('points every foreign key at a seeded record', () => {
    const employerIds = new Set(seedEmployers.map((e) => e.id));
    const planIds = new Set(seedPlans.map((p) => p.id));
    const memberIds = new Set(seedMembers.map((m) => m.id));
    const enrollmentIds = new Set(seedEnrollments.map((e) => e.id));
    const accountIds = new Set(seedAccounts.map((a) => a.id));

    for (const plan of seedPlans) expect(employerIds.has(plan.employerId)).toBe(true);
    for (const enrollment of seedEnrollments) {
      expect(memberIds.has(enrollment.memberId)).toBe(true);
      expect(employerIds.has(enrollment.employerId)).toBe(true);
      expect(planIds.has(enrollment.planId)).toBe(true);
    }
    for (const account of seedAccounts) expect(enrollmentIds.has(account.enrollmentId)).toBe(true);
    for (const item of seedLedgerEntries) expect(accountIds.has(item.accountId)).toBe(true);
    for (const user of seedUsers) {
      if (user.memberId !== null) expect(memberIds.has(user.memberId)).toBe(true);
      if (user.employerId !== null) expect(employerIds.has(user.employerId)).toBe(true);
    }
  });

  it('matches each user role to exactly one scope reference', () => {
    for (const user of seedUsers) {
      if (user.role === 'MEMBER') {
        expect(user.memberId).not.toBeNull();
        expect(user.employerId).toBeNull();
      } else if (user.role === 'EMPLOYER_ADMIN') {
        expect(user.employerId).not.toBeNull();
        expect(user.memberId).toBeNull();
      } else {
        expect(user.memberId).toBeNull();
        expect(user.employerId).toBeNull();
      }
    }
    expect(seedUsers.filter((u) => u.role === 'EMPLOYER_ADMIN')).toHaveLength(2);
    expect(seedUsers.filter((u) => u.role === 'SUPPORT')).toHaveLength(1);
    expect(seedUsers.filter((u) => u.role === 'MEMBER')).toHaveLength(4);
  });

  it('covers every benefit category in each plan exactly once', () => {
    for (const plan of seedPlans) {
      const categories = plan.coverageRules.map((rule) => rule.category);
      expect(new Set(categories).size).toBe(categories.length);
      expect(categories.sort()).toEqual([...CATEGORIES].sort());
      for (const rule of plan.coverageRules) {
        expect(rule.ruleRef).toMatch(/^PLAN-[A-Z]+-\d{2}$/);
        if (!rule.covered) expect(rule.annualLimitCents).toBeNull();
      }
    }
  });
});

describe('seed data supports later eligibility scenarios', () => {
  it('includes a terminated enrollment and a second enrollment for the same member', () => {
    const terminated = seedEnrollments.filter((e) => e.status === 'TERMINATED');
    expect(terminated.length).toBeGreaterThanOrEqual(1);
    for (const enrollment of terminated) expect(enrollment.effectiveTo).not.toBeNull();

    const byMember = new Map<string, number>();
    for (const enrollment of seedEnrollments) {
      byMember.set(enrollment.memberId, (byMember.get(enrollment.memberId) ?? 0) + 1);
    }
    expect([...byMember.values()].some((count) => count > 1)).toBe(true);
  });

  it('tags every debit with a benefit category so year-to-date spend is computable', () => {
    const debits = seedLedgerEntries.filter((entry) => entry.type === 'DEBIT');
    expect(debits.length).toBeGreaterThanOrEqual(6);
    for (const debit of debits) {
      expect(debit.benefitCategory, debit.description).not.toBeNull();
      expect(CATEGORIES).toContain(debit.benefitCategory);
    }
  });

  it('uses positive magnitudes for every amount', () => {
    for (const entry of seedLedgerEntries) expect(entry.amountCents).toBeGreaterThan(0);
  });

  it('leaves one member close to a category limit for a later partial-coverage scenario', () => {
    const thompson = seedMembers.find((m) => m.externalRef === 'MBR-001');
    const enrollment = seedEnrollments.find((e) => e.memberId === thompson?.id);
    const account = seedAccounts.find((a) => a.enrollmentId === enrollment?.id);
    const plan = seedPlans.find((p) => p.id === enrollment?.planId);

    const dentalSpend = seedLedgerEntries
      .filter((e) => e.accountId === account?.id && e.benefitCategory === 'DENTAL')
      .reduce((total, e) => total + (e.type === 'DEBIT' ? e.amountCents : -e.amountCents), 0);
    const dentalLimit = plan?.coverageRules.find((r) => r.category === 'DENTAL')?.annualLimitCents;

    expect(dentalLimit).toBe(80_000);
    expect(dentalSpend).toBe(65_000);
    expect(dentalSpend).toBeLessThan(dentalLimit ?? 0);
  });

  it('places current-year activity inside the seeded plan year', () => {
    const start = new Date(SEED_PLAN_YEAR_START).getTime();
    const end = new Date(SEED_PLAN_YEAR_END).getTime();
    const currentYearEntries = seedLedgerEntries.filter(
      (entry) => new Date(entry.occurredAt).getTime() >= start,
    );
    expect(currentYearEntries.length).toBeGreaterThan(0);
    for (const entry of currentYearEntries) {
      expect(new Date(entry.occurredAt).getTime()).toBeLessThanOrEqual(end + 86_400_000);
    }
  });
});
