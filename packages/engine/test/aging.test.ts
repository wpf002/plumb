import { describe, it, expect } from "vitest";
import { agingReport, bucketOf, collectionsPriority, daysPastDue, type OpenItem } from "../src/aging.js";
import { currentRatioReading, dscrReading, shortTermPosition, locUtilizationReading } from "../src/readings.js";

const asOf = new Date("2025-12-31T00:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const item = (id: string, party: string, cents: number, due: string, avgLate?: number): OpenItem => ({
  id, party, amountCents: cents, issueDate: d("2025-09-30"), dueDate: d(due), partyAvgDaysLate: avgLate ?? null,
});

describe("aging", () => {
  it("counts days from the due date, not the invoice date", () => {
    expect(daysPastDue(item("a", "x", 1, "2026-01-14"), asOf)).toBe(-14);
    expect(daysPastDue(item("a", "x", 1, "2025-11-15"), asOf)).toBe(46);
  });

  it("buckets the way an aging report reads", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(bucketOf)).toEqual(["current", "1-30", "1-30", "31-60", "31-60", "61-90", "61-90", "90+"]);
  });

  it("totals by bucket and by customer, largest first", () => {
    const r = agingReport(
      [item("1", "Musco", 269_197_00, "2026-01-15"), item("2", "Barren County Schools", 28_774_00, "2025-11-10"), item("3", "Musco", 1_000_00, "2025-12-20")],
      asOf
    );
    expect(r.totalCents).toBe(298_971_00);
    expect(r.pastDue30Cents).toBe(28_774_00);
    expect(r.byParty[0]).toMatchObject({ party: "Musco", totalCents: 270_197_00, pastDue30Cents: 0 });
    expect(r.byParty[1].buckets["31-60"]).toBe(28_774_00);
  });
});

describe("collections priority", () => {
  it("ranks a large, late invoice from a slow payer first", () => {
    const ranked = collectionsPriority(
      [item("small-late", "A", 2_000_00, "2025-10-01"), item("big-current", "B", 90_000_00, "2026-01-20"), item("big-late-slow", "C", 80_000_00, "2025-11-01", 40)],
      asOf
    );
    expect(ranked[0].id).toBe("big-late-slow");
    expect(ranked.at(-1)!.id).toBe("small-late");
    expect(ranked[0].reason).toMatch(/days past terms/);
  });
});

describe("owner-language readings", () => {
  it("translates the current ratio", () => {
    expect(currentRatioReading(1.3).label).toBe("Tight but Manageable");
    expect(currentRatioReading(2.4).label).toBe("Strong");
    expect(currentRatioReading(0.9).tone).toBe("bad");
  });

  it("reads debt coverage against the lender's 1.25x", () => {
    expect(dscrReading(1.3).label).toBe("Bankable");
    expect(dscrReading(0.8).tone).toBe("bad");
    expect(dscrReading(null).label).toBe("No Debt Service");
  });

  it("combines ratio and runway into one short-term position", () => {
    expect(shortTermPosition(3.6, 2.5).label).toBe("Tight but Manageable");
    expect(shortTermPosition(3.6, 6).label).toBe("Solid");
    expect(shortTermPosition(1.0, 6).label).toBe("Under Pressure");
  });

  it("reads line-of-credit utilization", () => {
    expect(locUtilizationReading(0).label).toBe("Untouched");
    expect(locUtilizationReading(95).label).toBe("Maxed Out");
  });
});
