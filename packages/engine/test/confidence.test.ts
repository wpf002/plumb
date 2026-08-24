import { describe, it, expect } from "vitest";
import { assessConfidence, type ConfidenceInput } from "../src/confidence.js";

const complete: ConfidenceInput = {
  openingCashAgeDays: 1,
  lastSyncAgeDays: 0,
  syncFailing: false,
  activeProjectCount: 2,
  projectsWithBudget: 2,
  projectsWithBillingSchedule: 2,
  projectsWithIncompleteSchedule: 0,
  projectsWithPayer: 2,
  payersWithHistory: 2,
  payerCount: 2,
  recurringExpenseCount: 7,
  liabilityCount: 5,
  costEntryCount: 100,
  costEntriesWithPhase: 95,
  monthlyFixedCents: 45_000_00,
};

describe("forecast confidence", () => {
  it("rates complete data high and has nothing to fix", () => {
    const r = assessConfidence(complete);
    expect(r.level).toBe("high");
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.topGaps).toHaveLength(0);
  });

  it("rates an empty account low and says so plainly", () => {
    const r = assessConfidence({
      ...complete,
      openingCashAgeDays: null,
      lastSyncAgeDays: null,
      activeProjectCount: 0,
      projectsWithBudget: 0,
      projectsWithBillingSchedule: 0,
      projectsWithPayer: 0,
      payersWithHistory: 0,
      payerCount: 0,
      recurringExpenseCount: 0,
      liabilityCount: 0,
      costEntryCount: 0,
      costEntriesWithPhase: 0,
    });
    expect(r.level).toBe("low");
    expect(r.headline).toContain("rough sketch");
    expect(r.topGaps.map((g) => g.key)).toContain("openingCash");
  });

  it("puts the heaviest missing input first", () => {
    const r = assessConfidence({ ...complete, openingCashAgeDays: null, costEntriesWithPhase: 0 });
    expect(r.topGaps[0].key).toBe("openingCash");
  });

  it("treats a failing sync as missing, not merely stale", () => {
    const r = assessConfidence({ ...complete, lastSyncAgeDays: 0, syncFailing: true });
    const sync = r.checks.find((c) => c.key === "sync")!;
    expect(sync.status).toBe("missing");
    expect(sync.detail).toContain("failed");
  });

  it("flags a stale bank balance without calling it missing", () => {
    const r = assessConfidence({ ...complete, openingCashAgeDays: 40 });
    expect(r.checks.find((c) => c.key === "openingCash")!.status).toBe("partial");
  });

  it("marks a billing schedule that doesn't cover the contract as partial", () => {
    const r = assessConfidence({ ...complete, projectsWithIncompleteSchedule: 1 });
    const billing = r.checks.find((c) => c.key === "billing")!;
    expect(billing.status).toBe("partial");
    expect(billing.detail).toContain("don't cover the full contract");
  });

  it("doesn't penalize a company with no open jobs for having no budgets", () => {
    const r = assessConfidence({
      ...complete,
      activeProjectCount: 0,
      projectsWithBudget: 0,
      projectsWithBillingSchedule: 0,
      projectsWithPayer: 0,
    });
    expect(r.checks.find((c) => c.key === "budgets")!.status).toBe("good");
    expect(r.checks.find((c) => c.key === "payers")!.status).toBe("good");
  });
});
