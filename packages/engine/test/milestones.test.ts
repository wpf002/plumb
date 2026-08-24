import { describe, it, expect } from "vitest";
import {
  expandMilestones,
  expectedReceiptDate,
  generateMilestones,
  slipDays,
  splitRetainage,
  summarizeMilestones,
  type MilestoneContext,
} from "../src/milestones.js";
import { computeCashFlow } from "../src/cashflow.js";
import type { Milestone } from "@plumb/shared";

const asOf = new Date("2026-08-01T00:00:00Z");
const horizonEnd = new Date("2027-08-01T00:00:00Z");

const ctx: MilestoneContext = {
  projectId: "p1",
  projectName: "Northwest ISD",
  netDays: 30,
  payerDaysLate: 0,
  retainageReleaseDate: new Date("2027-01-15T00:00:00Z"),
};

const base: Milestone = {
  id: "m1",
  projectId: "p1",
  name: "Rough-in complete",
  sequence: 1,
  trigger: "DATE",
  expectedDate: new Date("2026-09-01T00:00:00Z"),
  originalExpectedDate: new Date("2026-09-01T00:00:00Z"),
  amountCents: 200_000_00,
  retainagePct: 10,
  status: "PLANNED",
};

describe("milestones", () => {
  it("splits the retainage the payer withholds", () => {
    expect(splitRetainage(base)).toEqual({ netCents: 180_000_00, retainageCents: 20_000_00 });
  });

  it("dates the receipt off the invoice date plus terms", () => {
    expect(expectedReceiptDate(base, ctx)).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  it("runs terms from the actual invoice date once billed", () => {
    const billed = { ...base, status: "BILLED" as const, billedAt: new Date("2026-09-20T00:00:00Z") };
    expect(expectedReceiptDate(billed, ctx)).toEqual(new Date("2026-10-20T00:00:00Z"));
  });

  it("produces the progress payment now and the retainage at release", () => {
    const events = expandMilestones([{ context: ctx, milestones: [base] }], asOf, horizonEnd);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      direction: "IN",
      amountCents: 180_000_00,
      category: "PROGRESS_BILLING",
    });
    expect(events[0].expectedDate).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(events[1]).toMatchObject({ amountCents: 20_000_00, category: "RETAINAGE_RELEASE" });
    // Release date + terms.
    expect(events[1].expectedDate).toEqual(new Date("2027-02-14T00:00:00Z"));
  });

  it("produces nothing for a milestone already paid", () => {
    const paid = { ...base, status: "PAID" as const, paidAt: new Date("2026-10-01T00:00:00Z") };
    expect(expandMilestones([{ context: ctx, milestones: [paid] }], asOf, horizonEnd)).toHaveLength(0);
  });

  it("pushes the money when the date slips — the whole point", () => {
    const delayed = { ...base, expectedDate: new Date("2026-09-15T00:00:00Z") };
    const before = expandMilestones([{ context: ctx, milestones: [base] }], asOf, horizonEnd)[0];
    const after = expandMilestones([{ context: ctx, milestones: [delayed] }], asOf, horizonEnd)[0];
    expect(after.expectedDate.getTime() - before.expectedDate.getTime()).toBe(14 * 86_400_000);
    expect(slipDays(delayed)).toBe(14);
  });

  it("moves the cash low point when a milestone is delayed", () => {
    const events = (m: Milestone) => [
      ...expandMilestones([{ context: ctx, milestones: [m] }], asOf, horizonEnd),
      {
        id: "payroll",
        projectId: null,
        direction: "OUT" as const,
        amountCents: 120_000_00,
        category: "PAYROLL" as const,
        expectedDate: new Date("2026-10-10T00:00:00Z"),
        actualDate: null,
        status: "EXPECTED" as const,
      },
    ];
    const run = (m: Milestone) =>
      computeCashFlow({
        openingCashCents: 50_000_00,
        asOf,
        horizonDays: 120,
        stressDelayDays: 0,
        safetyThresholdCents: 0,
        events: events(m),
      });

    const onTime = run(base);
    const delayed = run({ ...base, expectedDate: new Date("2026-09-25T00:00:00Z") });
    // On time the payment lands before payroll; delayed it lands after, so the
    // trough is deeper.
    expect(delayed.base.minBalanceCents).toBeLessThan(onTime.base.minBalanceCents);
  });

  it("summarizes coverage, billing, and slip", () => {
    const second: Milestone = {
      ...base,
      id: "m2",
      sequence: 2,
      name: "Trim complete",
      amountCents: 300_000_00,
      expectedDate: new Date("2026-11-10T00:00:00Z"),
      originalExpectedDate: new Date("2026-11-01T00:00:00Z"),
      status: "BILLED",
      billedAt: new Date("2026-11-10T00:00:00Z"),
    };
    const s = summarizeMilestones("p1", 600_000_00, [base, second], asOf);
    expect(s.scheduledCents).toBe(500_000_00);
    expect(s.unscheduledCents).toBe(100_000_00);
    expect(s.billedCents).toBe(300_000_00);
    expect(s.retainageHeldCents).toBe(50_000_00);
    expect(s.slippedCount).toBe(1);
    expect(s.totalSlipDays).toBe(9);
    expect(s.nextMilestone?.id).toBe("m1");
  });
});

describe("milestone generator", () => {
  it("splits the contract evenly and sums to it exactly", () => {
    const drafted = generateMilestones(
      1_000_000_01,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-07-01T00:00:00Z"),
      3
    );
    expect(drafted).toHaveLength(3);
    expect(drafted.reduce((s, d) => s + d.amountCents, 0)).toBe(1_000_000_01);
    // Bills at the end of each interval — you invoice work already done.
    expect(drafted[0].expectedDate.toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(drafted[2].expectedDate.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("returns nothing for a nonsense count", () => {
    expect(generateMilestones(100_00, new Date(), new Date(), 0)).toEqual([]);
  });
});
