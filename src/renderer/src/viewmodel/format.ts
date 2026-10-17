export const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Compact age for table cells: today, 5d, 3w, 4mo. */
export function ago(days: number | null | undefined): string {
  if (days === null || days === undefined) return '–';
  if (days < 1) return 'today';
  if (days < 14) return `${days}d`;
  if (days < 70) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
