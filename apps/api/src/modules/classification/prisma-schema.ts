import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal reader for our own `schema.prisma`, used by the classification drift guard.
 *
 * Prisma 7 no longer ships a runtime DMMF with the generated client, so the guard reads the schema
 * file itself. That is the source of truth for what gets persisted, and it needs no generated
 * artifact to be up to date.
 */
export interface PrismaScalarField {
  readonly model: string;
  readonly field: string;
  /** Declared type with `[]` and `?` removed, e.g. `String`, `Int`, `BenefitCategory`. */
  readonly type: string;
  readonly isOptional: boolean;
}

const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../prisma/schema.prisma',
);

const MODEL_BLOCK = /^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{$/;
const CLOSING_BRACE = /^\}$/;

/**
 * Returns every persisted (scalar or enum) field in the schema. Relation navigation properties are
 * excluded because they are not columns; their foreign-key scalars are included.
 */
export function readPrismaScalarFields(schemaPath: string = SCHEMA_PATH): PrismaScalarField[] {
  const source = readFileSync(schemaPath, 'utf8');
  const lines = source.split('\n').map((line) => line.trim());

  const modelNames = new Set<string>();
  for (const line of lines) {
    const match = MODEL_BLOCK.exec(line);
    if (match?.[1] !== undefined) modelNames.add(match[1]);
  }

  const fields: PrismaScalarField[] = [];
  let currentModel: string | null = null;

  for (const line of lines) {
    if (currentModel === null) {
      const match = MODEL_BLOCK.exec(line);
      if (match?.[1] !== undefined) currentModel = match[1];
      continue;
    }
    if (CLOSING_BRACE.test(line)) {
      currentModel = null;
      continue;
    }
    // Comments, doc comments and block-level attributes carry no fields.
    if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;

    const [name, rawType] = line.split(/\s+/);
    if (name === undefined || rawType === undefined) continue;

    const isList = rawType.endsWith('[]');
    const isOptional = rawType.endsWith('?');
    const type = rawType.replace(/[[\]?]/g, '');

    // A field whose type is another model is a relation navigation property, not a column.
    if (modelNames.has(type) || isList) continue;

    fields.push({ model: currentModel, field: name, type, isOptional });
  }

  return fields;
}

/** Model names declared in the schema, in declaration order. */
export function readPrismaModelNames(schemaPath: string = SCHEMA_PATH): string[] {
  const source = readFileSync(schemaPath, 'utf8');
  return source
    .split('\n')
    .map((line) => MODEL_BLOCK.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined);
}
