import { describe, it, expect } from "vitest";
import { detectCollisions } from "../src/collisions.js";
import type { CashEvent } from "@plumb/shared";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const asOf = d("2026-08-03");

const ev = (
  id: string,
  direction: "IN" | "OUT",
  cents: number,
  iso: string,
  projectId: string | null = null,
  actual = false
): CashEvent => ({
  id,
  projectId,
  direction,
  amountCents: cents,
  category: direction === "IN" ? "PROGRESS_BILLING" : "LOAN",
  expectedDate: d(iso),
  actualDate: actual ? d(iso) : null,
  status: actual ? "RECEIVED" : "EXPECTED",
});

describe("cash collisions", () => {
  const base = {
    asOf,
    horizonDays: 28,
    openingCashCents: 40_000_00,
    safetyThresholdCents: 30_000_00,
    payerDaysLateByProject: { slow: 42 },
  };

  it("flags a week that only works if a slow payer pays on time", () => {
    const c = detectCollisions({
      ...base,
      events: [ev("bill", "OUT", 60_000_00, "2026-08-05"), ev("inv", "IN", 90_000_00, "2026-08-06", "slow")],
    });
    expect(c).toHaveLength(1);
    expect(c[0].atRiskInflowCents).toBe(90_000_00);
    // 40k + 90k - 60k = 70k on paper; 40k - 60k = -20k if the invoice slips.
    expect(c[0].balanceIfLateCents).toBe(-20_000_00);
  });

  it("stays quiet when the week survives without the at-risk money", () => {
    const c = detectCollisions({
      ...base,
      openingCashCents: 200_000_00,
      events: [ev("bill", "OUT", 20_000_00, "2026-08-05"), ev("inv", "IN", 90_000_00, "2026-08-06", "slow")],
    });
    expect(c).toHaveLength(0);
  });

  it("stays quiet when the week is already under water — that's a breach, not a collision", () => {
    const c = detectCollisions({
      ...base,
      events: [ev("bill", "OUT", 200_000_00, "2026-08-05"), ev("inv", "IN", 10_000_00, "2026-08-06", "slow")],
    });
    expect(c).toHaveLength(0);
  });

  it("doesn't treat money already in the bank as at risk", () => {
    const c = detectCollisions({
      ...base,
      events: [
        ev("bill", "OUT", 60_000_00, "2026-08-05"),
        ev("inv", "IN", 90_000_00, "2026-08-06", "slow", true),
      ],
    });
    expect(c).toHaveLength(0);
  });

  it("ignores inflows from payers with no lateness history", () => {
    const c = detectCollisions({
      ...base,
      events: [ev("bill", "OUT", 60_000_00, "2026-08-05"), ev("inv", "IN", 90_000_00, "2026-08-06", "reliable")],
    });
    expect(c).toHaveLength(0);
  });

  it("carries the running balance across weeks", () => {
    const c = detectCollisions({
      ...base,
      horizonDays: 21,
      events: [
        // Week 1 drains the account without any at-risk money.
        ev("w1", "OUT", 5_000_00, "2026-08-04"),
        // Week 2 then depends on the slow payer.
        ev("w2out", "OUT", 20_000_00, "2026-08-12"),
        ev("w2in", "IN", 30_000_00, "2026-08-13", "slow"),
      ],
    });
    expect(c).toHaveLength(1);
    expect(c[0].weekStart).toBe("2026-08-10");
    // 35k carried in, minus 20k out = 15k if the 30k is late.
    expect(c[0].balanceIfLateCents).toBe(15_000_00);
  });
});
