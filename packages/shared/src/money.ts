/**
 * Money is ALWAYS integer cents. Never floats. This is a locked invariant.
 * A dollar value only exists at the display boundary via `formatUsd`.
 */
export type Cents = number;

export function toCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

export function formatUsd(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = (abs / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return neg ? `-${s}` : s;
}

/**
 * Margin as a percentage number (e.g. 12.5 means 12.5%), derived from cents.
 * Percentages are display/decision values only and are NEVER treated as money.
 */
export function marginPct(contractCents: Cents, costCents: Cents): number {
  if (contractCents <= 0) return 0;
  return round2(((contractCents - costCents) / contractCents) * 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Add days to a date, returning a new Date (UTC-safe). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** YYYY-MM month key for capacity bucketing. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
