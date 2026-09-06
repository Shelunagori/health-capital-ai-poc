import { describe, expect, it } from 'vitest';
import { formatCents, formatDate, formatDateTime, humaniseCode } from '@/lib/format';

/** Nothing a reader sees should look like a database value. */
const ISO_LOOKING = /\d{4}-\d{2}-\d{2}/;

describe('a date is shown the way a person writes one', () => {
  it.each([
    ['2026-09-07', '7 Sep 2026'],
    ['2026-05-04', '4 May 2026'],
    ['2026-01-01', '1 Jan 2026'],
    ['2026-12-31', '31 Dec 2026'],
    ['1987-03-14', '14 Mar 1987'],
  ])('renders %s as %s', (iso, expected) => {
    expect(formatDate(iso)).toBe(expected);
  });

  it('never leaves an ISO date on the page', () => {
    expect(formatDate('2026-09-07')).not.toMatch(ISO_LOOKING);
  });

  it('keeps the calendar date the API sent, whatever timezone the reader is in', () => {
    // The suite runs behind UTC. A calendar date put through `new Date` would show the day before.
    expect(formatDate('2026-05-04')).toBe('4 May 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('shows an instant in the reader’s own timezone', () => {
    // 10:00 UTC, read five hours earlier in New York.
    expect(formatDate('2026-05-04T10:00:00.000Z')).toBe('4 May 2026');
  });
});

describe('a timestamp carries the time as well', () => {
  it('renders midnight as 12 AM rather than 0', () => {
    expect(formatDateTime('2026-09-07T04:15:00.000Z')).toBe('7 Sep 2026, 12:15 AM');
  });

  it('renders midday as 12 PM rather than 0', () => {
    expect(formatDateTime('2026-09-07T16:00:00.000Z')).toBe('7 Sep 2026, 12:00 PM');
  });

  it('pads the minutes', () => {
    expect(formatDateTime('2026-05-04T10:05:00.000Z')).toBe('4 May 2026, 6:05 AM');
  });

  it('never leaves an ISO timestamp on the page', () => {
    expect(formatDateTime('2026-05-04T10:00:00.000Z')).not.toMatch(ISO_LOOKING);
    expect(formatDateTime('2026-05-04T10:00:00.000Z')).not.toMatch(/[TZ]/);
  });
});

describe('an unusable value is never turned into a date', () => {
  it.each(['tomorrow', 'not-a-date', '2026-13-45', '2026-02-31'])('leaves %s alone', (value) => {
    expect(formatDate(value)).toBe(value);
    expect(formatDateTime(value)).toBe(value);
  });

  it('shows a dash when there is nothing at all', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });
});

describe('the other formatters are unchanged', () => {
  it('formats money from integer cents', () => {
    expect(formatCents(15_000)).toContain('150.00');
    expect(formatCents(null)).toBe('—');
  });

  it('humanises a code without inventing wording', () => {
    expect(humaniseCode('BENEFITS_DISPUTE')).toBe('benefits dispute');
    expect(humaniseCode(null)).toBe('—');
  });
});
