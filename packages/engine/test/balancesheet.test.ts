import { describe, it, expect } from "vitest";
import { depreciatedValueCents, monthlyDepreciationCents, valueAssets } from "../src/assets.js";
import {
  amortizationSchedule,
  monthlyDebtServiceCents,
  summarizeLiability,
} from "../src/liabilities.js";
import { computeNetWorth } from "../src/networth.js";
import type { Asset, Liability } from "@plumb/shared";

const asOf = new Date("2026-08-01T00:00:00Z");

const truck: Asset = {
  id: "a1",
  name: "F-350 service truck",
  category: "VEHICLE",
  purchaseDate: new Date("2024-08-01T00:00:00Z"),
  purchaseCostCents: 68_000_00,
  salvageValueCents: 8_000_00,
  usefulLifeMonths: 60,
};

describe("assets", () => {
  it("depreciates straight-line from the purchase date", () => {
    // (68,000 - 8,000) / 60 = 1,000/mo. 24 months in => 68,000 - 24,000 = 44,000.
    expect(monthlyDepreciationCents(truck)).toBe(1_000_00);
    expect(depreciatedValueCents(truck, asOf)).toBe(44_000_00);
  });

  it("never falls below salvage value", () => {
    expect(depreciatedValueCents(truck, new Date("2040-01-01T00:00:00Z"))).toBe(8_000_00);
  });

  it("lets the owner's manual value win, then keeps depreciating from it", () => {
    const anchored: Asset = {
      ...truck,
      currentValueCents: 50_000_00,
      valueAsOf: new Date("2026-06-01T00:00:00Z"),
    };
    // Anchor 50,000 two months before asOf => 50,000 - 2,000 = 48,000, not 44,000.
    expect(depreciatedValueCents(anchored, asOf)).toBe(48_000_00);
  });

  it("holds flat at the anchor when no useful life is set", () => {
    const flat: Asset = {
      ...truck,
      usefulLifeMonths: undefined,
      currentValueCents: 52_000_00,
      valueAsOf: new Date("2025-01-01T00:00:00Z"),
    };
    expect(depreciatedValueCents(flat, asOf)).toBe(52_000_00);
  });

  it("values a disposed asset at zero", () => {
    const sold: Asset = { ...truck, disposedAt: new Date("2026-01-01T00:00:00Z") };
    expect(depreciatedValueCents(sold, asOf)).toBe(0);
    expect(valueAssets([sold], asOf)[0].depreciationToDateCents).toBe(68_000_00);
  });
});

const loan: Liability = {
  id: "l1",
  name: "Truck loan",
  kind: "TERM_LOAN",
  currentBalanceCents: 30_000_00,
  interestRatePct: 6,
  paymentAmountCents: 1_200_00,
  paymentFrequency: "MONTHLY",
  nextPaymentDate: new Date("2026-08-15T00:00:00Z"),
  active: true,
};

describe("liabilities", () => {
  it("splits each payment into interest and principal", () => {
    const [first] = amortizationSchedule(loan, asOf, new Date("2026-09-01T00:00:00Z"));
    // 30,000 * (6% / 12) = 150 interest; 1,200 - 150 = 1,050 principal.
    expect(first.interestCents).toBe(150_00);
    expect(first.principalCents).toBe(1_050_00);
    expect(first.balanceAfterCents).toBe(28_950_00);
  });

  it("stops once the balance clears and never overpays", () => {
    const schedule = amortizationSchedule(loan, asOf, new Date("2032-01-01T00:00:00Z"));
    const last = schedule[schedule.length - 1];
    expect(last.balanceAfterCents).toBe(0);
    expect(last.amountCents).toBeLessThanOrEqual(loan.paymentAmountCents);
    expect(summarizeLiability(loan, asOf, new Date("2032-01-01T00:00:00Z")).projectedPayoffDate)
      .toEqual(last.date);
  });

  it("flags a payment that never covers interest", () => {
    const card: Liability = {
      ...loan,
      id: "l2",
      kind: "CREDIT_CARD",
      currentBalanceCents: 40_000_00,
      creditLimitCents: 50_000_00,
      interestRatePct: 24,
      paymentAmountCents: 500_00, // < 800/mo of interest
    };
    const s = summarizeLiability(card, asOf, new Date("2027-08-01T00:00:00Z"));
    expect(s.amortizes).toBe(false);
    expect(s.projectedPayoffDate).toBeNull();
    expect(s.creditUtilizationPct).toBe(80);
  });

  it("keeps a lease paying rent until its end date without amortizing", () => {
    const lease: Liability = {
      ...loan,
      id: "l3",
      kind: "BUILDING_LEASE",
      currentBalanceCents: 0,
      interestRatePct: 0,
      paymentAmountCents: 4_500_00,
      endDate: new Date("2026-11-01T00:00:00Z"),
    };
    const schedule = amortizationSchedule(lease, asOf, new Date("2027-08-01T00:00:00Z"));
    expect(schedule).toHaveLength(3); // Aug, Sep, Oct — stops after the end date
    expect(schedule.every((p) => p.amountCents === 4_500_00)).toBe(true);
    // A zero-balance lease must not read as "paid off" on its first payment.
    expect(summarizeLiability(lease, asOf, new Date("2027-08-01T00:00:00Z")).projectedPayoffDate)
      .toBeNull();
  });

  it("normalizes mixed cadences into monthly debt service", () => {
    const weekly: Liability = {
      ...loan,
      id: "l4",
      paymentAmountCents: 300_00,
      paymentFrequency: "WEEKLY",
    };
    // 1,200/mo + (300 * 52 / 12 = 1,300)/mo
    expect(monthlyDebtServiceCents([loan, weekly])).toBe(2_500_00);
  });
});

describe("net worth", () => {
  it("nets depreciated assets and cash against outstanding balances", () => {
    const r = computeNetWorth({
      asOf,
      cashCents: 120_000_00,
      assets: [truck],
      liabilities: [loan],
      horizonEnd: new Date("2032-01-01T00:00:00Z"),
    });
    expect(r.assetValueCents).toBe(44_000_00);
    expect(r.totalAssetsCents).toBe(164_000_00);
    expect(r.totalLiabilitiesCents).toBe(30_000_00);
    expect(r.netWorthCents).toBe(134_000_00);
    expect(r.byAssetCategory).toEqual([{ category: "VEHICLE", valueCents: 44_000_00 }]);
  });

  it("ignores inactive liabilities", () => {
    const r = computeNetWorth({
      asOf,
      cashCents: 0,
      assets: [],
      liabilities: [{ ...loan, active: false }],
      horizonEnd: new Date("2032-01-01T00:00:00Z"),
    });
    expect(r.totalLiabilitiesCents).toBe(0);
    expect(r.netWorthCents).toBe(0);
  });
});
