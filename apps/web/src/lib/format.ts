/**
 * Money arrives as integer cents and is only ever formatted for display. No arithmetic happens in
 * the browser: the amounts shown are the amounts the decision was made with.
 */
export function formatCents(cents: number | null | undefined, currency = 'EUR'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100);
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A plain calendar date, as the API sends one: no time, no offset, no room for interpretation. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Dates are assembled here rather than handed to `Intl.DateTimeFormat`.
 *
 * Two reasons. The month abbreviation a locale gives back moves between runtime versions — the same
 * `en-IE` request answers "Sep" on one and "Sept" on another — and a demonstration that renders
 * differently depending on the browser looks careless. And a calendar date is not an instant: it
 * arrives as `2026-05-04` with no timezone, so putting it through `new Date` and reading it back in
 * the viewer's zone shows the day before for anyone west of London. Splitting the string keeps the
 * date the API sent.
 */
function calendarParts(iso: string): { year: number; month: number; day: number } | null {
  const match = CALENDAR_DATE.exec(iso);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Rejects 2026-02-31 and friends: the round trip only agrees for a date that exists.
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (asUtc.getUTCMonth() + 1 !== month || asUtc.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** `7 Sep 2026` from the parts of a moment, read in whichever timezone the reader is in. */
function localDate(moment: Date): string {
  return `${moment.getDate()} ${MONTHS[moment.getMonth()] ?? ''} ${moment.getFullYear()}`;
}

/** `7 Sep 2026`. Anything unparseable comes back untouched: never a guessed date. */
export function formatDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';

  if (CALENDAR_DATE.test(iso)) {
    const calendar = calendarParts(iso);
    // A date-shaped string that is not a real date is shown as it arrived. `new Date` would happily
    // read 2026-02-31 as the second of March, and inventing a date is worse than showing a raw one.
    if (calendar === null) return iso;
    return `${calendar.day} ${MONTHS[calendar.month - 1] ?? ''} ${calendar.year}`;
  }

  // An instant rather than a calendar date, so it is shown in the reader's own timezone.
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? iso : localDate(moment);
}

/** `7 Sep 2026, 12:15 AM`, in the reader's own timezone. Unparseable input comes back untouched. */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  // A plain calendar date carries no time, and midnight is not a time anyone sent.
  if (CALENDAR_DATE.test(iso)) return formatDate(iso);

  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return iso;

  const hours = moment.getHours();
  const meridiem = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(moment.getMinutes()).padStart(2, '0');
  return `${localDate(moment)}, ${twelve}:${minutes} ${meridiem}`;
}

/**
 * Turns a coded value into readable words without inventing new wording for it.
 * Used wherever a reason code is shown, so the picker and the audit trail always agree.
 */
export function humaniseCode(code: string | null | undefined): string {
  if (code === null || code === undefined || code === '') return '—';
  return code.toLowerCase().replace(/_/g, ' ');
}

/** Turns an enum value into something readable without inventing new wording for it. */
export function humaniseCategory(category: string): string {
  return category
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
