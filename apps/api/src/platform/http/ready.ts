import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';

/**
 * Readiness: can this process actually serve traffic. Unlike liveness, it touches the database and
 * checks that migrations have been applied, so a container that starts against an unmigrated
 * database reports itself as not ready rather than failing every request.
 */
export function registerReady(app: FastifyInstance, db: Db): void {
  app.get('/ready', { config: { public: true } }, async (_request, reply) => {
    try {
      const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
      );
      const applied = Number(rows[0]?.count ?? 0);
      if (applied === 0) {
        return reply.status(503).send({ status: 'not-ready', reason: 'MIGRATIONS_NOT_APPLIED' });
      }
      return reply.status(200).send({ status: 'ready', migrationsApplied: applied });
    } catch {
      // The reason stays coarse on purpose: a readiness probe is not a place to describe the
      // database to whoever asks.
      return reply.status(503).send({ status: 'not-ready', reason: 'DATABASE_UNAVAILABLE' });
    }
  });
}
