import type { Cents } from "@plumb/shared";

/**
 * Revenue forecast by month, built two ways and then combined.
 *
 * Project work: signed backlog recognized across each job's remaining
 * schedule (or its billing milestones when it has them), plus pipeline
 * weighted by win probability from its expected start.
 *
 * Service work: recurring and service revenue projected from the same month
 * last year, grown at the trailing year-over-year rate. That keeps seasonality
 * (a landscaper's summer peak, an HVAC company's shoulder months) without
 * fitting a model to four years of data.
 */

export interface SignedJob {
  id: string;
  name: string;
  remainingCents: Cents;
  start: Date;
  end: Date;
  /** Billing milestones not yet billed, when the job has a schedule. */
  milestones?: { date: Date; cents: Cents }[];
}

export interface PipelineDeal {
  id: string;
  name: string;
  valueCents: Cents;
  probabilityPct: number;
  expectedStart: Date | null;
  durationMonths: number;
}

export interface MonthForecast {
  month: string;
  signedCents: Cents;
  /**
   * Project revenue the business historically books but hasn't signed yet:
   * the seasonal project run-rate minus what signed work already covers.
   */
  unsignedCents: Cents;
  pipelineCents: Cents;
  recurringCents: Cents;
  serviceCents: Cents;
  totalCents: Cents;
}

export interface RevenueForecast {
  months: MonthForecast[];
  totals: { signed: Cents; unsigned: Cents; pipeline: Cents; recurring: Cents; service: Cents; likely: Cents; total: Cents };
  growth: { recurringYoYPct: number | null; serviceYoYPct: number | null };
}

export const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const shift = (period: string, n: number) => {
  const [y, m] = period.split("-").map(Number);
  return monthKeyOf(new Date(Date.UTC(y, m - 1 + n, 1)));
};

/** The `count` months after the as-of month. */
export function nextMonths(asOf: Date, count = 12): string[] {
  const base = monthKeyOf(asOf);
  return Array.from({ length: count }, (_, i) => shift(base, i + 1));
}

/** Spread an amount evenly over the months a window covers, limited to `months`. */
function spread(cents: Cents, from: Date, to: Date, months: string[]): Map<string, Cents> {
  const out = new Map<string, Cents>();
  const covered = months.filter((m) => m >= monthKeyOf(from) && m <= monthKeyOf(to));
  if (covered.length === 0) {
    // A job whose remaining schedule is already past still has work left:
    // recognize it in the first forecast month rather than drop it.
    if (monthKeyOf(to) < months[0] && cents > 0) out.set(months[0], cents);
    return out;
  }
  const allMonths = Math.max(1, monthsBetween(from, to) + 1);
  const per = cents / allMonths;
  for (const m of covered) out.set(m, Math.round(per));
  return out;
}

function monthsBetween(a: Date, b: Date) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
}

/** Trailing year-over-year growth of a monthly series, capped to +/- 25%. */
export function trailingGrowth(history: Map<string, Cents>, asOfMonth: string): number | null {
  const last12 = Array.from({ length: 12 }, (_, i) => shift(asOfMonth, -i));
  const prior12 = last12.map((m) => shift(m, -12));
  if (!prior12.every((m) => history.has(m))) return null;
  const now = last12.reduce((s, m) => s + (history.get(m) ?? 0), 0);
  const was = prior12.reduce((s, m) => s + (history.get(m) ?? 0), 0);
  if (was <= 0) return null;
  return Math.max(-0.25, Math.min(0.25, now / was - 1));
}

/** Same month last year, grown at the trailing rate. Falls back to the trailing average. */
export function seasonalProjection(history: Map<string, Cents>, asOf: Date, months: string[]): Map<string, Cents> {
  const asOfMonth = monthKeyOf(asOf);
  const g = trailingGrowth(history, asOfMonth) ?? 0;
  const recent = Array.from({ length: 3 }, (_, i) => history.get(shift(asOfMonth, -i))).filter((v): v is number => v !== undefined);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const out = new Map<string, Cents>();
  for (const m of months) {
    const ly = history.get(shift(m, -12));
    out.set(m, Math.round(ly !== undefined ? ly * (1 + g) : avg));
  }
  return out;
}

/**
 * Trailing-twelve-month average grown at the trailing rate, flat across months.
 * Project revenue follows backlog and scheduling more than the calendar, so a
 * seasonal projection overfits one year's timing; recurring and service work
 * keep the seasonal method.
 */
export function runRateProjection(history: Map<string, Cents>, asOf: Date, months: string[]): Map<string, Cents> {
  const asOfMonth = monthKeyOf(asOf);
  const last12 = Array.from({ length: 12 }, (_, i) => history.get(shift(asOfMonth, -i))).filter((v): v is number => v !== undefined);
  const avg = last12.length ? last12.reduce((a, b) => a + b, 0) / last12.length : 0;
  const g = trailingGrowth(history, asOfMonth) ?? 0;
  return new Map(months.map((m) => [m, Math.round(avg * (1 + g))]));
}

export function forecastRevenue(input: {
  asOf: Date;
  signed: SignedJob[];
  pipeline: PipelineDeal[];
  recurringHistory: Map<string, Cents>;
  serviceHistory: Map<string, Cents>;
  /** Monthly project revenue history; enables the unsigned run-rate fill. */
  projectHistory?: Map<string, Cents>;
  months?: number;
}): RevenueForecast {
  const months = nextMonths(input.asOf, input.months ?? 12);
  const signed = new Map<string, Cents>();
  for (const j of input.signed) {
    const parts =
      j.milestones && j.milestones.length
        ? new Map(j.milestones.filter((m) => months.includes(monthKeyOf(m.date))).map((m) => [monthKeyOf(m.date), m.cents]))
        : spread(j.remainingCents, j.start > input.asOf ? j.start : input.asOf, j.end, months);
    for (const [m, v] of parts) signed.set(m, (signed.get(m) ?? 0) + v);
  }
  const pipeline = new Map<string, Cents>();
  for (const d of input.pipeline) {
    const start = d.expectedStart ?? input.asOf;
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + Math.max(0, d.durationMonths - 1), 1));
    const weighted = Math.round((d.valueCents * d.probabilityPct) / 100);
    for (const [m, v] of spread(weighted, start, end, months)) pipeline.set(m, (pipeline.get(m) ?? 0) + v);
  }
  const recurring = seasonalProjection(input.recurringHistory, input.asOf, months);
  const service = seasonalProjection(input.serviceHistory, input.asOf, months);
  // Backlog alone is a floor: project businesses keep selling. Fill the gap
  // between signed work and the seasonal project run-rate as expected new work.
  // Half seasonal, half trailing run-rate: project work has some calendar shape
  // (outdoor installs peak in summer) but follows backlog more than season.
  let projectRun: Map<string, Cents> | null = null;
  if (input.projectHistory?.size) {
    const seasonal = seasonalProjection(input.projectHistory, input.asOf, months);
    const flat = runRateProjection(input.projectHistory, input.asOf, months);
    projectRun = new Map(months.map((m) => [m, Math.round(((seasonal.get(m) ?? 0) + (flat.get(m) ?? 0)) / 2)]));
  }

  const rows: MonthForecast[] = months.map((m) => {
    const s = signed.get(m) ?? 0;
    const p = pipeline.get(m) ?? 0;
    const r = input.recurringHistory.size ? recurring.get(m) ?? 0 : 0;
    const v = input.serviceHistory.size ? service.get(m) ?? 0 : 0;
    const u = projectRun ? Math.max(0, (projectRun.get(m) ?? 0) - s) : 0;
    // Weighted pipeline is shown, not added: it is part of what the run-rate fill expects to win.
    return { month: m, signedCents: s, unsignedCents: u, pipelineCents: p, recurringCents: r, serviceCents: v, totalCents: s + u + r + v };
  });
  const sum = (k: keyof MonthForecast) => rows.reduce((t, r) => t + (r[k] as number), 0);
  const asOfMonth = monthKeyOf(input.asOf);
  const pctOrNull = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
  return {
    months: rows,
    totals: {
      signed: sum("signedCents"),
      unsigned: sum("unsignedCents"),
      pipeline: sum("pipelineCents"),
      recurring: sum("recurringCents"),
      service: sum("serviceCents"),
      likely: sum("totalCents"),
      total: sum("totalCents"),
    },
    growth: {
      recurringYoYPct: pctOrNull(trailingGrowth(input.recurringHistory, asOfMonth)),
      serviceYoYPct: pctOrNull(trailingGrowth(input.serviceHistory, asOfMonth)),
    },
  };
}

/** Mean absolute percentage error of a forecast against what happened. */
export function forecastError(forecast: Map<string, Cents>, actual: Map<string, Cents>): { months: number; mapePct: number; biasPct: number } {
  const ms = [...forecast.keys()].filter((m) => actual.has(m) && (actual.get(m) ?? 0) !== 0);
  if (ms.length === 0) return { months: 0, mapePct: 0, biasPct: 0 };
  let ape = 0;
  let fSum = 0;
  let aSum = 0;
  for (const m of ms) {
    const a = actual.get(m)!;
    const f = forecast.get(m)!;
    ape += Math.abs(f - a) / Math.abs(a);
    fSum += f;
    aSum += a;
  }
  return { months: ms.length, mapePct: Math.round((ape / ms.length) * 1000) / 10, biasPct: Math.round((fSum / aSum - 1) * 1000) / 10 };
}
