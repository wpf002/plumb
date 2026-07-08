import { describe, it, expect } from "vitest";
import { computeMargin } from "../src/margin.js";
import { computeCashFlow } from "../src/cashflow.js";
import { computeWip } from "../src/wip.js";
import { evaluateBid } from "../src/bid.js";
import { computeHealth } from "../src/health.js";
import { buildDigest } from "../src/digest.js";
import { computeRetainage } from "../src/retainage.js";
import type { Project, CostEntry, CashEvent, BudgetLine } from "@plumb/shared";

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
  billedToDateCents: 480_000_00,
  billingType: "FIXED_PRICE",
  netDays: 30,
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

describe("margin variances", () => {
  it("flags over-budget categories from budget lines", () => {
    const costs: CostEntry[] = [
      { id: "c1", projectId: "p1", category: "MATERIAL", amountCents: 205_000_00, incurredDate: addDays(-40) },
      { id: "c2", projectId: "p1", category: "LABOR", amountCents: 210_000_00, incurredDate: addDays(-60) },
    ];
    const budgets: BudgetLine[] = [
      { category: "MATERIAL", budgetedCostCents: 190_000_00 },
      { category: "LABOR", budgetedCostCents: 380_000_00 },
    ];
    const m = computeMargin(project, costs, [], budgets);
    expect(m.overBudgetCategories).toContain("MATERIAL");
    expect(m.overBudgetCategories).not.toContain("LABOR");
    const mat = m.variances.find((v) => v.category === "MATERIAL")!;
    expect(mat.varianceCents).toBe(15_000_00);
  });
});

describe("wip", () => {
  it("classifies over vs under billing against earned revenue", () => {
    const over = computeWip([{ project, costs: [], changeOrders: [] }]);
    // contract 820k * 55% = 451k earned; billed 480k => overbilled 29k
    expect(over.rows[0].earnedRevenueCents).toBe(451_000_00);
    expect(over.rows[0].overUnderBillingCents).toBe(29_000_00);
    expect(over.rows[0].state).toBe("OVERBILLED");

    const under = computeWip([
      { project: { ...project, billedToDateCents: 300_000_00 }, costs: [], changeOrders: [] },
    ]);
    expect(under.rows[0].state).toBe("UNDERBILLED");
    expect(under.netOverUnderCents).toBeLessThan(0);
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

describe("digest", () => {
  const breachEvents: CashEvent[] = [
    { id: "e1", projectId: null, direction: "OUT", amountCents: 40_000_00, category: "PAYROLL", expectedDate: addDays(5), actualDate: null, status: "EXPECTED" },
    { id: "e2", projectId: null, direction: "IN", amountCents: 120_000_00, category: "PROGRESS_BILLING", expectedDate: addDays(40), actualDate: null, status: "EXPECTED" },
  ];
  const cashInput = {
    events: breachEvents,
    asOf,
    horizonDays: 60,
    safetyThresholdCents: 20_000_00,
    stressDelayDays: 30,
  };

  it("leads with the cash breach as a critical item", () => {
    const cash = computeCashFlow({ ...cashInput, openingCashCents: 45_000_00 });
    const health = computeHealth({
      cash, margins: [], portfolioTargetMarginPct: 14,
      peakUtilization90d: 0.7, arPastDueCents: 0, arOutstandingCents: 0,
    });
    const wip = computeWip([]);
    const d = buildDigest({ asOf, companyName: "Foley", health, cash, wip });
    expect(cash.base.firstBreachDate).not.toBeNull();
    expect(d.items[0].severity).toBe("critical");
    expect(d.headline).toContain("Cash drops below");
  });

  it("nudges to invoice an under-billed job", () => {
    const cash = computeCashFlow({ ...cashInput, openingCashCents: 500_000_00 });
    const health = computeHealth({
      cash, margins: [], portfolioTargetMarginPct: 14,
      peakUtilization90d: 0.7, arPastDueCents: 0, arOutstandingCents: 0,
    });
    const wip = computeWip([
      { project: { ...project, billedToDateCents: 300_000_00 }, costs: [], changeOrders: [] },
    ]);
    const d = buildDigest({
      asOf, companyName: "Foley", health, cash, wip, projectNames: { p1: "Field House" },
    });
    expect(d.items.some((i) => i.title.includes("Field House") && i.title.includes("under-billed"))).toBe(true);
  });

  it("reports a healthy week when nothing needs attention", () => {
    const cash = computeCashFlow({ ...cashInput, openingCashCents: 500_000_00 });
    const health = computeHealth({
      cash, margins: [], portfolioTargetMarginPct: 14,
      peakUtilization90d: 0.7, arPastDueCents: 0, arOutstandingCents: 0,
    });
    const wip = computeWip([]);
    const d = buildDigest({ asOf, companyName: "Foley", health, cash, wip });
    expect(d.items[0].severity).toBe("good");
    expect(d.headline).toContain("good shape");
  });
});

describe("retainage", () => {
  it("computes cash held and projects the release date", () => {
    const r = computeRetainage(
      [
        {
          projectId: "p1",
          projectName: "Field House",
          retainagePct: 10,
          billedToDateCents: 480_000_00,
          endDate: addDays(20),
          netDays: 30,
        },
      ],
      asOf,
      90
    );
    // 10% of 480k billed = 48k held
    expect(r.rows[0].retainageHeldCents).toBe(48_000_00);
    expect(r.totalHeldCents).toBe(48_000_00);
    // ends in 20 days + 30 net = 50 days out, within a 90-day horizon
    expect(r.rows[0].releasesWithinHorizon).toBe(true);
    expect(r.releasingSoonCents).toBe(48_000_00);
  });

  it("excludes retainage releasing beyond the horizon from releasing-soon", () => {
    const r = computeRetainage(
      [
        {
          projectId: "p2",
          projectName: "Tower",
          retainagePct: 5,
          billedToDateCents: 200_000_00,
          endDate: addDays(120),
          netDays: 30,
        },
      ],
      asOf,
      90
    );
    expect(r.totalHeldCents).toBe(10_000_00);
    expect(r.releasingSoonCents).toBe(0);
  });
});

const isoDay = (n: number) => addDays(n).toISOString().slice(0, 10);

describe("cashflow (detailed)", () => {
  const events: CashEvent[] = [
    { id: "o1", projectId: null, direction: "OUT", amountCents: 40_000_00, category: "PAYROLL", expectedDate: addDays(5), actualDate: null, status: "EXPECTED" },
    { id: "o2", projectId: null, direction: "OUT", amountCents: 60_000_00, category: "VENDOR_BILL", expectedDate: addDays(10), actualDate: null, status: "EXPECTED" },
    { id: "i1", projectId: null, direction: "IN", amountCents: 120_000_00, category: "PROGRESS_BILLING", expectedDate: addDays(20), actualDate: null, status: "EXPECTED" },
  ];

  it("covers the horizon and ends on the running balance", () => {
    const r = computeCashFlow({ openingCashCents: 500_000_00, events, asOf, horizonDays: 60, safetyThresholdCents: 20_000_00, stressDelayDays: 30 });
    expect(r.base.series.length).toBe(61); // day 0..60 inclusive
    expect(r.base.series[r.base.series.length - 1].balanceCents).toBe(r.base.endingBalanceCents);
    // 500 - 40 - 60 + 120 = 520k
    expect(r.base.endingBalanceCents).toBe(520_000_00);
  });

  it("flags the first day the balance drops below the floor", () => {
    const r = computeCashFlow({ openingCashCents: 50_000_00, events, asOf, horizonDays: 60, safetyThresholdCents: 20_000_00, stressDelayDays: 30 });
    // 50 - 40 = 10k on day 5, first below the 20k floor
    expect(r.base.firstBreachDate).toBe(isoDay(5));
    expect(r.base.minBalanceCents).toBe(-50_000_00);
    expect(r.base.minBalanceDate).toBe(isoDay(10));
  });

  it("does not breach when opening cash is comfortably above the floor", () => {
    const r = computeCashFlow({ openingCashCents: 500_000_00, events, asOf, horizonDays: 60, safetyThresholdCents: 20_000_00, stressDelayDays: 30 });
    expect(r.base.firstBreachDate).toBeNull();
    expect(r.stress.firstBreachDate).toBeNull();
  });

  it("stress delays receivables but not payables", () => {
    const r = computeCashFlow({ openingCashCents: 50_000_00, events, asOf, horizonDays: 40, safetyThresholdCents: 20_000_00, stressDelayDays: 30 });
    // base gets +120k on day 20; stress pushes it to day 50 (outside a 40d horizon)
    expect(r.base.endingBalanceCents).toBe(70_000_00); // 50-40-60+120
    expect(r.stress.endingBalanceCents).toBe(-50_000_00); // inflow never lands in-horizon
    expect(r.stress.minBalanceCents).toBeLessThanOrEqual(r.base.minBalanceCents);
  });
});

describe("health (detailed)", () => {
  const cleanCash = () => computeCashFlow({ openingCashCents: 500_000_00, events: [], asOf, horizonDays: 90, safetyThresholdCents: 20_000_00, stressDelayDays: 30 });

  const marginAt = (pct: number, atRisk: boolean): any => ({
    projectId: "p", projectName: "Job A", adjustedContractCents: 0, budgetCostCents: 0,
    costToDateCents: 0, projectedFinalCostCents: 0, percentComplete: 0.5,
    originalMarginPct: pct, projectedFinalMarginPct: pct, marginErosionPct: 0,
    costOverrunCents: 0, byCategoryCents: {}, variances: [], overBudgetCategories: [], atRisk,
  });

  it("scores a clean business high with no alerts", () => {
    const h = computeHealth({ cash: cleanCash(), margins: [marginAt(14, false)], portfolioTargetMarginPct: 14, peakUtilization90d: 0.75, arPastDueCents: 0, arOutstandingCents: 100_000_00 });
    expect(h.score).toBeGreaterThanOrEqual(90);
    expect(h.alerts).toHaveLength(0);
    expect(h.components.find((c) => c.key === "capacity")!.score).toBe(90); // 60 + .75*40
  });

  it("zeroes cash and alerts when the worst case breaches the floor", () => {
    const cash = computeCashFlow({
      openingCashCents: 30_000_00,
      events: [{ id: "i", projectId: null, direction: "IN", amountCents: 100_000_00, category: "PROGRESS_BILLING", expectedDate: addDays(10), actualDate: null, status: "EXPECTED" },
               { id: "o", projectId: null, direction: "OUT", amountCents: 20_000_00, category: "PAYROLL", expectedDate: addDays(2), actualDate: null, status: "EXPECTED" }],
      asOf, horizonDays: 90, safetyThresholdCents: 20_000_00, stressDelayDays: 30,
    });
    const h = computeHealth({ cash, margins: [marginAt(14, false)], portfolioTargetMarginPct: 14, peakUtilization90d: 0.75, arPastDueCents: 0, arOutstandingCents: 0 });
    expect(cash.stress.firstBreachDate).not.toBeNull();
    expect(h.alerts.some((a) => /cash/i.test(a))).toBe(true);
  });

  it("names an at-risk project and drops the margin score", () => {
    const h = computeHealth({ cash: cleanCash(), margins: [marginAt(4, true)], portfolioTargetMarginPct: 14, peakUtilization90d: 0.75, arPastDueCents: 0, arOutstandingCents: 0 });
    expect(h.alerts.some((a) => a.includes("Job A"))).toBe(true);
    expect(h.components.find((c) => c.key === "margin")!.score).toBeLessThan(60); // 100 + (4-14)*6 = 40
  });

  it("alerts on an overbooked month and on idle crew", () => {
    const over = computeHealth({ cash: cleanCash(), margins: [marginAt(14, false)], portfolioTargetMarginPct: 14, peakUtilization90d: 1.2, arPastDueCents: 0, arOutstandingCents: 0 });
    expect(over.alerts.some((a) => /overbooked|100%/i.test(a))).toBe(true);
    expect(over.components.find((c) => c.key === "capacity")!.score).toBe(76); // 100 - .2*120

    const idle = computeHealth({ cash: cleanCash(), margins: [marginAt(14, false)], portfolioTargetMarginPct: 14, peakUtilization90d: 0.4, arPastDueCents: 0, arOutstandingCents: 0 });
    expect(idle.alerts.some((a) => /under-booked|bid more/i.test(a))).toBe(true);
  });

  it("alerts when too much A/R is past due", () => {
    const h = computeHealth({ cash: cleanCash(), margins: [marginAt(14, false)], portfolioTargetMarginPct: 14, peakUtilization90d: 0.75, arPastDueCents: 40_000_00, arOutstandingCents: 100_000_00 });
    expect(h.alerts.some((a) => /past due/i.test(a))).toBe(true);
    expect(h.components.find((c) => c.key === "receivables")!.score).toBe(52); // 100 - .4*120
  });
});
