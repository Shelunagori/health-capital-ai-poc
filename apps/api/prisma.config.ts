import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (migrate, generate, seed).
 * The connection URL is read from the environment; it is never written into schema.prisma,
 * and application code connects through an explicit driver adapter instead.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Read leniently so `prisma generate` (and therefore typecheck, lint and build) works on a
    // fresh clone with no database configured. Commands that actually connect fail with a clear
    // connection error instead, and deployed environments validate the URL in platform/config.ts.
    url: process.env['DATABASE_URL'] ?? '',
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
