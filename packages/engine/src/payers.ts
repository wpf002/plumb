import type { Cents, Payer } from "@plumb/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SettledInvoice {
  /** When payment was due under the contract's terms. */
  dueDate: Date;
  paidDate: Date;
  amountCents: Cents;
}

export interface PayerObservation {
  sampleSize: number;
  /** Median days past due. Median, not mean — one 180-day fight shouldn't
   *  redefine a payer who is otherwise reliable. */
  typicalDaysLate: number;
  worstDaysLate: number;
  /** Share of invoices that landed on or before the due date. */
  onTimePct: number;
  /** Dollars weighted by lateness — a big slow invoice hurts more. */
  weightedDaysLate: number;
}

export function daysLate(inv: SettledInvoice): number {
  return Math.round((inv.paidDate.getTime() - inv.dueDate.getTime()) / DAY_MS);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Derive how a payer actually behaves from invoices they've already settled.
 *
 * This is the Siteline insight — payment-pattern forecasting — delivered to an
 * owner instead of an AR department, and connected to the rest of the business
 * rather than sitting in a billing tool.
 */
export function observePayerBehavior(invoices: SettledInvoice[]): PayerObservation {
  if (invoices.length === 0) {
    return {
      sampleSize: 0,
      typicalDaysLate: 0,
      worstDaysLate: 0,
      onTimePct: 100,
      weightedDaysLate: 0,
    };
  }

  const lags = invoices.map(daysLate);
  const onTime = lags.filter((d) => d <= 0).length;
  const totalCents = invoices.reduce((s, i) => s + i.amountCents, 0);
  const weighted =
    totalCents > 0
      ? invoices.reduce((s, i) => s + Math.max(0, daysLate(i)) * i.amountCents, 0) / totalCents
      : 0;

  return {
    sampleSize: invoices.length,
    // Early payment isn't a reason to forecast money arriving before terms.
    typicalDaysLate: Math.max(0, median(lags)),
    worstDaysLate: Math.max(0, ...lags),
    onTimePct: Math.round((onTime / invoices.length) * 1000) / 10,
    weightedDaysLate: Math.round(weighted),
  };
}

/** Days past terms to plan on for a payer, falling back to the company default. */
export function effectiveDaysLate(payer: Payer | undefined, fallbackDays = 0): number {
  if (!payer) return fallbackDays;
  return Math.max(0, payer.typicalDaysLate);
}

/**
 * How late to assume each payer runs in the worst case. Uses the worst lag
 * actually observed for that payer rather than one flat number for everyone —
 * "every payer at their worst" is a scenario the owner has genuinely lived.
 */
export function stressDaysLate(
  payer: Payer | undefined,
  observation: PayerObservation | undefined,
  fallbackDays: number
): number {
  if (observation && observation.sampleSize > 0) {
    return Math.max(observation.worstDaysLate, fallbackDays);
  }
  return Math.max(payer?.typicalDaysLate ?? 0, fallbackDays);
}
