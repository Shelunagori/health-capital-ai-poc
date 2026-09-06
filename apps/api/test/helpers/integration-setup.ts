import { createTestDb } from './db.js';

/**
 * Runs once before the integration project. It clears the transactional tables so a crashed
 * previous run cannot poison this one, and fails with an actionable message when the database has
 * not been migrated and seeded.
 *
 * The append-only tables are cleared with TRUNCATE, which is not intercepted by the row-level
 * triggers that block UPDATE and DELETE.
 */
export async function setup(): Promise<void> {
  const db = createTestDb();
  try {
    const employers = await db.employer.count();
    if (employers === 0) {
      throw new Error(
        'The test database has no seed data. Run `pnpm db:deploy && pnpm db:seed` first ' +
          '(with SEED_USER_PASSWORD set).',
      );
    }
    await db.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent", "EligibilityDecision" CASCADE');
    await db.ledgerEntry.updateMany({
      where: { careRequestId: { not: null } },
      data: { careRequestId: null },
    });
    await db.careRequest.deleteMany();
  } finally {
    await db.$disconnect();
  }
}
