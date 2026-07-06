import { describe, it, expect } from "vitest";
import { computeMargin } from "../src/margin.js";
import { computeCashFlow } from "../src/cashflow.js";
import { evaluateBid } from "../src/bid.js";
import type { Project, CostEntry, CashEvent } from "@plumb/shared";

const asOf = new Date("2026-07-06T00:00:00Z");
const addDays = (n: number) => {
  const d = new Date(asOf.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

const project: Project = {
  id: "p1",
  name: "Test",
  client: "ISD",
  clientType: "OWNER_DIRECT",
  status: "ACTIVE",
  contractValueCents: 820_000_00,
  originalBidCostCents: 700_000_00,
  targetMarginPct: 14,
  retainagePct: 10,
  startDate: addDays(-90),
  endDate: addDays(60),
  percentComplete: 0.55,
};

describe("margin", () => {
  it("projects final cost by burn rate and flags erosion", () => {
    const costs: CostEntry[] = [
      { id: "c1", projectId: "p1", category: "LABOR", amountCents: 210_000_00, incurredDate: addDays(-60) },
      { id: "c2", projectId: "p1", category: "MATERIAL", amountCents: 205_000_00, incurredDate: addDays(-40) },
    ];
    const m = computeMargin(project, costs, []);
    // 415k spent at 55% complete -> ~754.5k projected final cost
    expect(m.projectedFinalCostCents).toBe(Math.round(415_000_00 / 0.55));
    expect(m.originalMarginPct).toBeCloseTo(14.63, 1);
    expect(m.projectedFinalMarginPct).toBeLessThan(m.originalMarginPct);
    expect(m.atRisk).toBe(true); // eroded below 14% target
  });

  it("applies approved change orders to contract and cost", () => {
    const m = computeMargin(project, [], [
      { id: "co1", projectId: "p1", contractDeltaCents: 50_000_00, costDeltaCents: 30_000_00, status: "APPROVED", date: addDays(-10) },
      { id: "co2", projectId: "p1", contractDeltaCents: 99_000_00, costDeltaCents: 99_000_00, status: "PENDING", date: addDays(-5) },
    ]);
    expect(m.adjustedContractCents).toBe(870_000_00); // pending excluded
    expect(m.budgetCostCents).toBe(730_000_00);
  });
});

describe("cashflow", () => {
  const events: CashEvent[] = [
    { id: "e1", projectId: null, direction: "OUT", amountCents: 40_000_00, category: "PAYROLL", expectedDate: addDays(5), actualDate: null, status: "EXPECTED" },
    { id: "e2", projectId: null, direction: "OUT", amountCents: 60_000_00, category: "VENDOR_BILL", expectedDate: addDays(10), actualDate: null, status: "EXPECTED" },
    { id: "e3", projectId: null, direction: "IN", amountCents: 120_000_00, category: "PROGRESS_BILLING", expectedDate: addDays(20), actualDate: null, status: "EXPECTED" },
  ];

  it("stress scenario delays receivables and deepens the low", () => {
    const r = computeCashFlow({
      openingCashCents: 50_000_00,
      events,
      asOf,
      horizonDays: 60,
      safetyThresholdCents: 20_000_00,
      stressDelayDays: 30,
    });
    // base: 50 -40 -60 +120 = 70k end; low -50k at day10
    expect(r.base.minBalanceCents).toBe(-50_000_00);
    // stress pushes the +120k out 30 days -> low stays -50k longer, same trough
    expect(r.stress.minBalanceCents).toBeLessThanOrEqual(r.base.minBalanceCents);
    expect(r.base.firstBreachDate).not.toBeNull();
  });
});

describe("bid", () => {
  it("passes when a month is physically infeasible to staff", () => {
    const r = evaluateBid(
      {
        contractValueCents: 200_000_00,
        estCostCents: 170_000_00,
        targetMarginPct: 12,
        laborHoursByMonth: { "2026-09": 900 },
      },
      {
        capacity: { monthlyLaborHours: 640 },
        committedHoursByMonth: { "2026-09": 200 },
        projectedMinCashCents: 100_000_00,
        safetyThresholdCents: 50_000_00,
        recentMarginDeltas: [0.5, -0.2],
      }
    );
    expect(r.recommendation).toBe("PASS");
  });

  it("bids aggressively when it fills an under-booked month at target margin", () => {
    const r = evaluateBid(
      {
        contractValueCents: 200_000_00,
        estCostCents: 172_000_00, // 14% margin
        targetMarginPct: 12,
        laborHoursByMonth: { "2026-10": 300 },
      },
      {
        capacity: { monthlyLaborHours: 640 },
        committedHoursByMonth: { "2026-10": 80 }, // very light month
        projectedMinCashCents: 200_000_00,
        safetyThresholdCents: 50_000_00,
        recentMarginDeltas: [1, 2],
      }
    );
    expect(r.recommendation).toBe("BID_AGGRESSIVE");
    expect(r.fillsUnderbookedMonths).toBe(true);
  });
});
