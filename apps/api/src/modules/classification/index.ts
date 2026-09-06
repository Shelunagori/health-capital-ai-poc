/**
 * Data classification: the registry of how sensitive each persisted field is, plus the helpers that
 * turn it into redaction. This module depends on nothing else in the application.
 */
export {
  DataClass,
  fieldClassification,
  classifyField,
  fieldNamesWithClass,
  type ClassifiedModelName,
  type FieldClassification,
} from './registry.js';

export { REDACTED, SENSITIVE_CLASSES, redactByClass, classificationRedactPaths } from './redact.js';

export {
  readPrismaScalarFields,
  readPrismaModelNames,
  type PrismaScalarField,
} from './prisma-schema.js';
