import type {
  CashEvent,
  Cents,
  Liability,
  RecurringExpense,
  ScheduleOrigin,
} from "@plumb/shared";
import { addPeriod, monthlyEquivalentCents, sourceKeyFor } from "@plumb/shared";
import { amortizationSchedule, monthlyDebtServiceCents } from "./liabilities.js";
import { expandMilestones, type MilestoneGroup } from "./milestones.js";

/**
 * A cash event Plumb computed rather than observed. Structurally a `CashEvent`
 * so it drops straight into `computeCashFlow` — the forecast engine never needs
 * to know which of its inputs were projected.
 */
export interface ProjectedCashEvent extends CashEvent {
  projected: true;
  origin: ScheduleOrigin;
  originId: string;
  /** Identity of this obligation-in-this-period. See `sourceKeyFor`. */
  sourceKey: string;
  label: string;
}

export interface ScheduleInput {
  asOf: Date;
  horizonEnd: Date;
  liabilities?: Liability[];
  overheads?: RecurringExpense[];
  /** Billing milestones, grouped by the project whose terms they bill under. */
  milestoneGroups?: MilestoneGroup[];
  /** Keys already settled by a real ledger event. Those projections are dropped. */
  supersededKeys?: Iterable<string>;
}

/** Hard stop so a misconfigured cadence can't run away. */
const MAX_OCCURRENCES = 2000;

function expandRecurring(
  e: RecurringExpense,
  asOf: Date,
  horizonEnd: Date
): ProjectedCashEvent[] {
  const out: ProjectedCashEvent[] = [];
  if (!e.active || e.amountCents <= 0) return out;

  // Walk from the start date so occurrences land on the real cadence rather
  // than on whatever day the forecast happens to be run.
  let date = e.startDate;
  let guard = 0;
  while (date <= horizonEnd && guard++ < MAX_OCCURRENCES) {
    if (e.endDate && date > e.endDate) break;
    if (date >= asOf) {
      out.push({
        id: `overhead:${e.id}:${date.toISOString().slice(0, 10)}`,
        projectId: null,
        direction: "OUT",
        amountCents: e.amountCents,
        category: e.category,
        expectedDate: date,
        actualDate: null,
        status: "EXPECTED",
        projected: true,
        origin: "OVERHEAD",
        originId: e.id,
        sourceKey: sourceKeyFor("OVERHEAD", e.id, e.frequency, date),
        label: e.name,
      });
    }
    date = addPeriod(date, e.frequency);
  }
  return out;
}

function expandLiability(l: Liability, asOf: Date, horizonEnd: Date): ProjectedCashEvent[] {
  return amortizationSchedule(l, asOf, horizonEnd).map((p) => ({
    id: `liability:${l.id}:${p.date.toISOString().slice(0, 10)}`,
    projectId: null,
    direction: "OUT" as const,
    amountCents: p.amountCents,
    // Leases are an operating cost, not debt service, in the cash breakdown.
    category:
      l.kind === "EQUIPMENT_LEASE" || l.kind === "BUILDING_LEASE"
        ? ("OVERHEAD" as const)
        : ("LOAN" as const),
    expectedDate: p.date,
    actualDate: null,
    status: "EXPECTED" as const,
    projected: true as const,
    origin: "LIABILITY" as const,
    originId: l.id,
    sourceKey: sourceKeyFor("LIABILITY", l.id, l.paymentFrequency, p.date),
    label: l.name,
  }));
}

/**
 * Expand every scheduled obligation into the projected cash events the forecast
 * consumes. Anything already settled in the ledger (matched by source key) is
 * dropped, so a real payment never lands on top of its own projection.
 */
export function expandSchedules(input: ScheduleInput): ProjectedCashEvent[] {
  const { asOf, horizonEnd } = input;
  const superseded = new Set(input.supersededKeys ?? []);

  const events: ProjectedCashEvent[] = [
    ...(input.liabilities ?? []).flatMap((l) => expandLiability(l, asOf, horizonEnd)),
    ...(input.overheads ?? []).flatMap((e) => expandRecurring(e, asOf, horizonEnd)),
    ...expandMilestones(input.milestoneGroups ?? [], asOf, horizonEnd),
  ];

  return events.filter((e) => !superseded.has(e.sourceKey));
}

export interface ObligationSummary {
  /** Fixed cost of opening the doors each month: overhead + debt service. */
  monthlyFixedCents: Cents;
  monthlyOverheadCents: Cents;
  monthlyDebtServiceCents: Cents;
  byCategory: { category: CashEvent["category"]; monthlyCents: Cents }[];
}

/** "What's my nut" — the number most owners in this segment can't state. */
export function summarizeObligations(
  overheads: RecurringExpense[],
  liabilities: Liability[]
): ObligationSummary {
  const active = overheads.filter((o) => o.active);
  const monthlyOverheadCents = active.reduce(
    (s, o) => s + monthlyEquivalentCents(o.amountCents, o.frequency),
    0
  );
  const debt = monthlyDebtServiceCents(liabilities);

  const byCategory = new Map<CashEvent["category"], Cents>();
  for (const o of active) {
    byCategory.set(
      o.category,
      (byCategory.get(o.category) ?? 0) + monthlyEquivalentCents(o.amountCents, o.frequency)
    );
  }
  if (debt > 0) byCategory.set("LOAN", (byCategory.get("LOAN") ?? 0) + debt);

  return {
    monthlyFixedCents: monthlyOverheadCents + debt,
    monthlyOverheadCents,
    monthlyDebtServiceCents: debt,
    byCategory: [...byCategory.entries()].map(([category, monthlyCents]) => ({
      category,
      monthlyCents,
    })),
  };
}
