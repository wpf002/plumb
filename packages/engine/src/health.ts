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
  peakUtilization90d: number;
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
      `Worst-case cash dips below your safety threshold on ${breach} (${Math.round(days)} days out).`
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
      `${m.projectName} projected at ${m.projectedFinalMarginPct}% margin (${m.marginErosionPct} pts eroded since bid).`
    );
  }

  // Capacity: penalize both idle and overextension.
  const u = input.peakUtilization90d;
  let capacityScore: number;
  if (u <= 1) capacityScore = clamp(60 + u * 40);
  else capacityScore = clamp(100 - (u - 1) * 120);
  if (u > 1)
    alerts.push(
      `Peak 90-day capacity hits ${Math.round(u * 100)}% — a month is overbooked.`
    );
  if (u < 0.6)
    alerts.push(
      `Crew is under-booked over the next 90 days (peak ${Math.round(u * 100)}%). Time to bid more.`
    );

  // Receivables: share of A/R past due.
  const pastDueShare =
    input.arOutstandingCents > 0
      ? input.arPastDueCents / input.arOutstandingCents
      : 0;
  const receivablesScore = clamp(100 - pastDueShare * 120);
  if (pastDueShare > 0.25)
    alerts.push(
      `${Math.round(pastDueShare * 100)}% of outstanding A/R is past due — chase it.`
    );

  const components: HealthComponent[] = [
    {
      key: "cash",
      label: "Cash runway",
      score: cashScore,
      detail: breach ? `Breach ${breach}` : "No breach in horizon",
    },
    {
      key: "margin",
      label: "Portfolio margin",
      score: marginScore,
      detail: `Avg ${avgMargin.toFixed(1)}% vs ${input.portfolioTargetMarginPct}% target`,
    },
    {
      key: "capacity",
      label: "Crew utilization",
      score: capacityScore,
      detail: `Peak ${Math.round(u * 100)}% next 90d`,
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
