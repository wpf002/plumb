import type { Cents } from "@plumb/shared";
import { addDays } from "@plumb/shared";

/**
 * The 13-week and 12-month cash forecasts.
 *
 * Inputs come in two forms. Dated flows are known items: an open invoice due
 * on a date, a bill, a loan payment, a progress billing. Run-rate streams are
 * recurring amounts with a cadence (weekly payroll, monthly rent, a seasonal
 * service-revenue curve) for things that aren't individually scheduled yet.
 * Both land in weekly or monthly buckets with a line-of-credit model that
 * draws to protect a floor and repays when cash recovers.
 */

export type FlowCategory =
  | "collections"
  | "recurring_receipts"
  | "progress_billings"
  | "service_revenue"
  | "loan_proceeds"
  | "other_inflow"
  | "payroll"
  | "subcontractors"
  | "materials"
  | "payables"
  | "debt_payments"
  | "taxes"
  | "insurance"
  | "rent"
  | "operating_expenses"
  | "capex"
  | "distributions"
  | "other_outflow";

export const INFLOW_CATEGORIES: FlowCategory[] = ["collections", "recurring_receipts", "progress_billings", "service_revenue", "loan_proceeds", "other_inflow"];

export interface DatedFlow {
  date: Date;
  cents: Cents; // positive; direction from category
  category: FlowCategory;
  label: string;
}

export interface Stream {
  category: FlowCategory;
  label: string;
  /** Amount per month before seasonality. */
  monthlyCents: Cents;
  cadence: "weekly" | "biweekly" | "monthly";
  /** Multiplier by calendar month (index 0 = January); default flat. */
  seasonality?: number[];
  /** Day of month for monthly cadence (default 1); weekday offset for weekly. */
  anchorDay?: number;
}

export interface ForecastCase {
  key: "base" | "upside" | "downside";
  /** Scale on revenue-type inflows (collections excluded: already invoiced). */
  revenueFactor: number;
  /** Extra days added to every collection's expected date. */
  collectionDelayDays: number;
  /** Scale on variable costs (materials, subcontractors). */
  variableCostFactor: number;
  /** Include weighted pipeline flows (tagged label prefix "Pipeline"). */
  includePipeline: boolean;
}

export const CASES: Record<ForecastCase["key"], ForecastCase> = {
  base: { key: "base", revenueFactor: 1, collectionDelayDays: 0, variableCostFactor: 1, includePipeline: false },
  upside: { key: "upside", revenueFactor: 1.1, collectionDelayDays: 0, variableCostFactor: 1.1, includePipeline: true },
  downside: { key: "downside", revenueFactor: 0.85, collectionDelayDays: 15, variableCostFactor: 0.9, includePipeline: false },
};

export interface ForecastInput {
  asOf: Date;
  openingCashCents: Cents;
  reserveTargetCents: Cents;
  locLimitCents: Cents;
  locBalanceCents: Cents;
  flows: DatedFlow[];
  streams: Stream[];
}

export interface ForecastBucket {
  label: string;
  start: string;
  end: string;
  beginningCents: Cents;
  inflows: Partial<Record<FlowCategory, Cents>>;
  outflows: Partial<Record<FlowCategory, Cents>>;
  totalInCents: Cents;
  totalOutCents: Cents;
  locDrawCents: Cents;
  locRepayCents: Cents;
  locBalanceCents: Cents;
  endingCents: Cents;
  belowReserve: boolean;
  /** Largest outflows in the bucket, for "why". */
  topOutflows: { label: string; cents: Cents }[];
}

export interface CashForecast {
  case: ForecastCase["key"];
  buckets: ForecastBucket[];
  lowest: { label: string; cents: Cents };
  reserveTargetCents: Cents;
  /** First bucket under the reserve, before any credit draw is considered. */
  shortfall: { label: string; start: string; cents: Cents; explanation: string } | null;
  peakLocCents: Cents;
  locLimitCents: Cents;
  endingCents: Cents;
}

const isInflow = (c: FlowCategory) => INFLOW_CATEGORIES.includes(c);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Expand a stream into dated amounts between `from` (inclusive) and `to` (exclusive). */
export function expandStream(s: Stream, from: Date, to: Date): DatedFlow[] {
  const out: DatedFlow[] = [];
  const season = (d: Date) => s.seasonality?.[d.getUTCMonth()] ?? 1;
  if (s.cadence === "monthly") {
    const day = s.anchorDay ?? 1;
    let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day));
    if (d < from) d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, day));
    while (d < to) {
      out.push({ date: d, cents: Math.round(s.monthlyCents * season(d)), category: s.category, label: s.label });
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day));
    }
    return out;
  }
  const stepDays = s.cadence === "weekly" ? 7 : 14;
  const perOccurrence = (s.monthlyCents * 12) / (365 / stepDays);
  let d = addDays(from, s.anchorDay ?? 4); // default: Friday-ish of the first week
  while (d < to) {
    out.push({ date: d, cents: Math.round(perOccurrence * season(d)), category: s.category, label: s.label });
    d = addDays(d, stepDays);
  }
  return out;
}

function applyCase(flows: DatedFlow[], c: ForecastCase): DatedFlow[] {
  return flows
    .filter((f) => c.includePipeline || !f.label.startsWith("Pipeline"))
    .map((f) => {
      if (f.category === "collections") return { ...f, date: addDays(f.date, c.collectionDelayDays) };
      if (f.category === "progress_billings" || f.category === "recurring_receipts" || f.category === "service_revenue")
        return { ...f, cents: Math.round(f.cents * c.revenueFactor), date: addDays(f.date, c.collectionDelayDays) };
      if (f.category === "materials" || f.category === "subcontractors") return { ...f, cents: Math.round(f.cents * c.variableCostFactor) };
      return f;
    });
}

/**
 * Bucket flows into consecutive windows and walk the balance forward. When the
 * balance would fall below the reserve, draw on the line of credit up to its
 * limit; when it recovers above the reserve, repay.
 */
export function projectCash(
  input: ForecastInput,
  windows: { label: string; start: Date; end: Date }[],
  forecastCase: ForecastCase = CASES.base
): CashForecast {
  const from = windows[0]?.start ?? input.asOf;
  const to = windows.at(-1)?.end ?? input.asOf;
  const all = applyCase([...input.flows, ...input.streams.flatMap((s) => expandStream(s, from, to))], forecastCase);

  let cash = input.openingCashCents;
  let loc = input.locBalanceCents;
  let cashNoLoc = input.openingCashCents;
  let peakLoc = loc;
  let shortfall: CashForecast["shortfall"] = null;
  const buckets: ForecastBucket[] = [];

  for (const w of windows) {
    const inWindow = all.filter((f) => f.date >= w.start && f.date < w.end);
    const inflows: ForecastBucket["inflows"] = {};
    const outflows: ForecastBucket["outflows"] = {};
    const byLabel = new Map<string, number>();
    for (const f of inWindow) {
      if (isInflow(f.category)) inflows[f.category] = (inflows[f.category] ?? 0) + f.cents;
      else {
        outflows[f.category] = (outflows[f.category] ?? 0) + f.cents;
        byLabel.set(f.label, (byLabel.get(f.label) ?? 0) + f.cents);
      }
    }
    const totalIn = Object.values(inflows).reduce((s, v) => s + (v ?? 0), 0);
    const totalOut = Object.values(outflows).reduce((s, v) => s + (v ?? 0), 0);
    const beginning = cash;
    let ending = cash + totalIn - totalOut;
    cashNoLoc += totalIn - totalOut;

    let draw = 0;
    let repay = 0;
    if (ending < input.reserveTargetCents && loc < input.locLimitCents) {
      draw = Math.min(input.locLimitCents - loc, input.reserveTargetCents - ending);
      loc += draw;
      ending += draw;
    } else if (ending > input.reserveTargetCents && loc > 0) {
      repay = Math.min(loc, ending - input.reserveTargetCents);
      loc -= repay;
      ending -= repay;
    }
    peakLoc = Math.max(peakLoc, loc);

    const topOutflows = [...byLabel].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, cents]) => ({ label, cents }));
    if (!shortfall && cashNoLoc < input.reserveTargetCents) {
      const biggest = topOutflows.map((t) => `${t.label} $${Math.round(t.cents / 100).toLocaleString("en-US")}`).join(", ");
      shortfall = {
        label: w.label,
        start: iso(w.start),
        cents: cashNoLoc,
        explanation:
          `${biggest || "Outflows"} land that week against $${Math.round(totalIn / 100).toLocaleString("en-US")} coming in.` +
          (input.locLimitCents > 0 ? ` The line of credit covers up to $${Math.round((input.locLimitCents - input.locBalanceCents) / 100).toLocaleString("en-US")}.` : ""),
      };
    }

    buckets.push({
      label: w.label,
      start: iso(w.start),
      end: iso(addDays(w.end, -1)),
      beginningCents: beginning,
      inflows,
      outflows,
      totalInCents: totalIn,
      totalOutCents: totalOut,
      locDrawCents: draw,
      locRepayCents: repay,
      locBalanceCents: loc,
      endingCents: ending,
      belowReserve: ending < input.reserveTargetCents,
      topOutflows,
    });
    cash = ending;
  }

  const low = buckets.reduce((m, b) => (b.endingCents < m.cents ? { label: b.label, cents: b.endingCents } : m), {
    label: buckets[0]?.label ?? "",
    cents: buckets[0]?.endingCents ?? input.openingCashCents,
  });

  return {
    case: forecastCase.key,
    buckets,
    lowest: low,
    reserveTargetCents: input.reserveTargetCents,
    shortfall,
    peakLocCents: peakLoc,
    locLimitCents: input.locLimitCents,
    endingCents: cash,
  };
}

/**
 * Thirteen weekly windows from the as-of date. When the as-of date falls
 * mid-week the first window runs to the following Monday, and every window
 * after that is a full Monday-to-Sunday week.
 */
export function weekWindows(asOf: Date, weeks = 13) {
  const day = asOf.getUTCDay(); // 0 = Sunday
  const daysToMonday = day === 1 ? 0 : (8 - day) % 7;
  const firstMonday = addDays(asOf, daysToMonday);
  const bounds: Date[] = daysToMonday === 0 ? [] : [asOf];
  for (let i = 0; bounds.length <= weeks; i++) bounds.push(addDays(firstMonday, i * 7));
  return Array.from({ length: weeks }, (_, i) => ({ label: `Wk ${i + 1}`, start: bounds[i], end: bounds[i + 1] }));
}

/** Twelve calendar months after the as-of date. */
export function monthWindows(asOf: Date, months = 12) {
  const first = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));
  const start = addDays(asOf, 1);
  return Array.from({ length: months }, (_, i) => {
    const s = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    const e = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i + 1, 1));
    return { label: s.toISOString().slice(0, 7), start: i === 0 ? start : s, end: e };
  });
}

/** Shift a set of dated flows' collection timing by each payer's habit. */
export function withPayerLateness(flows: DatedFlow[], lateDaysByLabel: Map<string, number>): DatedFlow[] {
  return flows.map((f) => (f.category === "collections" && lateDaysByLabel.has(f.label) ? { ...f, date: addDays(f.date, lateDaysByLabel.get(f.label)!) } : f));
}
