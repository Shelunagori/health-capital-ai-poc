import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Searches every text-like column in the database for a value.
 *
 * Deliberately exhaustive rather than checking the columns we expect: the whole point is to catch a
 * value reaching a place nobody thought about. It reads the live schema, so a table added later is
 * covered without anyone remembering to add it here.
 */
export interface ColumnHit {
  table: string;
  column: string;
  count: number;
}

const TEXT_TYPES = ['text', 'character varying', 'character', 'json', 'jsonb', 'uuid'];

export async function findValueInDatabase(db: PrismaClient, needle: string): Promise<ColumnHit[]> {
  const columns = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT c.table_name, c.column_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.data_type = ANY($1::text[])`,
    TEXT_TYPES,
  );

  const hits: ColumnHit[] = [];
  for (const { table_name, column_name } of columns) {
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "${table_name}"
       WHERE "${column_name}"::text ILIKE $1`,
      `%${needle}%`,
    );
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) hits.push({ table: table_name, column: column_name, count });
  }
  return hits;
}

/** Describes hits in a way that names the leak without printing the value that leaked. */
export function describeHits(hits: readonly ColumnHit[]): string {
  return hits.map((hit) => `${hit.table}.${hit.column} (${hit.count} row(s))`).join(', ');
}
