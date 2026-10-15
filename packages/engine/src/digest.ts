import { formatUsd as formatCents } from "@plumb/shared";

/** Whole dollars: owners read "$196,800", not "$196,800.00". */
const formatUsd = (cents: number) => formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "");
import type { HealthResult } from "./health.js";
import type { CashFlowResult } from "./cashflow.js";
import type { WipReport } from "./wip.js";
import type { ServiceSummary } from "./services.js";
import type { ObligationSummary } from "./schedule.js";
import type { MilestoneScheduleSummary } from "./milestones.js";

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
  /** Recurring revenue: renewals coming up and client concentration. */
  services?: ServiceSummary;
  /** The monthly fixed nut, for the "does recurring cover it" line. */
  obligations?: ObligationSummary;
  /** Per-project billing schedules, for slipped-milestone nudges. */
  billing?: MilestoneScheduleSummary[];
}

const RANK: Record<DigestSeverity, number> = { critical: 0, warning: 1, good: 2 };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * "2026-10-29" -> "Oct 29". The digest is read by an owner on a phone, not
 * parsed by a machine; formatted in UTC because engine dates are UTC midnight.
 */
function niceDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
      title: `Cash drops below your safety floor on ${niceDay(baseBreach)}`,
      detail: `You're on track to fall under ${formatUsd(
        cash.safetyThresholdCents
      )} on ${niceDay(baseBreach)}. Bill early or ease off spending to stay above it.`,
    });
  } else if (stressBreach) {
    items.push({
      severity: "critical",
      title: `Cash could drop below your floor by ${niceDay(stressBreach)} if payers run late`,
      detail: `One slow payer would put you under ${formatUsd(
        cash.safetyThresholdCents
      )} around ${niceDay(stressBreach)}. Worth watching.`,
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

  // 4. Billing schedule slip — a milestone that moved is money that moved.
  for (const b of input.billing ?? []) {
    if (b.totalSlipDays <= 0) continue;
    const name = names[b.projectId] ?? b.projectId;
    items.push({
      severity: "warning",
      title: `${name}'s billing has slipped ${b.totalSlipDays} days`,
      detail: `${b.slippedCount} milestone${
        b.slippedCount === 1 ? "" : "s"
      } moved out, worth ${formatUsd(b.unbilledCents)} still to bill. That money arrives later than you planned for.`,
    });
  }

  // 5. Recurring revenue: a renewal is the quietest way to lose income, and
  //    concentration is what makes losing one of them matter.
  const services = input.services;
  if (services) {
    for (const r of services.renewals) {
      if (r.shareOfRecurringPct < 10 && r.autoRenew) continue;
      items.push({
        severity: r.shareOfRecurringPct >= 25 && !r.autoRenew ? "critical" : "warning",
        title: `${r.client} — ${r.name} ${r.autoRenew ? "renews" : "must be re-signed"} in ${r.daysAway} days`,
        detail: `${formatUsd(r.monthlyValueCents)} a month, ${
          r.shareOfRecurringPct
        }% of your recurring revenue.${
          r.autoRenew ? "" : " It does not renew on its own."
        }`,
      });
    }
    if (services.largestClientSharePct >= 40 && services.largestClientName) {
      items.push({
        severity: "warning",
        title: `${services.largestClientName} is ${services.largestClientSharePct}% of your recurring revenue`,
        detail: `Losing them would take ${services.largestClientSharePct}% of the income that shows up whether or not you win the next bid.`,
      });
    }
    if (input.obligations && services.monthlyRecurringCents > 0) {
      const coverage = Math.round(
        (services.monthlyRecurringCents / Math.max(1, input.obligations.monthlyFixedCents)) * 100
      );
      items.push({
        severity: "good",
        title: `Recurring work covers ${coverage}% of your monthly fixed cost`,
        detail: `${formatUsd(services.monthlyRecurringCents)} a month against ${formatUsd(
          input.obligations.monthlyFixedCents
        )} of overhead and debt service.`,
      });
    }
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
