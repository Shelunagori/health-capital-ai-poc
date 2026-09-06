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

/** Turns an enum value into something readable without inventing new wording for it. */
export function humaniseCategory(category: string): string {
  return category
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
