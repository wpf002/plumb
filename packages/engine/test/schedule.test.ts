import { describe, it, expect } from "vitest";
import { expandSchedules, summarizeObligations } from "../src/schedule.js";
import { rollupMonthly } from "../src/cashflow.js";
import { computeCashFlow } from "../src/cashflow.js";
import { sourceKeyFor } from "@plumb/shared";
import type { Liability, RecurringExpense } from "@plumb/shared";

const asOf = new Date("2026-08-01T00:00:00Z");
const horizonEnd = new Date("2026-11-01T00:00:00Z");

const insurance: RecurringExpense = {
  id: "e1",
  name: "General liability insurance",
  category: "INSURANCE",
  amountCents: 1_400_00,
  frequency: "MONTHLY",
  startDate: new Date("2026-01-10T00:00:00Z"),
  active: true,
};

const loan: Liability = {
  id: "l1",
  name: "Truck loan",
  kind: "TERM_LOAN",
  currentBalanceCents: 30_000_00,
  interestRatePct: 6,
  paymentAmountCents: 1_200_00,
  paymentFrequency: "MONTHLY",
  nextPaymentDate: new Date("2026-08-15T00:00:00Z"),
  active: true,
};

describe("schedule expansion", () => {
  it("walks recurring overhead on its own cadence, not from the run date", () => {
    const events = expandSchedules({ asOf, horizonEnd, overheads: [insurance] });
    // Started the 10th of January, so occurrences land on the 10th — Aug/Sep/Oct.
    expect(events.map((e) => e.expectedDate.toISOString().slice(0, 10))).toEqual([
      "2026-08-10",
      "2026-09-10",
      "2026-10-10",
    ]);
    expect(events.every((e) => e.direction === "OUT" && e.amountCents === 1_400_00)).toBe(true);
  });

  it("stops an expense at its end date", () => {
    const ending = { ...insurance, endDate: new Date("2026-09-15T00:00:00Z") };
    expect(expandSchedules({ asOf, horizonEnd, overheads: [ending] })).toHaveLength(2);
  });

  it("skips inactive entries", () => {
    expect(
      expandSchedules({ asOf, horizonEnd, overheads: [{ ...insurance, active: false }] })
    ).toHaveLength(0);
  });

  it("expands liability payments as outflows", () => {
    const events = expandSchedules({ asOf, horizonEnd, liabilities: [loan] });
    expect(events).toHaveLength(3);
    expect(events[0].category).toBe("LOAN");
    expect(events[0].amountCents).toBe(1_200_00);
  });

  it("classifies a lease payment as overhead, not debt service", () => {
    const lease: Liability = {
      ...loan,
      id: "l2",
      kind: "BUILDING_LEASE",
      currentBalanceCents: 0,
      interestRatePct: 0,
      paymentAmountCents: 4_500_00,
    };
    expect(expandSchedules({ asOf, horizonEnd, liabilities: [lease] })[0].category).toBe(
      "OVERHEAD"
    );
  });

  it("drops a projection the ledger already settled", () => {
    const settled = sourceKeyFor("OVERHEAD", insurance.id, "MONTHLY", new Date("2026-09-10T00:00:00Z"));
    const events = expandSchedules({
      asOf,
      horizonEnd,
      overheads: [insurance],
      supersededKeys: [settled],
    });
    expect(events.map((e) => e.expectedDate.toISOString().slice(0, 10))).toEqual([
      "2026-08-10",
      "2026-10-10",
    ]);
  });

  it("supersedes by month, so a bill paid a few days off still matches", () => {
    // Scheduled the 10th, actually paid the 3rd — same month, same obligation.
    const paidEarly = sourceKeyFor("OVERHEAD", insurance.id, "MONTHLY", new Date("2026-09-03T00:00:00Z"));
    const events = expandSchedules({
      asOf,
      horizonEnd,
      overheads: [insurance],
      supersededKeys: [paidEarly],
    });
    expect(events).toHaveLength(2);
  });

  it("never double-counts a settled obligation in the forecast", () => {
    const key = sourceKeyFor("LIABILITY", loan.id, "MONTHLY", new Date("2026-08-15T00:00:00Z"));
    const ledger = [
      {
        id: "real",
        projectId: null,
        direction: "OUT" as const,
        amountCents: 1_200_00,
        category: "LOAN" as const,
        expectedDate: new Date("2026-08-15T00:00:00Z"),
        actualDate: new Date("2026-08-15T00:00:00Z"),
        status: "PAID" as const,
      },
    ];
    const projected = expandSchedules({
      asOf,
      horizonEnd,
      liabilities: [loan],
      supersededKeys: [key],
    });
    const cash = computeCashFlow({
      openingCashCents: 100_000_00,
      asOf,
      horizonDays: 92,
      stressDelayDays: 0,
      safetyThresholdCents: 0,
      events: [...ledger, ...projected],
    });
    // One real payment + two remaining projections = 3 × 1,200, not 4.
    expect(cash.base.endingBalanceCents).toBe(100_000_00 - 3 * 1_200_00);
  });
});

describe("obligation summary", () => {
  it("normalizes cadences into one monthly fixed nut", () => {
    const fuel: RecurringExpense = {
      ...insurance,
      id: "e2",
      name: "Fuel",
      category: "OVERHEAD",
      amountCents: 600_00,
      frequency: "WEEKLY",
    };
    const s = summarizeObligations([insurance, fuel], [loan]);
    // 1,400 + (600 × 52 / 12 = 2,600) overhead, 1,200 debt service.
    expect(s.monthlyOverheadCents).toBe(4_000_00);
    expect(s.monthlyDebtServiceCents).toBe(1_200_00);
    expect(s.monthlyFixedCents).toBe(5_200_00);
  });
});

describe("monthly rollup", () => {
  it("reports each month's ending balance and its low point", () => {
    const months = rollupMonthly([
      { date: "2026-08-01", balanceCents: 100_00 },
      { date: "2026-08-20", balanceCents: 40_00 },
      { date: "2026-08-31", balanceCents: 80_00 },
      { date: "2026-09-30", balanceCents: 120_00 },
    ]);
    expect(months).toEqual([
      { month: "2026-08", endingBalanceCents: 80_00, lowBalanceCents: 40_00, lowDate: "2026-08-20" },
      { month: "2026-09", endingBalanceCents: 120_00, lowBalanceCents: 120_00, lowDate: "2026-09-30" },
    ]);
  });
});
