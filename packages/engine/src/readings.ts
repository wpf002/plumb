/**
 * Owner-language readings for financial ratios.
 *
 * "Current ratio: 1.3" means nothing to most owners; "Tight but manageable"
 * does. Each reading returns a short phrase and a tone the UI colors by. The
 * thresholds are conventional small-business lending rules of thumb.
 */

export type Tone = "good" | "warn" | "bad" | "neutral";

export interface Reading {
  label: string;
  tone: Tone;
}

export function currentRatioReading(r: number | null): Reading {
  if (r === null) return { label: "Not enough data", tone: "neutral" };
  if (r >= 2) return { label: "Strong", tone: "good" };
  if (r >= 1.5) return { label: "Healthy", tone: "good" };
  if (r >= 1.1) return { label: "Tight but Manageable", tone: "warn" };
  return { label: "Under Pressure", tone: "bad" };
}

export function quickRatioReading(r: number | null): Reading {
  if (r === null) return { label: "Not enough data", tone: "neutral" };
  if (r >= 1.2) return { label: "Bills Covered Without Inventory", tone: "good" };
  if (r >= 0.9) return { label: "Just Covered", tone: "warn" };
  return { label: "Relies on Future Billing", tone: "bad" };
}

/** Debt-service coverage: trailing EBITDA over a year of loan payments. */
export function dscrReading(r: number | null): Reading {
  if (r === null) return { label: "No Debt Service", tone: "good" };
  if (r >= 2) return { label: "Comfortable", tone: "good" };
  if (r >= 1.25) return { label: "Bankable", tone: "good" };
  if (r >= 1) return { label: "Thin", tone: "warn" };
  return { label: "Payments Exceed Earnings", tone: "bad" };
}

export function debtToEquityReading(r: number | null): Reading {
  if (r === null) return { label: "Not enough data", tone: "neutral" };
  if (r <= 0.5) return { label: "Lightly Leveraged", tone: "good" };
  if (r <= 1.5) return { label: "Moderate", tone: "good" };
  if (r <= 3) return { label: "Heavily Financed", tone: "warn" };
  return { label: "Over-Leveraged", tone: "bad" };
}

export function grossMarginReading(pct: number, priorPct: number | null): Reading {
  if (priorPct !== null && pct < priorPct - 2) return { label: `Down ${(priorPct - pct).toFixed(1)} pts`, tone: "warn" };
  if (priorPct !== null && pct > priorPct + 2) return { label: `Up ${(pct - priorPct).toFixed(1)} pts`, tone: "good" };
  return { label: "Steady", tone: "neutral" };
}

export function locUtilizationReading(pct: number | null): Reading {
  if (pct === null) return { label: "No Line of Credit", tone: "neutral" };
  if (pct === 0) return { label: "Untouched", tone: "good" };
  if (pct < 50) return { label: "Partly Drawn", tone: "neutral" };
  if (pct < 90) return { label: "Heavily Drawn", tone: "warn" };
  return { label: "Maxed Out", tone: "bad" };
}

export function runwayReading(months: number | null): Reading {
  if (months === null) return { label: "Cash-Positive", tone: "good" };
  if (months >= 6) return { label: `${Math.round(months)} Months of Cover`, tone: "good" };
  if (months >= 3) return { label: `${Math.round(months)} Months of Cover`, tone: "warn" };
  return { label: `${Math.max(0, Math.round(months * 10) / 10)} Months of Cover`, tone: "bad" };
}

/** Overall short-term position from the ratios that matter most to a sub. */
export function shortTermPosition(currentRatio: number | null, cashMonths: number | null): Reading {
  const cr = currentRatioReading(currentRatio);
  if (cr.tone === "bad" || (cashMonths !== null && cashMonths < 1.5)) return { label: "Under Pressure", tone: "bad" };
  if (cr.tone === "warn" || (cashMonths !== null && cashMonths < 3)) return { label: "Tight but Manageable", tone: "warn" };
  return { label: "Solid", tone: "good" };
}
