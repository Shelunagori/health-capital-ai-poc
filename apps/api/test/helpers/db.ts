import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Integration tests run against a real PostgreSQL instance that has already been migrated and
 * seeded (`pnpm db:deploy && pnpm db:seed`). They read the seeded dataset and must leave it intact,
 * so any row they create is removed again in the same test.
 */
export function testDatabaseUrl(): string {
  const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'Integration tests need DATABASE_URL_TEST or DATABASE_URL. Start PostgreSQL with ' +
        '`docker compose up -d`, then run `pnpm db:deploy && pnpm db:seed`.',
    );
  }
  return url;
}

export function createTestDb(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) });
}
