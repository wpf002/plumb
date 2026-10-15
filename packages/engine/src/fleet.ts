import type { Cents } from "@plumb/shared";

/**
 * Fleet and capital decisions: book value, replacement risk, repair vs
 * replace, equipment purchases, hires, and adding a crew. Pure functions;
 * every input is passed in and every assumption is a named parameter.
 */

export interface FleetAsset {
  id: string;
  name: string;
  type: string | null;
  unitCount: number;
  purchaseDate: Date;
  costCents: Cents;
  salvageCents: Cents;
  usefulLifeMonths: number | null;
  marketValueCents: Cents | null;
  replacementCostCents: Cents | null;
  annualRepairCents: Cents | null;
  annualMaintenanceCents: Cents | null;
  downtimeDaysAnnual: number | null;
  loanBalanceCents: Cents;
  monthlyPaymentCents: Cents;
}

/** Calendar months in service through `asOf`, counting the purchase month and the as-of month. */
export function monthsInService(purchase: Date, asOf: Date): number {
  if (asOf < purchase) return 0;
  return (asOf.getUTCFullYear() - purchase.getUTCFullYear()) * 12 + asOf.getUTCMonth() - purchase.getUTCMonth() + 1;
}

/** Straight-line book value, floored at salvage. */
export function bookValueCents(a: Pick<FleetAsset, "purchaseDate" | "costCents" | "salvageCents" | "usefulLifeMonths">, asOf: Date): Cents {
  if (!a.usefulLifeMonths) return a.costCents;
  const months = Math.min(a.usefulLifeMonths, monthsInService(a.purchaseDate, asOf));
  return Math.round(a.costCents - ((a.costCents - a.salvageCents) * months) / a.usefulLifeMonths);
}

export interface AssetAssessment {
  id: string;
  name: string;
  type: string | null;
  ageMonths: number;
  bookValueCents: Cents;
  marketValueCents: Cents | null;
  /** Share of useful life used, in percent. Over 100 means past its planned life. */
  lifeUsedPct: number | null;
  /** Market value as a share of original cost, in percent. */
  retentionPct: number | null;
  replacementCostCents: Cents;
  replacementCostEstimated: boolean;
  /** Higher means replace sooner. Life used times value lost, plus repair burden. */
  replacementScore: number;
  status: "keep" | "watch" | "replace";
  reasons: string[];
}

export const REPLACEMENT_INFLATION_PCT = 3;

export function assessAsset(a: FleetAsset, asOf: Date, inflationPct = REPLACEMENT_INFLATION_PCT): AssetAssessment {
  const age = monthsInService(a.purchaseDate, asOf);
  const book = bookValueCents(a, asOf);
  const lifeUsed = a.usefulLifeMonths ? (age / a.usefulLifeMonths) * 100 : null;
  const retention = a.marketValueCents !== null && a.costCents > 0 ? (a.marketValueCents / a.costCents) * 100 : null;
  const estimated = a.replacementCostCents === null;
  const replacement = a.replacementCostCents ?? Math.round(a.costCents * Math.pow(1 + inflationPct / 100, age / 12));
  const repairBurden = a.annualRepairCents && a.marketValueCents ? a.annualRepairCents / Math.max(1, a.marketValueCents) : 0;
  const score = ((lifeUsed ?? 0) / 100) * (1 - (retention ?? 100) / 100) + repairBurden;
  const reasons: string[] = [];
  if (lifeUsed !== null && lifeUsed >= 100) reasons.push(`past its ${Math.round(a.usefulLifeMonths! / 12)}-year life`);
  else if (lifeUsed !== null && lifeUsed >= 85) reasons.push(`${Math.round(lifeUsed)}% of life used`);
  if (retention !== null && retention < 35) reasons.push(`worth ${Math.round(retention)}% of cost`);
  if (repairBurden >= 0.25) reasons.push(`repairs ${Math.round(repairBurden * 100)}% of its value a year`);
  if (a.downtimeDaysAnnual && a.downtimeDaysAnnual >= 10) reasons.push(`${a.downtimeDaysAnnual} days down a year`);
  const status: AssetAssessment["status"] =
    (lifeUsed !== null && lifeUsed >= 100 && (retention ?? 0) < 35) || repairBurden >= 0.5 ? "replace" : (lifeUsed ?? 0) >= 85 || repairBurden >= 0.25 ? "watch" : "keep";
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    ageMonths: age,
    bookValueCents: book,
    marketValueCents: a.marketValueCents,
    lifeUsedPct: lifeUsed === null ? null : Math.round(lifeUsed * 10) / 10,
    retentionPct: retention === null ? null : Math.round(retention * 10) / 10,
    replacementCostCents: replacement,
    replacementCostEstimated: estimated,
    replacementScore: Math.round(score * 1000) / 1000,
    status,
    reasons,
  };
}

export function fleetSummary(assets: FleetAsset[], asOf: Date) {
  const rank = { replace: 0, watch: 1, keep: 2 };
  const assessed = assets.map((a) => assessAsset(a, asOf)).sort((x, y) => rank[x.status] - rank[y.status] || y.replacementScore - x.replacementScore);
  const candidate = assessed.find((a) => a.status === "replace") ?? assessed.find((a) => a.status === "watch") ?? null;
  return {
    netBookValueCents: assessed.reduce((s, a) => s + a.bookValueCents, 0),
    marketValueCents: assessed.reduce((s, a) => s + (a.marketValueCents ?? a.bookValueCents), 0),
    originalCostCents: assets.reduce((s, a) => s + a.costCents, 0),
    loanBalanceCents: assets.reduce((s, a) => s + a.loanBalanceCents, 0),
    monthlyPaymentsCents: assets.reduce((s, a) => s + a.monthlyPaymentCents, 0),
    units: assets.reduce((s, a) => s + a.unitCount, 0),
    replacementCandidate: candidate?.name ?? null,
    assets: assessed,
  };
}

/** Level monthly payment on an amortizing loan. */
export function loanPaymentCents(principalCents: Cents, annualRatePct: number, months: number): Cents {
  if (principalCents <= 0 || months <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return Math.round(principalCents / months);
  return Math.round((principalCents * r) / (1 - Math.pow(1 + r, -months)));
}

// ---- repair vs replace --------------------------------------------------------

export interface RepairReplaceInput {
  annualRepairCents: Cents;
  annualMaintenanceCents: Cents;
  downtimeDaysAnnual: number;
  /** Lost gross profit per day the asset is down. */
  downtimeCostPerDayCents: Cents;
  marketValueCents: Cents;
  replacementCostCents: Cents;
  newUsefulLifeMonths: number;
  newSalvagePct: number;
  financeRatePct: number;
  /** New asset's maintenance as a share of the old one's (default 50%). */
  newMaintenanceFactor?: number;
  /** Yearly market-value decline of the old asset, percent (default 15%). */
  oldValueDeclinePct?: number;
}

export function repairVsReplace(i: RepairReplaceInput) {
  const keep = {
    repairsCents: i.annualRepairCents,
    maintenanceCents: i.annualMaintenanceCents,
    downtimeCents: i.downtimeDaysAnnual * i.downtimeCostPerDayCents,
    valueDeclineCents: Math.round((i.marketValueCents * (i.oldValueDeclinePct ?? 15)) / 100),
  };
  const years = i.newUsefulLifeMonths / 12;
  const financed = Math.max(0, i.replacementCostCents - i.marketValueCents);
  const replace = {
    depreciationCents: Math.round((i.replacementCostCents * (1 - i.newSalvagePct / 100)) / years),
    // Interest on the average balance of a loan amortizing over the asset's life.
    interestCents: Math.round((financed / 2) * (i.financeRatePct / 100)),
    maintenanceCents: Math.round(i.annualMaintenanceCents * (i.newMaintenanceFactor ?? 0.5)),
  };
  const keepTotal = Object.values(keep).reduce((s, v) => s + v, 0);
  const replaceTotal = Object.values(replace).reduce((s, v) => s + v, 0);
  return {
    keep,
    replace,
    keepAnnualCents: keepTotal,
    replaceAnnualCents: replaceTotal,
    annualDifferenceCents: keepTotal - replaceTotal,
    recommendation: keepTotal > replaceTotal ? ("replace" as const) : ("keep" as const),
    /** Repair spend per year at which replacing becomes cheaper. */
    breakEvenRepairCents: Math.max(0, replaceTotal - (keepTotal - keep.repairsCents)),
    tradeInCents: i.marketValueCents,
    financedCents: financed,
  };
}

// ---- equipment purchase -----------------------------------------------------------

export interface PurchaseInput {
  priceCents: Cents;
  downPct: number;
  ratePct: number;
  termMonths: number;
  /** Revenue the equipment adds each month. */
  monthlyRevenueCents: Cents;
  grossMarginPct: number;
  /** Insurance, fuel, maintenance per month. */
  monthlyOperatingCents: Cents;
  usefulLifeMonths: number;
  cashCents?: Cents;
}

export function purchaseAnalysis(i: PurchaseInput) {
  const down = Math.round((i.priceCents * i.downPct) / 100);
  const financed = i.priceCents - down;
  const payment = loanPaymentCents(financed, i.ratePct, i.termMonths);
  const grossProfit = Math.round((i.monthlyRevenueCents * i.grossMarginPct) / 100);
  const monthlyCash = grossProfit - i.monthlyOperatingCents - payment;
  const fixed = i.monthlyOperatingCents + payment;
  return {
    downPaymentCents: down,
    financedCents: financed,
    monthlyPaymentCents: payment,
    monthlyGrossProfitCents: grossProfit,
    monthlyCashFlowCents: monthlyCash,
    year1CashEffectCents: -down + monthlyCash * 12,
    debtAddedCents: financed,
    totalInterestCents: payment * i.termMonths - financed,
    annualDepreciationCents: Math.round(i.priceCents / (i.usefulLifeMonths / 12)),
    breakevenMonthlyRevenueCents: i.grossMarginPct > 0 ? Math.round(fixed / (i.grossMarginPct / 100)) : null,
    paybackMonths: monthlyCash > 0 ? Math.ceil(down / monthlyCash) : null,
    cashAfterDownCents: i.cashCents !== undefined ? i.cashCents - down : null,
  };
}

// ---- hiring --------------------------------------------------------------------------

export interface HireInput {
  annualWageCents: Cents;
  /** Employer payroll taxes (FICA, FUTA, SUTA), percent of wages. */
  payrollTaxPct: number;
  workersCompPct: number;
  benefitsMonthlyCents: Cents;
  equipmentMonthlyCents: Cents;
  vehicleMonthlyCents: Cents;
  toolsMonthlyCents: Cents;
  grossMarginPct: number;
  /** Revenue a productive field employee has produced, for capacity added. */
  revenuePerFieldEmployeeCents?: Cents;
  count?: number;
}

export const HIRE_DEFAULTS = { payrollTaxPct: 10, workersCompPct: 6 };

export function hireAnalysis(i: HireInput) {
  const count = i.count ?? 1;
  const wagesMonthly = i.annualWageCents / 12;
  const taxes = (wagesMonthly * i.payrollTaxPct) / 100;
  const comp = (wagesMonthly * i.workersCompPct) / 100;
  const perHire = wagesMonthly + taxes + comp + i.benefitsMonthlyCents + i.equipmentMonthlyCents + i.vehicleMonthlyCents + i.toolsMonthlyCents;
  const monthly = Math.round(perHire * count);
  const required = i.grossMarginPct > 0 ? Math.round(monthly / (i.grossMarginPct / 100)) : null;
  const capacity = i.revenuePerFieldEmployeeCents ? i.revenuePerFieldEmployeeCents * count : null;
  return {
    count,
    monthlyCostCents: monthly,
    annualCostCents: monthly * 12,
    burdenPct: i.annualWageCents ? Math.round(((perHire - wagesMonthly) / wagesMonthly) * 1000) / 10 : 0,
    breakdown: {
      wagesCents: Math.round(wagesMonthly * count),
      payrollTaxesCents: Math.round(taxes * count),
      workersCompCents: Math.round(comp * count),
      benefitsCents: i.benefitsMonthlyCents * count,
      equipmentCents: (i.equipmentMonthlyCents + i.vehicleMonthlyCents + i.toolsMonthlyCents) * count,
    },
    requiredMonthlyRevenueCents: required,
    addedCapacityCents: capacity,
    /** Capacity added as a multiple of the revenue needed to pay for the hire. */
    coverage: capacity && required ? Math.round((capacity / (required * 12)) * 100) / 100 : null,
  };
}

// ---- adding a crew -------------------------------------------------------------------------

export interface CrewExpansionInput {
  equipmentCents: Cents;
  downPct: number;
  ratePct: number;
  termMonths: number;
  insuranceAnnualCents: Cents;
  fuelMaintenanceAnnualCents: Cents;
  /** Share of a mature crew's revenue reached in each year, e.g. [0.45, 0.6, 0.72]. */
  ramp: number[];
  /** Annual revenue a mature crew produces. */
  matureCapacityCents: Cents;
  /** Gross margin on crew revenue, percent; crew labor sits inside it. */
  grossMarginPct: number;
  /** Fully burdened annual payroll of the new crew, for the start-up cash dip. */
  burdenedPayrollAnnualCents?: Cents;
  /** Months payroll runs ahead of billings at launch. */
  billingLagMonths?: number;
  cashCents?: Cents;
}

export function crewExpansion(i: CrewExpansionInput) {
  const down = Math.round((i.equipmentCents * i.downPct) / 100);
  const payment = loanPaymentCents(i.equipmentCents - down, i.ratePct, i.termMonths);
  const debtService = payment * 12;
  const fixed = debtService + i.insuranceAnnualCents + i.fuelMaintenanceAnnualCents;
  const margin = i.grossMarginPct / 100;
  const breakeven = margin > 0 ? Math.round(fixed / margin) : 0;
  const years = i.ramp.map((r, idx) => {
    const revenue = Math.round(i.matureCapacityCents * r);
    return { year: idx + 1, rampPct: Math.round(r * 1000) / 10, revenueCents: revenue, contributionCents: Math.round(revenue * margin) - fixed };
  });
  const dip = i.burdenedPayrollAnnualCents ? down + Math.round((i.burdenedPayrollAnnualCents / 12) * (i.billingLagMonths ?? 2.5)) : down;
  return {
    downPaymentCents: down,
    monthlyPaymentCents: payment,
    annualDebtServiceCents: debtService,
    newFixedCostsCents: fixed,
    breakevenRevenueCents: breakeven,
    breakevenPctOfCapacity: i.matureCapacityCents ? Math.round((breakeven / i.matureCapacityCents) * 1000) / 10 : 0,
    years,
    year1ContributionCents: years[0]?.contributionCents ?? 0,
    startupCashDipCents: dip,
    cashAfterDipCents: i.cashCents !== undefined ? i.cashCents - dip : null,
  };
}
