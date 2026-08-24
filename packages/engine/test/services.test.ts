import { describe, it, expect } from "vitest";
import { expandServices, summarizeServices } from "../src/services.js";
import type { ServiceContract } from "@plumb/shared";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const asOf = d("2026-08-01");

const monitoring: ServiceContract = {
  id: "s1",
  name: "Fire alarm monitoring",
  client: "Hillwood Properties",
  amountCents: 4_200_00,
  billingFrequency: "MONTHLY",
  netDays: 30,
  startDate: d("2026-01-05"),
  renewalDate: d("2026-10-01"),
  autoRenew: true,
  status: "ACTIVE",
};

describe("service contracts", () => {
  it("bills on its own cadence and lands after terms", () => {
    const events = expandServices([monitoring], asOf, d("2026-11-01"));
    // Billed the 5th, paid 30 days later — first receipt inside the window is
    // the July billing landing in August.
    expect(events[0].expectedDate).toEqual(d("2026-08-04"));
    expect(events[0].direction).toBe("IN");
    expect(events[0].amountCents).toBe(4_200_00);
  });

  it("adds the client's lateness on top of terms", () => {
    const slow = { ...monitoring, payerDaysLate: 20 };
    const events = expandServices([slow], asOf, d("2026-11-01"));
    expect(events[0].expectedDate).toEqual(d("2026-08-24"));
  });

  it("produces nothing for a paused or ended contract", () => {
    expect(expandServices([{ ...monitoring, status: "PAUSED" }], asOf, d("2026-11-01"))).toHaveLength(0);
    expect(expandServices([{ ...monitoring, status: "ENDED" }], asOf, d("2026-11-01"))).toHaveLength(0);
  });

  it("stops at the renewal date when the contract doesn't auto-renew", () => {
    const ending = { ...monitoring, autoRenew: false };
    const events = expandServices([ending], asOf, d("2027-06-01"));
    // Billings stop after the Oct 1 renewal; the last one lands 30 days later.
    expect(events[events.length - 1].expectedDate.getTime()).toBeLessThanOrEqual(
      d("2026-11-04").getTime()
    );
  });

  it("normalizes cadences into monthly recurring revenue", () => {
    const annual: ServiceContract = {
      ...monitoring,
      id: "s2",
      client: "Northwest ISD",
      name: "Annual inspection",
      amountCents: 18_000_00,
      billingFrequency: "ANNUAL",
    };
    const s = summarizeServices([monitoring, annual], asOf);
    expect(s.monthlyRecurringCents).toBe(4_200_00 + 1_500_00);
    expect(s.activeCount).toBe(2);
  });

  it("reports concentration, because one big client is the real risk", () => {
    const small: ServiceContract = {
      ...monitoring,
      id: "s3",
      client: "Small Shop",
      amountCents: 800_00,
      renewalDate: undefined,
    };
    const s = summarizeServices([monitoring, small], asOf);
    expect(s.largestClientName).toBe("Hillwood Properties");
    expect(s.largestClientSharePct).toBe(84);
  });

  it("surfaces renewals inside the window, largest exposure first", () => {
    const other: ServiceContract = {
      ...monitoring,
      id: "s4",
      client: "Other",
      amountCents: 900_00,
      renewalDate: d("2026-09-01"),
    };
    const s = summarizeServices([other, monitoring], asOf, 90);
    expect(s.renewals.map((r) => r.contractId)).toEqual(["s1", "s4"]);
    expect(s.renewals[0].daysAway).toBe(61);
    expect(s.renewals[0].shareOfRecurringPct).toBeGreaterThan(80);
  });

  it("ignores renewals beyond the window", () => {
    const far = { ...monitoring, renewalDate: d("2027-06-01") };
    expect(summarizeServices([far], asOf, 90).renewals).toHaveLength(0);
  });
});
