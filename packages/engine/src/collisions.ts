import type { CashEvent, Cents } from "@plumb/shared";
import { addDays } from "@plumb/shared";
import type { ProjectedCashEvent } from "./schedule.js";

export interface CollisionItem {
  label: string;
  direction: "IN" | "OUT";
  amountCents: Cents;
  date: string;
  /** True when this inflow depends on a payer who runs late. */
  atRisk?: boolean;
}

export interface CashCollision {
  weekStart: string;
  weekEnd: string;
  outflowCents: Cents;
  inflowCents: Cents;
  /** Inflow in this week that depends on a payer known to run late. */
  atRiskInflowCents: Cents;
  /** Balance at the end of the week if the at-risk money doesn't show up. */
  balanceIfLateCents: Cents;
  items: CollisionItem[];
}

export interface CollisionInput {
  asOf: Date;
  horizonDays: number;
  openingCashCents: Cents;
  safetyThresholdCents: Cents;
  events: (CashEvent | ProjectedCashEvent)[];
  /** projectId -> days that payer typically runs past terms. */
  payerDaysLateByProject?: Record<string, number>;
  /** projectId -> display name, for readable labels. */
  projectNames?: Record<string, string>;
}

const WEEK = 7;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function labelOf(e: CashEvent | ProjectedCashEvent, names: Record<string, string>): string {
  if ("label" in e && e.label) return e.label;
  const name = e.projectId ? names[e.projectId] : undefined;
  return name ? `${name} — ${e.category.toLowerCase().replace(/_/g, " ")}` : e.category.toLowerCase().replace(/_/g, " ");
}

/**
 * Find the weeks where obligations land on top of money that may not arrive.
 *
 * This is the collision the spec asks for — "a liability payment landing in the
 * same week as a delayed invoice" — and it isn't expressible until obligations
 * and billings are structured data rather than a flat ledger. A week is
 * reported when its outflows are covered only by inflows from payers who are
 * known to run late: on paper it's fine, in practice it's the week the owner
 * scrambles.
 */
export function detectCollisions(input: CollisionInput): CashCollision[] {
  const { asOf, horizonDays, openingCashCents, events } = input;
  const lateBy = input.payerDaysLateByProject ?? {};
  const names = input.projectNames ?? {};

  const weeks: CashCollision[] = [];
  let balance = openingCashCents;

  for (let offset = 0; offset < horizonDays; offset += WEEK) {
    const start = addDays(asOf, offset);
    const end = addDays(asOf, Math.min(offset + WEEK, horizonDays));
    const inWeek = events.filter((e) => {
      const d = e.actualDate ?? e.expectedDate;
      return d >= start && d < end;
    });

    let outflowCents = 0;
    let inflowCents = 0;
    let atRiskInflowCents = 0;
    const items: CollisionItem[] = [];

    for (const e of inWeek) {
      const date = isoDay(e.actualDate ?? e.expectedDate);
      if (e.direction === "OUT") {
        outflowCents += e.amountCents;
        items.push({ label: labelOf(e, names), direction: "OUT", amountCents: e.amountCents, date });
      } else {
        inflowCents += e.amountCents;
        // Money already received can't fail to show up.
        const atRisk = !e.actualDate && !!e.projectId && (lateBy[e.projectId] ?? 0) > 0;
        if (atRisk) atRiskInflowCents += e.amountCents;
        items.push({
          label: labelOf(e, names),
          direction: "IN",
          amountCents: e.amountCents,
          date,
          atRisk,
        });
      }
    }

    const balanceAfter = balance + inflowCents - outflowCents;
    const balanceIfLateCents = balance + (inflowCents - atRiskInflowCents) - outflowCents;

    // Worth reporting only when the week is fine on paper but not if the
    // at-risk money slips.
    const collides =
      outflowCents > 0 &&
      atRiskInflowCents > 0 &&
      balanceAfter >= input.safetyThresholdCents &&
      balanceIfLateCents < input.safetyThresholdCents;

    if (collides) {
      weeks.push({
        weekStart: isoDay(start),
        weekEnd: isoDay(addDays(end, -1)),
        outflowCents,
        inflowCents,
        atRiskInflowCents,
        balanceIfLateCents,
        items: items.sort((a, b) => b.amountCents - a.amountCents).slice(0, 6),
      });
    }

    balance = balanceAfter;
  }

  return weeks;
}
