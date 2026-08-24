import type { Cents, ServiceContract } from "@plumb/shared";
import { addDays, addPeriod, monthlyEquivalentCents, sourceKeyFor } from "@plumb/shared";
import type { ProjectedCashEvent } from "./schedule.js";

const MAX_OCCURRENCES = 2000;

/**
 * Expand service contracts into projected inbound cash.
 *
 * Billing runs on the contract's own cadence from its start date; the money
 * lands terms-plus-lateness after each billing, the same rule milestones use.
 */
export function expandServices(
  services: ServiceContract[],
  asOf: Date,
  horizonEnd: Date
): ProjectedCashEvent[] {
  const out: ProjectedCashEvent[] = [];

  for (const c of services) {
    if (c.status !== "ACTIVE" || c.amountCents <= 0) continue;
    const end = c.autoRenew ? c.endDate : c.endDate ?? c.renewalDate;

    let billing = c.startDate;
    let guard = 0;
    while (billing <= horizonEnd && guard++ < MAX_OCCURRENCES) {
      if (end && billing > end) break;
      const due = addDays(billing, c.netDays + (c.payerDaysLate ?? 0));
      if (due >= asOf && due <= horizonEnd) {
        out.push({
          id: `service:${c.id}:${billing.toISOString().slice(0, 10)}`,
          projectId: null,
          direction: "IN",
          amountCents: c.amountCents,
          category: "PROGRESS_BILLING",
          expectedDate: due,
          actualDate: null,
          status: "EXPECTED",
          projected: true,
          origin: "SERVICE",
          originId: c.id,
          sourceKey: sourceKeyFor("SERVICE", c.id, c.billingFrequency, billing),
          label: `${c.client} — ${c.name}`,
        });
      }
      billing = addPeriod(billing, c.billingFrequency);
    }
  }
  return out;
}

export interface ServiceRenewal {
  contractId: string;
  name: string;
  client: string;
  renewalDate: Date;
  daysAway: number;
  monthlyValueCents: Cents;
  /** This contract's share of recurring revenue. */
  shareOfRecurringPct: number;
  autoRenew: boolean;
}

export interface ServiceSummary {
  /** Recurring revenue normalized to a month. */
  monthlyRecurringCents: Cents;
  activeCount: number;
  /** Contracts renewing or ending inside the window, largest exposure first. */
  renewals: ServiceRenewal[];
  /** Share of recurring revenue held by the single largest client. */
  largestClientSharePct: number;
  largestClientName: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the recurring book is worth per month, and what could walk out of it.
 *
 * Concentration matters more than count here: one contract at 40% of recurring
 * revenue is a very different business from ten at 4%.
 */
export function summarizeServices(
  services: ServiceContract[],
  asOf: Date,
  renewalWindowDays = 90
): ServiceSummary {
  const active = services.filter((c) => c.status === "ACTIVE");
  const monthlyOf = (c: ServiceContract) =>
    monthlyEquivalentCents(c.amountCents, c.billingFrequency);
  const monthlyRecurringCents = active.reduce((s, c) => s + monthlyOf(c), 0);

  const byClient = new Map<string, Cents>();
  for (const c of active) byClient.set(c.client, (byClient.get(c.client) ?? 0) + monthlyOf(c));
  let largestClientName: string | null = null;
  let largestCents = 0;
  for (const [client, cents] of byClient) {
    if (cents > largestCents) {
      largestCents = cents;
      largestClientName = client;
    }
  }

  const horizon = addDays(asOf, renewalWindowDays);
  const renewals = active
    .map((c) => ({ c, date: c.renewalDate ?? c.endDate }))
    .filter((r): r is { c: ServiceContract; date: Date } => !!r.date && r.date <= horizon)
    .map(({ c, date }) => ({
      contractId: c.id,
      name: c.name,
      client: c.client,
      renewalDate: date,
      daysAway: Math.round((date.getTime() - asOf.getTime()) / DAY_MS),
      monthlyValueCents: monthlyOf(c),
      shareOfRecurringPct:
        monthlyRecurringCents > 0
          ? Math.round((monthlyOf(c) / monthlyRecurringCents) * 1000) / 10
          : 0,
      autoRenew: c.autoRenew,
    }))
    .sort((a, b) => b.monthlyValueCents - a.monthlyValueCents);

  return {
    monthlyRecurringCents,
    activeCount: active.length,
    renewals,
    largestClientSharePct:
      monthlyRecurringCents > 0
        ? Math.round((largestCents / monthlyRecurringCents) * 1000) / 10
        : 0,
    largestClientName,
  };
}
