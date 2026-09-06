import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Database access. The connection string is supplied explicitly through a driver adapter rather
 * than read from the Prisma schema, so transport requirements (TLS in deployed environments) are
 * validated by `platform/config.ts` before a client is ever created.
 */
export interface CreateDbOptions {
  databaseUrl: string;
}

export function createDb({ databaseUrl }: CreateDbOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
