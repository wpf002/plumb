import { formatUsd } from "@plumb/shared";
import type { HealthResult } from "./health.js";
import type { CashFlowResult } from "./cashflow.js";
import type { WipReport } from "./wip.js";

// The weekly digest is the "15 minutes a week" promise: the one thing the owner
// must know, plus the short list of what needs attention — delivered so they
// never have to log in. Pure and deterministic; asOf is injected by the caller.

export type DigestSeverity = "critical" | "warning" | "good";

export interface DigestItem {
  severity: DigestSeverity;
  title: string;
  detail: string;
}

export interface DigestResult {
  asOf: string; // YYYY-MM-DD
  companyName: string;
  score: number; // health score 0..100
  /** The single most important message this week. */
  headline: string;
  items: DigestItem[];
}

export interface DigestInput {
  asOf: Date;
  companyName: string;
  health: HealthResult;
  cash: CashFlowResult;
  wip: WipReport;
  /** projectId -> display name, for WIP "bill this now" nudges. */
  projectNames?: Record<string, string>;
}

const RANK: Record<DigestSeverity, number> = { critical: 0, warning: 1, good: 2 };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildDigest(input: DigestInput): DigestResult {
  const { health, cash, wip } = input;
  const items: DigestItem[] = [];
  const names = input.projectNames ?? {};

  // 1. Cash breach — the sharpest signal. Prefer the base (expected) breach;
  //    otherwise flag the worst-case (stress) breach.
  const baseBreach = cash.base.firstBreachDate;
  const stressBreach = cash.stress.firstBreachDate;
  if (baseBreach) {
    items.push({
      severity: "critical",
      title: `Cash dips below your safety floor on ${baseBreach}`,
      detail: `Expected balance breaches ${formatUsd(
        cash.safetyThresholdCents
      )} on ${baseBreach}. Pull invoicing forward or hold spend now.`,
    });
  } else if (stressBreach) {
    items.push({
      severity: "critical",
      title: `Cash breaches your floor on ${stressBreach} if payments slip`,
      detail: `Worst-case (receivables 30 days late) drops below ${formatUsd(
        cash.safetyThresholdCents
      )} on ${stressBreach}. One late payer would cause a crunch.`,
    });
  }

  // 2. Margin-at-risk / capacity / receivables — health already phrased these.
  //    Skip its cash-breach line since we emit a richer critical item above.
  for (const alert of health.alerts) {
    if (/cash/i.test(alert)) continue;
    items.push({ severity: "warning", title: alert, detail: alert });
  }

  // 3. Under-billed jobs — the "invoice this milestone this week" nudge. You've
  //    earned more than you've billed; invoicing converts it to cash sooner.
  const underbilled = wip.rows
    .filter((r) => r.state === "UNDERBILLED")
    .sort((a, b) => a.overUnderBillingCents - b.overUnderBillingCents);
  for (const r of underbilled) {
    const behind = -r.overUnderBillingCents;
    const name = names[r.projectId] ?? r.projectId;
    items.push({
      severity: "warning",
      title: `Bill ${name}: ${formatUsd(behind)} earned but not yet billed`,
      detail: `You've earned ${formatUsd(
        behind
      )} more than you've billed on ${name}. Invoicing this milestone pulls that cash forward.`,
    });
  }

  if (!items.some((i) => i.severity !== "good")) {
    items.push({
      severity: "good",
      title: "Healthy week — nothing needs your attention",
      detail: `Health ${health.score}/100. Cash, margins, crew load, and receivables are all in range.`,
    });
  }

  items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  return {
    asOf: isoDay(input.asOf),
    companyName: input.companyName,
    score: health.score,
    headline: items[0].title,
    items,
  };
}
