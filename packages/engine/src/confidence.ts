import type { Cents } from "@plumb/shared";

/**
 * How much this forecast should be trusted, and exactly what would raise it.
 *
 * A cash forecast is only as credible as the data under it, and this segment is
 * the least likely to have rigorous bookkeeping. Rather than presenting a
 * confident number over thin data, Plumb states what it knows, what it's
 * guessing, and the specific thing the owner could fix.
 */

export type CheckStatus = "good" | "partial" | "missing";

export interface ConfidenceCheck {
  key: string;
  label: string;
  status: CheckStatus;
  /** What the owner should read: the state of this input, in plain English. */
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
  /** How much this input matters to the forecast, 1-5. */
  weight: number;
}

export interface ConfidenceResult {
  /** 0-100. Weighted share of inputs that are actually in good shape. */
  score: number;
  level: "high" | "medium" | "low";
  checks: ConfidenceCheck[];
  /** The checks worth fixing first — highest weight, worst status. */
  topGaps: ConfidenceCheck[];
  headline: string;
}

export interface ConfidenceInput {
  /** Days since the bank balance was last set. Null when never set. */
  openingCashAgeDays: number | null;
  /** Days since the last successful accounting sync. Null when not connected. */
  lastSyncAgeDays: number | null;
  /** The ledger came from a file import rather than a live connection. */
  ledgerImported?: boolean;
  syncFailing: boolean;
  activeProjectCount: number;
  projectsWithBudget: number;
  projectsWithBillingSchedule: number;
  /** Projects whose milestones don't add up to the contract value. */
  projectsWithIncompleteSchedule: number;
  projectsWithPayer: number;
  payersWithHistory: number;
  payerCount: number;
  recurringExpenseCount: number;
  liabilityCount: number;
  costEntryCount: number;
  costEntriesWithPhase: number;
  monthlyFixedCents: Cents;
}

const STATUS_VALUE: Record<CheckStatus, number> = { good: 1, partial: 0.5, missing: 0 };

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function fromRatio(r: number): CheckStatus {
  if (r >= 0.9) return "good";
  if (r > 0) return "partial";
  return "missing";
}

export function assessConfidence(input: ConfidenceInput): ConfidenceResult {
  const checks: ConfidenceCheck[] = [];

  // 1. Opening cash — every forecast is built on this one number.
  checks.push(
    input.openingCashAgeDays === null
      ? {
          key: "openingCash",
          label: "Bank balance",
          status: "missing",
          detail: "Plumb doesn't know what's in the bank, so it's starting from a placeholder.",
          fix: "Set your opening cash in Settings, or connect your bank.",
          weight: 5,
        }
      : input.openingCashAgeDays > 14
        ? {
            key: "openingCash",
            label: "Bank balance",
            status: "partial",
            detail: `Last updated ${input.openingCashAgeDays} days ago. Every forecast starts from that number.`,
            fix: "Refresh your balance so the starting point is current.",
            weight: 5,
          }
        : {
            key: "openingCash",
            label: "Bank balance",
            status: "good",
            detail: `Current as of ${input.openingCashAgeDays} day${input.openingCashAgeDays === 1 ? "" : "s"} ago.`,
            weight: 5,
          }
  );

  // 2. Accounting sync — the source of actual costs and payment timing.
  checks.push(
    input.lastSyncAgeDays === null && input.ledgerImported
      ? {
          key: "sync",
          label: "QuickBooks",
          status: "good",
          detail: "Ledger loaded from an imported file set; statements reconcile.",
          weight: 5,
        }
      : input.lastSyncAgeDays === null
      ? {
          key: "sync",
          label: "QuickBooks",
          status: "missing",
          detail: "Not connected, so job costs and payment history are whatever was entered by hand.",
          fix: "Connect QuickBooks on the Integrations page.",
          weight: 5,
        }
      : input.syncFailing
        ? {
            key: "sync",
            label: "QuickBooks",
            status: "missing",
            detail: "The last sync failed. Anything that changed since then isn't reflected here.",
            fix: "Reconnect on the Integrations page.",
            weight: 5,
          }
        : input.lastSyncAgeDays > 3
          ? {
              key: "sync",
              label: "QuickBooks",
              status: "partial",
              detail: `Last synced ${input.lastSyncAgeDays} days ago.`,
              fix: "Run a sync to pull in recent bills and invoices.",
              weight: 5,
            }
          : {
              key: "sync",
              label: "QuickBooks",
              status: "good",
              detail: `Synced ${input.lastSyncAgeDays === 0 ? "today" : `${input.lastSyncAgeDays} day(s) ago`}.`,
              weight: 5,
            }
  );

  // 3. Billing schedules — without them, when a job turns into cash is a guess.
  const scheduleRatio = ratio(input.projectsWithBillingSchedule, input.activeProjectCount);
  checks.push({
    key: "billing",
    label: "Billing schedules",
    status: input.projectsWithIncompleteSchedule > 0 ? "partial" : fromRatio(scheduleRatio),
    detail:
      input.activeProjectCount === 0
        ? "No open jobs to schedule."
        : `${input.projectsWithBillingSchedule} of ${input.activeProjectCount} open jobs have one.` +
          (input.projectsWithIncompleteSchedule > 0
            ? ` ${input.projectsWithIncompleteSchedule} don't cover the full contract.`
            : ""),
    fix:
      scheduleRatio < 1 || input.projectsWithIncompleteSchedule > 0
        ? "Add or complete the billing schedule on each job — that's what tells Plumb when the money arrives."
        : undefined,
    weight: 5,
  });

  // 4. Budgets — without them an overrun can't be attributed to anything.
  const budgetRatio = ratio(input.projectsWithBudget, input.activeProjectCount);
  checks.push({
    key: "budgets",
    label: "Job budgets",
    status: input.activeProjectCount === 0 ? "good" : fromRatio(budgetRatio),
    detail:
      input.activeProjectCount === 0
        ? "No open jobs to budget."
        : `${input.projectsWithBudget} of ${input.activeProjectCount} open jobs have a cost breakdown.`,
    fix: budgetRatio < 1 ? "Add budgets so overruns point at a cause instead of a total." : undefined,
    weight: 4,
  });

  // 5. Fixed costs — a forecast missing overhead is optimistic by construction.
  checks.push({
    key: "fixedCosts",
    label: "Overhead and debt",
    status:
      input.recurringExpenseCount > 0 && input.liabilityCount > 0
        ? "good"
        : input.recurringExpenseCount > 0 || input.liabilityCount > 0
          ? "partial"
          : "missing",
    detail:
      input.recurringExpenseCount + input.liabilityCount === 0
        ? "No recurring costs entered, so the forecast only counts job money."
        : `${input.recurringExpenseCount} recurring expense(s) and ${input.liabilityCount} debt(s) are feeding the forecast.`,
    fix:
      input.recurringExpenseCount === 0
        ? "Add your monthly overhead — insurance, fuel, rent, software."
        : input.liabilityCount === 0
          ? "Add loans, cards, and leases so their payments show up."
          : undefined,
    weight: 4,
  });

  // 6. Payer behaviour — terms vs. what actually happens.
  const payerRatio = ratio(input.projectsWithPayer, input.activeProjectCount);
  const historyRatio = ratio(input.payersWithHistory, Math.max(1, input.payerCount));
  checks.push({
    key: "payers",
    label: "Who pays you",
    status:
      input.activeProjectCount === 0
        ? "good"
        : payerRatio >= 1 && historyRatio >= 0.5
          ? "good"
          : payerRatio > 0
            ? "partial"
            : "missing",
    detail:
      input.activeProjectCount === 0
        ? "No open jobs to assign."
        : `${input.projectsWithPayer} of ${input.activeProjectCount} jobs have a payer, and ${input.payersWithHistory} of ${input.payerCount} payers have payment history behind their timing.`,
    fix:
      payerRatio < 1
        ? "Assign a payer to each job — a district and a GC pay nothing alike."
        : historyRatio < 0.5
          ? "Use payment history on your payers to replace the estimate with what they actually do."
          : undefined,
    weight: 3,
  });

  // 7. Cost codes — useful, not load-bearing.
  const phaseRatio = ratio(input.costEntriesWithPhase, input.costEntryCount);
  checks.push({
    key: "costCodes",
    label: "Cost codes",
    status: input.costEntryCount === 0 ? "missing" : fromRatio(phaseRatio),
    detail:
      input.costEntryCount === 0
        ? "No job costs recorded yet."
        : `${Math.round(phaseRatio * 100)}% of job costs are coded to a phase.`,
    fix: phaseRatio < 0.9 ? "Coding costs to phases shows which part of a job is bleeding." : undefined,
    weight: 2,
  });

  // With imported books the forecast runs on the ledger: overhead and debt come
  // from the P&L and collection timing from invoice history, so the manual
  // schedules these checks look for aren't inputs to it.
  if (input.ledgerImported) {
    for (const c of checks) {
      if (c.key === "billing" || c.key === "payers" || c.key === "fixedCosts" || c.key === "costCodes") {
        c.status = "good";
        c.detail = "Drawn from the imported books.";
        c.fix = undefined;
      }
    }
  }

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + c.weight * STATUS_VALUE[c.status], 0);
  const score = Math.round((earned / totalWeight) * 100);
  const level = score >= 80 ? "high" : score >= 55 ? "medium" : "low";

  const topGaps = checks
    .filter((c) => c.status !== "good" && c.fix)
    .sort((a, b) => b.weight * (1 - STATUS_VALUE[b.status]) - a.weight * (1 - STATUS_VALUE[a.status]))
    .slice(0, 3);

  const headline =
    level === "high"
      ? "These numbers are built on complete data."
      : level === "medium"
        ? "These numbers are usable, but a few inputs are missing."
        : "Treat these numbers as a rough sketch until the gaps below are filled.";

  return { score, level, checks, topGaps, headline };
}
