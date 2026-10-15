import type { CrewExpansionScenario } from "./capital.js";
/**
 * The analytics contract. Every DNRD capability the acceptance harness checks is
 * a method here, computed from the canonical model for one company. All money is
 * integer cents; all percentages are plain numbers (12.5 = 12.5%).
 */

export class Pending extends Error {
  constructor(public phase: string, what: string) {
    super(`${what} lands in ${phase}`);
    this.name = "Pending";
  }
}

export interface AnnualStatement {
  year: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  opex: number;
  ebitda: number;
  ebitdaMarginPct: number;
  netIncome: number;
  cogsPctOfRevenue: number;
  /** Revenue by service line (from revenue_* statement lines). */
  revenueByLine: Record<string, number>;
  /** Direct cost by subtype (LABOR, MATERIALS, ...). */
  cogsBySubtype: Record<string, number>;
}

export interface MonthPoint {
  period: string;
  netIncome: number;
  operatingCashFlow: number;
  cash: number;
}

export interface LocHistory {
  limitCents: number;
  peakBalanceCents: number;
  peakPeriod: string | null;
  everDrawn: boolean;
}

export interface ArAging {
  asOf: string;
  totalCents: number;
  /** More than 30 days past the invoice's terms. */
  pastDue30Cents: number;
  largest: { customer: string; externalId: string | null; cents: number } | null;
  /** Customer with the most past-due (> 30 days) balance. */
  largestPastDue: { customer: string; externalId: string | null; pastDueCents: number; totalCents: number } | null;
}

export interface Concentration {
  basis: string;
  totalCents: number;
  top: { name: string; cents: number; pct: number } | null;
  top5Pct: number;
  maxPct: number;
}

export interface MarginPerformance {
  count: number;
  under: { count: number; avgActualMarginPct: number; minGapPts: number; maxGapPts: number };
  over: { count: number };
}

export interface Overruns {
  count: number;
  total: number;
  grossProfitErodedCents: number;
}

export interface ProjectTypeStat {
  type: string;
  count: number;
  avgMarginPct: number;
  contractCents: number;
}

export interface CostMix {
  category: string;
  laborPct: number;
  materialsPct: number;
}

export interface FadeFlag {
  externalId: string;
  originalContractCents: number;
  peakProjectedMarginPct: number;
  finalMarginPct: number;
}

export interface StandoutFlag {
  externalId: string;
  originalContractCents: number;
  finalMarginPct: number;
  categoryAvgMarginPct: number;
}

export interface BacklogSummary {
  signedCents: number;
  weightedPipelineCents: number;
  coverageOfLastYearRevenuePct: number;
}

export interface CrewUtilization {
  project: { avgPct: number; peakYear: number; peakYearAvgPct: number; trailing24AvgPct: number } | null;
  maintenance: { trailing12AvgPct: number } | null;
}

export interface FleetSummary {
  netBookValueCents: number;
  marketValueCents: number;
  replacementCandidate: string | null;
}

export interface Valuation {
  reportedEbitdaCents: number;
  normalizedEbitdaCents: number;
  sdeCents: number;
  ownerComp: { opexBurdenedCents: number; marketGapCents: number };
  ebitdaMarginPct: number;
  sdeRange: [number, number];
  ebitdaRange: [number, number];
  equityRange: [number, number];
  realEstate: { marketValueCents: number; mortgageCents: number; netEquityCents: number } | null;
  multiples: { sde: [number, number]; ebitda: [number, number] };
}

export interface Analytics {
  companyId: string;
  statements: {
    annual(year: number): Promise<AnnualStatement>;
    month(period: string): Promise<MonthPoint>;
    cashLow(year?: number): Promise<{ period: string; cents: number }>;
    firstCash(): Promise<number>;
  };
  budget: { netIncomeVariancePct(year: number): Promise<number>; worstProfitYear(): Promise<number> };
  debt: { loc(): Promise<LocHistory>; totalCents(): Promise<number> };
  ar: { aging(): Promise<ArAging> };
  customers: { concentration(): Promise<Concentration> };
  projects: {
    marginPerformance(): Promise<MarginPerformance>;
    overruns(thresholdPct: number): Promise<Overruns>;
    byType(field: "category" | "segment"): Promise<ProjectTypeStat[]>;
    costMix(): Promise<CostMix[]>;
    marginFade(): Promise<FadeFlag[]>;
    standouts(): Promise<StandoutFlag[]>;
    startsByType(): Promise<Record<string, number>>;
  };
  backlog: { summary(): Promise<BacklogSummary> };
  pipeline: { lostByYear(): Promise<Record<number, number>> };
  recurring: {
    annual(year: number): Promise<{ cents: number; sharePct: number }>;
    seasonalSwingPct(): Promise<number>;
  };
  crews: { utilization(): Promise<CrewUtilization> };
  labor: { revenuePerFieldEmployee(year: number): Promise<{ cents: number; fieldCount: number }> };
  fleet: { summary(): Promise<FleetSummary> };
  valuation: {
    compute(): Promise<Valuation>;
    exitReadiness(): Promise<{ score: number; factors: { name: string; score: number }[]; topActions: string[] }>;
  };
  scenarios: {
    loseCustomerShare(customer: string, pct: number): Promise<{ revenueLossCents: number; ebitdaDeltaCents: number }>;
    exitServiceLine(line: string): Promise<{ revenueCents: number; contributionLossCents: number }>;
    growServiceLine(line: string, pct: number): Promise<{ addedRevenueCents: number; newRevenueCents: number }>;
    materialsIncrease(pct: number): Promise<{ addedCostCents: number; ebitdaCents: number; ebitdaImpactPct: number }>;
    /** Owner's what-if inputs; capacity and margin default to the company's own history. */
    crewExpansion(input: CrewExpansionScenario): Promise<{ breakevenRevenueCents: number; breakevenPctOfCapacity: number; year1ContributionCents: number }>;
    fieldHire(count: number): Promise<{ addedCapacityCents: number }>;
    capacityHeadroom(): Promise<{ ceilingCents: number; headroomCents: number; headroomPct: number }>;
    paymentDelay(amountCents: number, days: number): Promise<{ locDrawRequired: boolean; minCashCents: number }>;
  };
}
