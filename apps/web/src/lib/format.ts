/**
 * Money arrives as integer cents and is only ever formatted for display. No arithmetic happens in
 * the browser: the amounts shown are the amounts the decision was made with.
 */
export function formatCents(cents: number | null | undefined, currency = 'EUR'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium' }).format(date);
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
