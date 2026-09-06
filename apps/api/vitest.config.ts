import { defineConfig } from 'vitest/config';

/**
 * Unit tests live next to the code and never touch a database or the network.
 * Integration tests run against a migrated and seeded PostgreSQL instance:
 *   docker compose up -d && pnpm db:deploy && pnpm db:seed && pnpm test:integration
 *
 * Later milestones add: security, privacy, ai-pipeline and ai-live projects.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'prisma/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'security',
          include: ['test/security/**/*.test.ts'],
          environment: 'node',
          poolOptions: { threads: { singleThread: true } },
          globalSetup: ['test/helpers/integration-setup.ts'],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'privacy',
          include: ['test/privacy/**/*.test.ts'],
          environment: 'node',
          poolOptions: { threads: { singleThread: true } },
          globalSetup: ['test/helpers/integration-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'ai-pipeline',
          include: ['test/ai-pipeline/**/*.test.ts'],
          environment: 'node',
          poolOptions: { threads: { singleThread: true } },
          globalSetup: ['test/helpers/integration-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'ai-live',
          include: ['test/ai-live/**/*.test.ts'],
          environment: 'node',
          poolOptions: { threads: { singleThread: true } },
          globalSetup: ['test/helpers/integration-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['test/helpers/integration-setup.ts'],
          // These tests share one seeded database, so their files run sequentially in one worker.
          poolOptions: { threads: { singleThread: true } },
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
