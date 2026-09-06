import type { AiUserQuery, AiUserQueryShape } from './types.js';

/**
 * The only door raw member text goes through.
 *
 * What survives is the member's healthcare intent, which is itself sensitive: someone asking about
 * a treatment is telling you something about their health. Sanitizing removes identifiers the model
 * has no use for; it does not make the remainder harmless. This proof of concept works on synthetic
 * data. A real deployment would need a classifier built for the job, a data-processing agreement
 * with the provider, and the member's informed consent.
 *
 * The redaction is deliberately blunt. Over-removing costs a little answer quality; under-removing
 * costs someone their privacy.
 */
export const MAX_QUERY_LENGTH = 500;

export const RedactionKind = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  ID: 'ID',
  DOB: 'DOB',
  NAME: 'NAME',
  ADDRESS: 'ADDRESS',
} as const;
export type RedactionKind = (typeof RedactionKind)[keyof typeof RedactionKind];

/** The caller's own stored values, so they can be removed by exact match as well as by pattern. */
export interface KnownProfileValues {
  firstName?: string | undefined;
  lastName?: string | undefined;
  dateOfBirth?: Date | undefined;
  addressLine?: string | undefined;
  city?: string | undefined;
  postalCode?: string | undefined;
  email?: string | undefined;
  employeeId?: string | undefined;
  memberExternalRef?: string | undefined;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;
/** Reference-shaped tokens such as MBR-001, ENR-004 or NS-1001. */
const REFERENCE = /\b[A-Z]{2,6}-\d{1,8}\b/g;
/** A run of digits long enough to be an identifier rather than a price. */
const LONG_DIGITS = /\b\d{6,}\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
/** Money, protected first so a phone-number pattern cannot eat the amount the model needs. */
const MONEY =
  /(?:[$£€]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|euros|pounds|usd|eur|gbp)\b)/gi;
/** Control and formatting characters, including those used to smuggle instructions past a reader. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dateVariants(date: Date): string[] {
  const iso = date.toISOString().slice(0, 10);
  const [year, month, day] = iso.split('-') as [string, string, string];
  return [
    iso,
    `${day}/${month}/${year}`,
    `${month}/${day}/${year}`,
    `${day}.${month}.${year}`,
    `${day}-${month}-${year}`,
  ];
}

/**
 * Normalizes, removes identifiers, then caps the length.
 */
export function sanitizeUserQuery(raw: string, profile: KnownProfileValues = {}): AiUserQuery {
  const counts = new Map<RedactionKind, number>();
  const bump = (kind: RedactionKind): void => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  };

  let text = raw.normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();

  // Park money as placeholders so later patterns cannot consume it, then restore it at the end.
  const money: string[] = [];
  text = text.replace(MONEY, (match) => {
    money.push(match);
    return ` MONEYSLOT${money.length - 1} `;
  });

  const replaceAll = (pattern: RegExp, kind: RedactionKind): void => {
    text = text.replace(pattern, () => {
      bump(kind);
      return `[${kind}]`;
    });
  };

  replaceAll(EMAIL, RedactionKind.EMAIL);

  // The caller's own stored values, removed wherever they appear.
  const known: [string | undefined, RedactionKind][] = [
    [profile.email, RedactionKind.EMAIL],
    [profile.employeeId, RedactionKind.ID],
    [profile.memberExternalRef, RedactionKind.ID],
    [profile.addressLine, RedactionKind.ADDRESS],
    [profile.postalCode, RedactionKind.ADDRESS],
    [profile.city, RedactionKind.ADDRESS],
    [profile.firstName, RedactionKind.NAME],
    [profile.lastName, RedactionKind.NAME],
  ];
  for (const [value, kind] of known) {
    if (value === undefined || value.trim().length < 2) continue;
    const pattern = new RegExp(`\\b${escapeRegex(value.trim())}\\b`, 'gi');
    text = text.replace(pattern, () => {
      bump(kind);
      return `[${kind}]`;
    });
  }

  if (profile.dateOfBirth !== undefined) {
    for (const variant of dateVariants(profile.dateOfBirth)) {
      const pattern = new RegExp(`\\b${escapeRegex(variant)}\\b`, 'g');
      text = text.replace(pattern, () => {
        bump(RedactionKind.DOB);
        return `[${RedactionKind.DOB}]`;
      });
    }
  }

  replaceAll(REFERENCE, RedactionKind.ID);
  replaceAll(ISO_DATE, RedactionKind.DOB);
  replaceAll(PHONE, RedactionKind.PHONE);
  replaceAll(LONG_DIGITS, RedactionKind.ID);

  text = text.replace(
    / MONEYSLOT(\d+) /g,
    (_match, index: string) => ` ${money[Number(index)] ?? ''} `,
  );
  text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);

  const shape: AiUserQueryShape = {
    text,
    redactions: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
  };
  return shape as AiUserQuery;
}
