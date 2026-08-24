import { describe, it, expect } from "vitest";
import { observePayerBehavior, effectiveDaysLate, stressDaysLate } from "../src/payers.js";
import { computeCashFlow } from "../src/cashflow.js";
import type { CashEvent, Payer } from "@plumb/shared";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const invoices = [
  { dueDate: d("2026-01-15"), paidDate: d("2026-02-01"), amountCents: 100_000_00 }, // 17
  { dueDate: d("2026-02-15"), paidDate: d("2026-03-04"), amountCents: 120_000_00 }, // 17
  { dueDate: d("2026-03-15"), paidDate: d("2026-03-27"), amountCents: 90_000_00 }, //  12
  { dueDate: d("2026-04-15"), paidDate: d("2026-06-01"), amountCents: 110_000_00 }, // 47
];

describe("payer behaviour", () => {
  it("uses the median so one fight doesn't redefine a reliable payer", () => {
    const o = observePayerBehavior(invoices);
    expect(o.sampleSize).toBe(4);
    expect(o.typicalDaysLate).toBe(17); // median of 12/17/17/47
    expect(o.worstDaysLate).toBe(47);
    expect(o.onTimePct).toBe(0);
  });

  it("weights lateness by dollars, so a big slow invoice hurts more", () => {
    const o = observePayerBehavior(invoices);
    expect(o.weightedDaysLate).toBeGreaterThan(o.typicalDaysLate);
  });

  it("never forecasts money arriving before terms", () => {
    const early = [{ dueDate: d("2026-01-15"), paidDate: d("2026-01-02"), amountCents: 1_000_00 }];
    expect(observePayerBehavior(early).typicalDaysLate).toBe(0);
    expect(observePayerBehavior(early).onTimePct).toBe(100);
  });

  it("reports nothing rather than guessing with no history", () => {
    const o = observePayerBehavior([]);
    expect(o).toMatchObject({ sampleSize: 0, typicalDaysLate: 0, onTimePct: 100 });
  });

  const payer: Payer = {
    id: "p1",
    name: "Rogers-Healy GC",
    type: "GC",
    typicalDaysLate: 41,
    source: "MANUAL",
    sampleSize: 0,
  };

  it("falls back to the company default when a payer is unknown", () => {
    expect(effectiveDaysLate(undefined, 30)).toBe(30);
    expect(effectiveDaysLate(payer, 30)).toBe(41);
  });

  it("stresses each payer at their own worst, never below the floor", () => {
    const o = observePayerBehavior(invoices);
    expect(stressDaysLate(payer, o, 30)).toBe(47); // their worst beats the floor
    expect(stressDaysLate(payer, observePayerBehavior([]), 60)).toBe(60); // floor wins
  });
});

describe("per-payer stress in the forecast", () => {
  const receivable = (projectId: string, iso: string, cents: number): CashEvent => ({
    id: `r-${projectId}`,
    projectId,
    direction: "IN",
    amountCents: cents,
    category: "PROGRESS_BILLING",
    expectedDate: d(iso),
    actualDate: null,
    status: "EXPECTED",
  });

  it("delays a slow payer's money further than a reliable one", () => {
    const events = [receivable("slow", "2026-09-01", 100_000_00), receivable("quick", "2026-09-01", 100_000_00)];
    const r = computeCashFlow({
      openingCashCents: 0,
      asOf: d("2026-08-01"),
      horizonDays: 45, // ends Sep 15
      stressDelayDays: 5,
      stressDelayByProjectId: { slow: 60, quick: 5 },
      safetyThresholdCents: 0,
      events,
    });
    // Base: both land Sep 1. Stress: the quick payer still lands by Sep 6, the
    // slow one falls outside the window entirely.
    expect(r.base.endingBalanceCents).toBe(200_000_00);
    expect(r.stress.endingBalanceCents).toBe(100_000_00);
  });

  it("does not push money that has already been received", () => {
    const paid: CashEvent = {
      ...receivable("p", "2026-08-10", 50_000_00),
      actualDate: d("2026-08-10"),
      status: "RECEIVED",
    };
    const r = computeCashFlow({
      openingCashCents: 0,
      asOf: d("2026-08-01"),
      horizonDays: 20,
      stressDelayDays: 90,
      safetyThresholdCents: 0,
      events: [paid],
    });
    expect(r.stress.endingBalanceCents).toBe(50_000_00);
  });
});
