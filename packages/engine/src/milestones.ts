import type { Cents, Milestone } from "@plumb/shared";
import { addDays, milestoneSourceKey } from "@plumb/shared";
import type { ProjectedCashEvent } from "./schedule.js";

export interface MilestoneContext {
  projectId: string;
  projectName: string;
  /** Contract payment terms. */
  netDays: number;
  /**
   * Days this payer typically runs past terms. Zero until payer behaviour is
   * modelled; set per-payer in Phase 11.
   */
  payerDaysLate?: number;
  /** Substantial completion — when held-back retainage is released. */
  retainageReleaseDate: Date;
}

export interface MilestoneGroup {
  context: MilestoneContext;
  milestones: Milestone[];
}

/** When the money from a milestone actually lands. */
export function expectedReceiptDate(m: Milestone, ctx: MilestoneContext): Date {
  // Once billed, the clock runs from the invoice date, not the planned date.
  const invoiceDate = m.billedAt ?? m.expectedDate;
  return addDays(invoiceDate, ctx.netDays + (ctx.payerDaysLate ?? 0));
}

/** The cash a milestone releases now, and the slice held back as retainage. */
export function splitRetainage(m: Milestone): { netCents: Cents; retainageCents: Cents } {
  const retainageCents = Math.round((m.amountCents * m.retainagePct) / 100);
  return { netCents: m.amountCents - retainageCents, retainageCents };
}

/**
 * Expand billing milestones into projected inbound cash.
 *
 * A milestone produces up to two events: the net progress payment when the
 * invoice comes due, and the retainage slice at substantial completion. A
 * milestone already marked paid produces nothing — its money is in the ledger.
 */
export function expandMilestones(
  groups: MilestoneGroup[],
  asOf: Date,
  horizonEnd: Date
): ProjectedCashEvent[] {
  const out: ProjectedCashEvent[] = [];

  for (const { context, milestones } of groups) {
    for (const m of milestones) {
      if (m.status === "PAID" || m.paidAt) continue;
      const { netCents, retainageCents } = splitRetainage(m);
      const due = expectedReceiptDate(m, context);

      if (netCents > 0 && due >= asOf && due <= horizonEnd) {
        out.push({
          id: `milestone:${m.id}`,
          projectId: m.projectId,
          direction: "IN",
          amountCents: netCents,
          category: "PROGRESS_BILLING",
          expectedDate: due,
          actualDate: null,
          status: "EXPECTED",
          projected: true,
          origin: "MILESTONE",
          originId: m.id,
          sourceKey: milestoneSourceKey(m.id),
          label: `${context.projectName} — ${m.name}`,
        });
      }

      // Retainage is held until completion regardless of when the milestone
      // itself bills, so it is keyed separately and dated to the release.
      const release = addDays(context.retainageReleaseDate, context.netDays);
      if (retainageCents > 0 && release >= asOf && release <= horizonEnd) {
        out.push({
          id: `milestone-retainage:${m.id}`,
          projectId: m.projectId,
          direction: "IN",
          amountCents: retainageCents,
          category: "RETAINAGE_RELEASE",
          expectedDate: release,
          actualDate: null,
          status: "EXPECTED",
          projected: true,
          origin: "MILESTONE",
          originId: m.id,
          sourceKey: `${milestoneSourceKey(m.id)}:RETAINAGE`,
          label: `${context.projectName} — retainage on ${m.name}`,
        });
      }
    }
  }
  return out;
}

export interface MilestoneScheduleSummary {
  projectId: string;
  contractValueCents: Cents;
  scheduledCents: Cents;
  /** Contract value not yet covered by any milestone. */
  unscheduledCents: Cents;
  billedCents: Cents;
  unbilledCents: Cents;
  retainageHeldCents: Cents;
  count: number;
  slippedCount: number;
  /** Total days of slip across every milestone that moved. */
  totalSlipDays: number;
  nextMilestone: { id: string; name: string; expectedDate: Date; amountCents: Cents } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function slipDays(m: Milestone): number {
  return Math.round((m.expectedDate.getTime() - m.originalExpectedDate.getTime()) / DAY_MS);
}

export function summarizeMilestones(
  projectId: string,
  contractValueCents: Cents,
  milestones: Milestone[],
  asOf: Date
): MilestoneScheduleSummary {
  const scheduledCents = milestones.reduce((s, m) => s + m.amountCents, 0);
  const billed = milestones.filter((m) => m.status === "BILLED" || m.status === "PAID");
  const billedCents = billed.reduce((s, m) => s + m.amountCents, 0);
  const retainageHeldCents = milestones
    .filter((m) => m.status !== "PAID")
    .reduce((s, m) => s + splitRetainage(m).retainageCents, 0);

  const slipped = milestones.filter((m) => slipDays(m) !== 0);
  const upcoming = milestones
    .filter((m) => m.status === "PLANNED" || m.status === "READY")
    .filter((m) => m.expectedDate >= asOf)
    .sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime())[0];

  return {
    projectId,
    contractValueCents,
    scheduledCents,
    unscheduledCents: contractValueCents - scheduledCents,
    billedCents,
    unbilledCents: scheduledCents - billedCents,
    retainageHeldCents,
    count: milestones.length,
    slippedCount: slipped.length,
    totalSlipDays: slipped.reduce((s, m) => s + slipDays(m), 0),
    nextMilestone: upcoming
      ? {
          id: upcoming.id,
          name: upcoming.name,
          expectedDate: upcoming.expectedDate,
          amountCents: upcoming.amountCents,
        }
      : null,
  };
}

export interface GeneratedMilestone {
  name: string;
  sequence: number;
  expectedDate: Date;
  amountCents: Cents;
}

/**
 * Draft a billing schedule so entering a twelve-milestone contract isn't
 * punishing. Splits the contract into `count` even payments spaced evenly
 * across the job, with the rounding remainder on the last one so the schedule
 * always sums to the contract exactly.
 */
export function generateMilestones(
  contractValueCents: Cents,
  startDate: Date,
  endDate: Date,
  count: number
): GeneratedMilestone[] {
  if (count < 1) return [];
  const span = endDate.getTime() - startDate.getTime();
  const per = Math.floor(contractValueCents / count);

  return Array.from({ length: count }, (_, i) => {
    const last = i === count - 1;
    return {
      name: `Progress billing ${i + 1} of ${count}`,
      sequence: i + 1,
      // Bill at the end of each interval — you invoice work already done.
      expectedDate: new Date(startDate.getTime() + (span * (i + 1)) / count),
      amountCents: last ? contractValueCents - per * (count - 1) : per,
    };
  });
}
