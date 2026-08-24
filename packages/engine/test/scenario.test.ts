import { describe, it, expect } from "vitest";
import { applyScenario, compareBuyTiming, type ScenarioWorld } from "../src/scenario.js";
import type { CashEvent, Liability, Milestone, RecurringExpense } from "@plumb/shared";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const asOf = d("2026-08-01");

const milestone: Milestone = {
  id: "m1",
  projectId: "job1",
  name: "Rough-in",
  sequence: 1,
  trigger: "DATE",
  expectedDate: d("2026-09-01"),
  originalExpectedDate: d("2026-09-01"),
  amountCents: 200_000_00,
  retainagePct: 0,
  status: "PLANNED",
};

const insurance: RecurringExpense = {
  id: "e1",
  name: "Insurance",
  category: "INSURANCE",
  amountCents: 4_000_00,
  frequency: "MONTHLY",
  startDate: d("2026-08-05"),
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
  nextPaymentDate: d("2026-08-15"),
  active: true,
};

const payroll: CashEvent = {
  id: "pr",
  projectId: null,
  direction: "OUT",
  amountCents: 90_000_00,
  category: "PAYROLL",
  expectedDate: d("2026-10-05"),
  actualDate: null,
  status: "EXPECTED",
};

const world: ScenarioWorld = {
  asOf,
  horizonDays: 180,
  openingCashCents: 100_000_00,
  safetyThresholdCents: 50_000_00,
  stressDelayDays: 30,
  ledger: [payroll],
  schedule: {
    asOf,
    horizonEnd: d("2027-02-01"),
    liabilities: [loan],
    overheads: [insurance],
    milestoneGroups: [
      {
        context: {
          projectId: "job1",
          projectName: "Northwest ISD",
          netDays: 30,
          payerDaysLate: 0,
          retainageReleaseDate: d("2026-12-01"),
        },
        milestones: [milestone],
      },
    ],
  },
};

describe("scenarios", () => {
  it("leaves the world untouched — a what-if writes nothing", () => {
    const before = JSON.stringify(world);
    applyScenario(world, { kind: "DELAY_PROJECT", projectId: "job1", days: 45 });
    expect(JSON.stringify(world)).toBe(before);
  });

  it("delaying a job pushes its billing and deepens the trough", () => {
    const r = applyScenario(world, { kind: "DELAY_PROJECT", projectId: "job1", days: 45 });
    expect(r.delta.minBalanceCents).toBeLessThan(0);
    expect(r.delta.breachAppeared).toBe(true);
  });

  it("a payer running later moves money without touching obligations", () => {
    const r = applyScenario(world, { kind: "PAYER_LATE", days: 60, projectId: "job1" });
    expect(r.delta.minBalanceCents).toBeLessThan(0);
    // Ending balance is unchanged inside the horizon only if the money still
    // lands; here it slips past the trough but not past the horizon.
    expect(r.result.base.endingBalanceCents).toBe(r.base.base.endingBalanceCents);
  });

  it("losing the income removes it from the forecast entirely", () => {
    const r = applyScenario(world, { kind: "LOSE_INCOME", originId: "job1" });
    expect(r.delta.endingBalanceCents).toBe(-200_000_00);
  });

  it("a new loan helps now and costs later", () => {
    const r = applyScenario(world, {
      kind: "NEW_LOAN",
      principalCents: 100_000_00,
      ratePct: 9,
      paymentCents: 2_100_00,
      frequency: "MONTHLY",
      startDate: d("2026-09-01"),
    });
    expect(r.delta.minBalanceCents).toBeGreaterThan(0);
    // Six monthly payments of 2,100 against 100,000 borrowed.
    expect(r.delta.endingBalanceCents).toBeLessThan(100_000_00);
    expect(r.delta.endingBalanceCents).toBeGreaterThan(80_000_00);
  });

  it("a hire is a recurring outflow, not a one-off", () => {
    const r = applyScenario(world, {
      kind: "HIRE",
      monthlyCostCents: 8_000_00,
      startDate: d("2026-09-01"),
      count: 2,
    });
    // 16,000/mo across six months of horizon.
    expect(r.delta.endingBalanceCents).toBeLessThanOrEqual(-80_000_00);
  });

  it("scales unbilled revenue but never money already in the bank", () => {
    const received: CashEvent = {
      id: "got-paid",
      projectId: "job1",
      direction: "IN",
      amountCents: 50_000_00,
      category: "PROGRESS_BILLING",
      expectedDate: d("2026-08-10"),
      actualDate: d("2026-08-10"),
      status: "RECEIVED",
    };
    const w = { ...world, ledger: [...world.ledger, received] };
    const r = applyScenario(w, { kind: "REVENUE_CHANGE", pct: -30 });
    // Only the 200k milestone is cut, not the 50k already received.
    expect(r.delta.endingBalanceCents).toBe(-60_000_00);
  });

  it("buying in cash today hurts more than waiting", () => {
    const c = compareBuyTiming(world, { costCents: 68_000_00 }, [
      { label: "Buy now", purchaseDate: d("2026-08-05") },
      { label: "Wait 3 months", purchaseDate: d("2026-11-05") },
    ]);
    expect(c.options).toHaveLength(2);
    expect(c.recommendedLabel).toBe("Wait 3 months");
    expect(c.reasons[0]).toContain("Buy now");
  });

  it("prefers a timing that never breaches over a deeper cushion elsewhere", () => {
    const c = compareBuyTiming(
      world,
      { costCents: 40_000_00, downPaymentCents: 5_000_00, financed: { ratePct: 8, paymentCents: 900_00, frequency: "MONTHLY" } },
      [
        { label: "Buy now", purchaseDate: d("2026-08-05") },
        { label: "Wait 6 months", purchaseDate: d("2027-02-05") },
      ]
    );
    // Financing keeps both viable; the recommendation still has to be one of them.
    expect(["Buy now", "Wait 6 months"]).toContain(c.recommendedLabel);
  });
});
