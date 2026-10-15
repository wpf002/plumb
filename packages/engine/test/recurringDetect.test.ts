import { describe, it, expect } from "vitest";
import { detectRecurring, normalizeMerchant, type TxnLike } from "../src/recurringDetect.js";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const monthly = (desc: string, cents: number, months: number, day = 3): TxnLike[] =>
  Array.from({ length: months }, (_, i) => ({ date: new Date(Date.UTC(2025, i, day)), amountCents: cents, description: `${desc} ${1000 + i}` }));

describe("normalizeMerchant", () => {
  it("strips ids, dates, and bank noise", () => {
    expect(normalizeMerchant("ACH DEBIT ALLY AUTO PMT 0423 #88213")).toBe("ally auto");
    expect(normalizeMerchant("ALLY AUTO PMT 0523")).toBe("ally auto");
    expect(normalizeMerchant("POS PURCHASE Home Depot #4421")).toBe("home depot");
  });
});

describe("detectRecurring", () => {
  it("finds a monthly loan payment and prices it per month", () => {
    const r = detectRecurring(monthly("ACH DEBIT ALLY AUTO PMT", -1_240_00, 8));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ direction: "out", cadence: "monthly", count: 8, typicalAmountCents: 1_240_00, monthlyEquivalentCents: 1_240_00 });
    expect(r[0].nextDate).toBe("2025-09-02");
  });

  it("finds biweekly payroll and converts it to a monthly figure", () => {
    const txns = Array.from({ length: 10 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 3 + i * 14)), amountCents: -18_500_00 - (i % 2) * 300_00, description: "GUSTO PAYROLL" }));
    const r = detectRecurring(txns);
    expect(r[0].cadence).toBe("biweekly");
    expect(r[0].monthlyEquivalentCents).toBe(Math.round(r[0].typicalAmountCents * (26 / 12)));
  });

  it("separates deposits from charges and ignores one-offs", () => {
    const txns = [
      ...monthly("MAINT CONTRACT GREENVIEW", 2_400_00, 6, 10),
      { date: d("2025-03-14"), amountCents: -8_200_00, description: "CAT EQUIPMENT REPAIR" },
      { date: d("2025-05-02"), amountCents: -310_00, description: "Home Depot #4421" },
      { date: d("2025-05-19"), amountCents: -1_920_00, description: "Home Depot #0933" },
    ];
    const r = detectRecurring(txns);
    expect(r.map((x) => x.label)).toEqual(["Maint Contract Greenview"]);
    expect(r[0].direction).toBe("in");
  });

  it("rejects a merchant whose amounts swing too much", () => {
    const txns = [800_00, 2_900_00, 450_00, 1_600_00].map((c, i) => ({ date: new Date(Date.UTC(2025, i, 5)), amountCents: -c, description: "SUPPLY HOUSE" }));
    expect(detectRecurring(txns)).toHaveLength(0);
  });

  it("needs two hits for an annual charge", () => {
    const r = detectRecurring([
      { date: d("2024-04-01"), amountCents: -6_000_00, description: "STATE FARM INS" },
      { date: d("2025-04-01"), amountCents: -6_150_00, description: "STATE FARM INS" },
    ]);
    expect(r[0]).toMatchObject({ cadence: "annual", monthlyEquivalentCents: Math.round(r[0].typicalAmountCents / 12) });
  });
});
