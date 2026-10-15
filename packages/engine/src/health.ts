import { type Cents } from "@plumb/shared";
import type { MarginResult } from "./margin.js";
import type { CashFlowResult } from "./cashflow.js";

export interface HealthComponent {
  key: "cash" | "margin" | "capacity" | "receivables";
  label: string;
  score: number; // 0..100
  detail: string;
}

export interface HealthResult {
  score: number; // 0..100 weighted
  components: HealthComponent[];
  alerts: string[];
}

export interface HealthInput {
  cash: CashFlowResult;
  margins: MarginResult[];
  portfolioTargetMarginPct: number;
  /** Peak capacity utilization over the next 90 days, 0..>1. */
  /** Peak crew load over the next quarter; null when no labor plan exists. */
  peakUtilization90d: number | null;
  /** Total A/R past due, and total A/R outstanding. */
  arPastDueCents: Cents;
  arOutstandingCents: Cents;
}

const WEIGHTS = { cash: 0.4, margin: 0.3, capacity: 0.15, receivables: 0.15 };

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeHealth(input: HealthInput): HealthResult {
  const alerts: string[] = [];

  // Cash: penalize proximity of the worst-case breach.
  const breach = input.cash.stress.firstBreachDate;
  let cashScore = 100;
  if (breach) {
    const days =
      (new Date(breach).getTime() -
        new Date(input.cash.stress.series[0].date).getTime()) /
      86_400_000;
    cashScore = clamp((days / 90) * 100);
    alerts.push(
      `If payers run late, your cash falls below its safety floor around ${breach}.`
    );
  }

  // Margin: average projected margin vs portfolio target.
  const avgMargin =
    input.margins.length > 0
      ? input.margins.reduce((a, m) => a + m.projectedFinalMarginPct, 0) /
        input.margins.length
      : input.portfolioTargetMarginPct;
  const marginGap = avgMargin - input.portfolioTargetMarginPct;
  const marginScore = clamp(100 + marginGap * 6); // ~17 pts per margin point
  for (const m of input.margins.filter((x) => x.atRisk)) {
    alerts.push(
      `${m.projectName} is trending to ${m.projectedFinalMarginPct}% margin, ${m.marginErosionPct} points below your bid.`
    );
  }

  // Capacity: penalize both idle and overextension. With no labor plan on file
  // there is nothing to measure, so the score is neutral and nothing is claimed.
  const u = input.peakUtilization90d;
  let capacityScore: number;
  if (u === null) capacityScore = 80;
  else if (u <= 1) capacityScore = clamp(60 + u * 40);
  else capacityScore = clamp(100 - (u - 1) * 120);
  if (u !== null && u > 1)
    alerts.push(
      `Your crew is overbooked next quarter — one month runs at ${Math.round(u * 100)}% of capacity.`
    );
  if (u !== null && u < 0.6)
    alerts.push(
      `Your crew is light next quarter (peaks at ${Math.round(u * 100)}%). Good time to bid more work.`
    );

  // Receivables: share of A/R past due.
  const pastDueShare =
    input.arOutstandingCents > 0
      ? input.arPastDueCents / input.arOutstandingCents
      : 0;
  const receivablesScore = clamp(100 - pastDueShare * 120);
  if (pastDueShare > 0.25)
    alerts.push(
      `${Math.round(pastDueShare * 100)}% of what you're owed is past due. Time to chase it.`
    );

  const components: HealthComponent[] = [
    {
      key: "cash",
      label: "Cash Runway",
      score: cashScore,
      detail: breach ? `Dips low on ${breach}` : "No breach in horizon",
    },
    {
      key: "margin",
      label: "Portfolio Margin",
      score: marginScore,
      detail: `Avg ${avgMargin.toFixed(1)}% vs ${input.portfolioTargetMarginPct}% target`,
    },
    {
      key: "capacity",
      label: "Crew Utilization",
      score: capacityScore,
      detail: u === null ? "No labor plan on file" : `Peaks at ${Math.round(u * 100)}% next 90 days`,
    },
    {
      key: "receivables",
      label: "Receivables",
      score: receivablesScore,
      detail: `${Math.round(pastDueShare * 100)}% past due`,
    },
  ];

  const score = clamp(
    components.reduce((a, c) => a + c.score * WEIGHTS[c.key], 0)
  );

  return { score, components, alerts };
}
