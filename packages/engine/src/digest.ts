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
      title: `Cash drops below your safety floor on ${baseBreach}`,
      detail: `You're on track to fall under ${formatUsd(
        cash.safetyThresholdCents
      )} on ${baseBreach}. Bill early or ease off spending to stay above it.`,
    });
  } else if (stressBreach) {
    items.push({
      severity: "critical",
      title: `Cash could drop below your floor by ${stressBreach} if payers run late`,
      detail: `One slow payer would put you under ${formatUsd(
        cash.safetyThresholdCents
      )} around ${stressBreach}. Worth watching.`,
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
      title: `${name} is under-billed by ${formatUsd(behind)}`,
      detail: `You've done ${formatUsd(
        behind
      )} more work than you've billed here. Send the invoice to bring that cash in sooner.`,
    });
  }

  if (!items.some((i) => i.severity !== "good")) {
    items.push({
      severity: "good",
      title: "You're in good shape this week",
      detail: `Health ${health.score}/100. Cash, margins, crew load, and receivables are all where they should be.`,
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
