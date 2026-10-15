import { describe, it, expect } from "vitest";
import { assessAsset, bookValueCents, crewExpansion, fleetSummary, hireAnalysis, loanPaymentCents, monthsInService, purchaseAnalysis, repairVsReplace, type FleetAsset } from "../src/fleet.js";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const asset = (o: Partial<FleetAsset>): FleetAsset => ({
  id: "a", name: "Asset", type: null, unitCount: 1, purchaseDate: d("2020-01-01"), costCents: 100_000_00, salvageCents: 10_000_00,
  usefulLifeMonths: 120, marketValueCents: null, replacementCostCents: null, annualRepairCents: null, annualMaintenanceCents: null,
  downtimeDaysAnnual: null, loanBalanceCents: 0, monthlyPaymentCents: 0, ...o,
});

describe("book value", () => {
  it("counts the purchase month and the as-of month", () => {
    expect(monthsInService(d("2016-05-01"), d("2025-12-31"))).toBe(116);
    expect(monthsInService(d("2026-01-01"), d("2025-12-31"))).toBe(0);
  });
  it("straight-lines to salvage and stops", () => {
    // Steve's excavator: $118,000, 120 months, $15,000 salvage, May 2016.
    expect(bookValueCents(asset({ purchaseDate: d("2016-05-01"), costCents: 118_000_00, salvageCents: 15_000_00 }), d("2025-12-31"))).toBe(1_843_333);
    expect(bookValueCents(asset({ purchaseDate: d("2010-01-01") }), d("2025-12-31"))).toBe(10_000_00);
  });
});

describe("replacement risk", () => {
  it("flags an asset past its life that has lost most of its value", () => {
    const forklift = assessAsset(asset({ name: "Forklift", purchaseDate: d("2015-08-01"), costCents: 38_000_00, salvageCents: 4_000_00, marketValueCents: 11_000_00 }), d("2025-12-31"));
    expect(forklift.status).toBe("replace");
    expect(forklift.reasons[0]).toMatch(/past its 10-year life/);
  });
  it("keeps a young asset and estimates replacement cost with inflation", () => {
    const truck = assessAsset(asset({ purchaseDate: d("2024-02-01"), costCents: 58_500_00, marketValueCents: 51_000_00, usefulLifeMonths: 84 }), d("2025-12-31"));
    expect(truck.status).toBe("keep");
    expect(truck.replacementCostEstimated).toBe(true);
    expect(truck.replacementCostCents).toBeGreaterThan(58_500_00);
  });
  it("picks the riskiest asset as the replacement candidate", () => {
    const s = fleetSummary(
      [
        asset({ id: "1", name: "Young", purchaseDate: d("2024-01-01"), marketValueCents: 90_000_00 }),
        asset({ id: "2", name: "Old", purchaseDate: d("2014-01-01"), marketValueCents: 20_000_00 }),
      ],
      d("2025-12-31")
    );
    expect(s.replacementCandidate).toBe("Old");
    expect(s.marketValueCents).toBe(110_000_00);
  });
});

describe("loans and purchases", () => {
  it("amortizes Joe's crew equipment loan to $2,416/month", () => {
    expect(Math.round(loanPaymentCents(119_425_00, 7.9, 60) / 100)).toBe(2416);
  });
  it("finds breakeven revenue and payback", () => {
    const p = purchaseAnalysis({ priceCents: 60_000_00, downPct: 20, ratePct: 8, termMonths: 60, monthlyRevenueCents: 15_000_00, grossMarginPct: 30, monthlyOperatingCents: 500_00, usefulLifeMonths: 84 });
    expect(p.downPaymentCents).toBe(12_000_00);
    expect(p.monthlyCashFlowCents).toBe(4_500_00 - 500_00 - p.monthlyPaymentCents);
    expect(p.breakevenMonthlyRevenueCents).toBe(Math.round((500_00 + p.monthlyPaymentCents) / 0.3));
    expect(p.paybackMonths).toBeGreaterThan(0);
  });
});

describe("repair vs replace", () => {
  it("replaces when keeping costs more each year", () => {
    const r = repairVsReplace({ annualRepairCents: 12_000_00, annualMaintenanceCents: 3_000_00, downtimeDaysAnnual: 12, downtimeCostPerDayCents: 800_00, marketValueCents: 11_000_00, replacementCostCents: 45_000_00, newUsefulLifeMonths: 120, newSalvagePct: 10, financeRatePct: 8 });
    expect(r.recommendation).toBe("replace");
    expect(r.keepAnnualCents).toBeGreaterThan(r.replaceAnnualCents);
  });
  it("keeps when repairs are small", () => {
    expect(repairVsReplace({ annualRepairCents: 500_00, annualMaintenanceCents: 1_000_00, downtimeDaysAnnual: 0, downtimeCostPerDayCents: 0, marketValueCents: 30_000_00, replacementCostCents: 60_000_00, newUsefulLifeMonths: 84, newSalvagePct: 10, financeRatePct: 8 }).recommendation).toBe("keep");
  });
});

describe("hiring", () => {
  it("prices the revenue a hire needs at the current margin", () => {
    const h = hireAnalysis({ annualWageCents: 45_000_00, payrollTaxPct: 10, workersCompPct: 6, benefitsMonthlyCents: 400_00, equipmentMonthlyCents: 0, vehicleMonthlyCents: 0, toolsMonthlyCents: 100_00, grossMarginPct: 30 });
    expect(h.monthlyCostCents).toBe(Math.round(3_750_00 * 1.16 + 500_00));
    expect(h.requiredMonthlyRevenueCents).toBe(Math.round(h.monthlyCostCents / 0.3));
  });
  it("adds capacity at the best revenue per field employee", () => {
    const h = hireAnalysis({ annualWageCents: 60_000_00, payrollTaxPct: 10, workersCompPct: 6, benefitsMonthlyCents: 0, equipmentMonthlyCents: 0, vehicleMonthlyCents: 0, toolsMonthlyCents: 0, grossMarginPct: 20, revenuePerFieldEmployeeCents: 539_447_00, count: 2 });
    expect(h.addedCapacityCents).toBe(1_078_894_00);
  });
});

describe("crew expansion", () => {
  it("reproduces Joe's second-crew numbers", () => {
    const r = crewExpansion({
      equipmentCents: 140_500_00, downPct: 15, ratePct: 7.9, termMonths: 60, insuranceAnnualCents: 9_600_00, fuelMaintenanceAnnualCents: 14_000_00,
      ramp: [0.45, 0.6, 0.72], matureCapacityCents: 1_380_000_00, grossMarginPct: 33.7137, burdenedPayrollAnnualCents: 299_187_00,
    });
    expect(r.downPaymentCents).toBe(21_075_00);
    expect(Math.round(r.annualDebtServiceCents / 100)).toBeCloseTo(28_990, -1);
    expect(Math.abs(r.breakevenRevenueCents / 100 - 155_989)).toBeLessThan(150);
    expect(r.breakevenPctOfCapacity).toBeCloseTo(11.3, 0);
    expect(Math.abs(r.year1ContributionCents / 100 - 156_772)).toBeLessThan(150);
    expect(Math.abs(r.startupCashDipCents / 100 - 83_406)).toBeLessThan(5);
  });
});

import { acquisitionAnalysis } from "../src/fleet.js";

describe("acquisition", () => {
  it("prices the deal, the combined coverage, and the payback", () => {
    const r = acquisitionAnalysis({
      priceCents: 1_200_000_00, targetRevenueCents: 2_000_000_00, targetEbitdaCents: 300_000_00, downPct: 20, ratePct: 9, termMonths: 120,
      synergyPct: 2, buyerRevenueCents: 3_000_000_00, buyerEbitdaCents: 500_000_00, buyerAnnualDebtServiceCents: 60_000_00, buyerCashCents: 400_000_00, valuationMultiple: 4,
    });
    expect(r.multiplePaid).toBe(4);
    expect(r.downPaymentCents).toBe(240_000_00);
    expect(r.combinedEbitdaCents).toBe(840_000_00);
    expect(r.cashAfterCloseCents).toBe(160_000_00);
    expect(r.combinedDscr).toBeGreaterThan(1);
    expect(r.valueAddedCents).toBe(340_000_00 * 4 - 1_200_000_00);
  });
});
