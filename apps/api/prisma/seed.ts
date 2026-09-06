/* eslint-disable no-console -- this is an operator-facing CLI script, not application code. */
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import {
  seedAccounts,
  seedEmployers,
  seedEnrollments,
  seedLedgerEntries,
  seedMembers,
  seedPlans,
  seedUsers,
} from './seed-data.js';

/**
 * Loads the synthetic dataset. Safe to run repeatedly: existing rows are deleted first, and every
 * identifier is fixed, so the result is byte-for-byte the same each time.
 *
 * The demo password is read from the environment and only its Argon2id hash is stored. No plaintext
 * password is written to the database, this file, or the log.
 */

/** OWASP-recommended baseline for Argon2id; deliberately explicit rather than library defaults. */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

function requireSeedPassword(): string {
  const password = process.env['SEED_USER_PASSWORD'];
  if (password === undefined || password.trim() === '') {
    throw new Error(
      'SEED_USER_PASSWORD is not set. Choose a synthetic development password and export it, ' +
        'for example: SEED_USER_PASSWORD=... pnpm db:seed. It is hashed with Argon2id and never stored in plaintext.',
    );
  }
  if (password.length < 12) {
    throw new Error('SEED_USER_PASSWORD must be at least 12 characters.');
  }
  return password;
}

function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error('DATABASE_URL is not set.');
  }
  return url;
}

async function main(): Promise<void> {
  const password = requireSeedPassword();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireDatabaseUrl() }),
  });

  try {
    // Append-only tables are truncated with raw SQL because their triggers reject DELETE.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent", "EligibilityDecision" CASCADE');
    await prisma.ledgerEntry.deleteMany();
    await prisma.careRequest.deleteMany();
    await prisma.user.deleteMany();
    await prisma.healthCapitalAccount.deleteMany();
    await prisma.benefitEnrollment.deleteMany();
    await prisma.plan.deleteMany();
    await prisma.member.deleteMany();
    await prisma.employer.deleteMany();

    await prisma.employer.createMany({ data: seedEmployers });

    await prisma.plan.createMany({
      data: seedPlans.map((plan) => ({
        id: plan.id,
        employerId: plan.employerId,
        name: plan.name,
        planYearStart: new Date(plan.planYearStart),
        planYearEnd: new Date(plan.planYearEnd),
        // Coverage rules are plan parameters stored as data. The shape is validated by
        // seed-data tests; Prisma's JSON input type does not accept a named interface directly.
        coverageRules: plan.coverageRules as unknown as Prisma.InputJsonValue,
        planConfigVersion: plan.planConfigVersion,
        planConfigAsOf: new Date(plan.planConfigAsOf),
        planExternalRef: plan.planExternalRef,
      })),
    });

    await prisma.member.createMany({
      data: seedMembers.map((member) => ({
        ...member,
        dateOfBirth: new Date(member.dateOfBirth),
      })),
    });

    await prisma.benefitEnrollment.createMany({
      data: seedEnrollments.map((enrollment) => ({
        id: enrollment.id,
        memberId: enrollment.memberId,
        employerId: enrollment.employerId,
        planId: enrollment.planId,
        employeeId: enrollment.employeeId,
        status: enrollment.status,
        effectiveFrom: new Date(enrollment.effectiveFrom),
        effectiveTo: enrollment.effectiveTo === null ? null : new Date(enrollment.effectiveTo),
        enrollmentExternalRef: enrollment.enrollmentExternalRef,
        sourceAsOf: new Date(enrollment.sourceAsOf),
      })),
    });

    await prisma.healthCapitalAccount.createMany({ data: seedAccounts });

    await prisma.ledgerEntry.createMany({
      data: seedLedgerEntries.map((item) => ({
        id: item.id,
        accountId: item.accountId,
        type: item.type,
        amountCents: item.amountCents,
        occurredAt: new Date(item.occurredAt),
        benefitCategory: item.benefitCategory,
        description: item.description,
      })),
    });

    const passwordHash = await hash(password, ARGON2_OPTIONS);
    await prisma.user.createMany({
      data: seedUsers.map((user) => ({
        id: user.id,
        email: user.email,
        passwordHash,
        role: user.role,
        memberId: user.memberId,
        employerId: user.employerId,
      })),
    });

    // Emails only. The password is never printed.
    console.log('Seed complete:');
    console.log(`  employers            ${await prisma.employer.count()}`);
    console.log(`  plans                ${await prisma.plan.count()}`);
    console.log(`  members              ${await prisma.member.count()}`);
    console.log(`  benefit enrollments  ${await prisma.benefitEnrollment.count()}`);
    console.log(`  accounts             ${await prisma.healthCapitalAccount.count()}`);
    console.log(`  ledger entries       ${await prisma.ledgerEntry.count()}`);
    console.log(`  users                ${await prisma.user.count()}`);
    console.log('Sign-in identities (password from SEED_USER_PASSWORD):');
    for (const user of seedUsers) console.log(`  ${user.role.padEnd(15)} ${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Seed failed');
  process.exit(1);
});
