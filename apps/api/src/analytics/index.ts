import { Pending, type Analytics } from "./types.js";

/**
 * Build the analytics surface for one company. Each domain is filled in by the
 * phase that owns it; until then its methods throw `Pending`, which the
 * acceptance scoreboard reports as not-yet-built rather than as a failure.
 */
export function analyticsFor(companyId: string): Analytics {
  const pending = (phase: string, what: string) => async () => {
    throw new Pending(phase, what);
  };
  return {
    companyId,
    statements: {
      annual: pending("D5", "annual statements"),
      month: pending("D5", "monthly statements"),
      cashLow: pending("D5", "cash low point"),
      firstCash: pending("D5", "starting cash"),
    },
    budget: {
      netIncomeVariancePct: pending("D5", "budget vs actual"),
      worstProfitYear: pending("D5", "budget vs actual"),
    },
    debt: { loc: pending("D6", "line-of-credit history"), totalCents: pending("D6", "debt dashboard") },
    ar: { aging: pending("D6", "AR aging") },
    customers: { concentration: pending("D9", "customer concentration") },
    projects: {
      marginPerformance: pending("D8", "margin performance"),
      overruns: pending("D8", "estimate vs actual"),
      byType: pending("D8", "profitability by job type"),
      costMix: pending("D8", "cost mix by job type"),
      marginFade: pending("D8", "WIP margin fade"),
      standouts: pending("D8", "WIP standouts"),
      startsByType: pending("D8", "project starts"),
    },
    backlog: { summary: pending("D8", "backlog") },
    pipeline: { lostByYear: pending("D8", "lost opportunities") },
    recurring: { annual: pending("D9", "recurring revenue"), seasonalSwingPct: pending("D9", "seasonality") },
    crews: { utilization: pending("D9", "crew utilization") },
    labor: { revenuePerFieldEmployee: pending("D9", "labor productivity") },
    fleet: { summary: pending("D10", "fleet") },
    valuation: { compute: pending("D12", "valuation"), exitReadiness: pending("D12", "exit readiness") },
    scenarios: {
      loseCustomerShare: pending("D11", "lose-customer scenario"),
      exitServiceLine: pending("D11", "exit-service-line scenario"),
      growServiceLine: pending("D11", "grow-service-line scenario"),
      materialsIncrease: pending("D11", "materials scenario"),
      crewExpansion: pending("D10", "crew expansion"),
      fieldHire: pending("D10", "hiring analysis"),
      capacityHeadroom: pending("D9", "capacity headroom"),
      paymentDelay: pending("D11", "payment-delay scenario"),
    },
  };
}

export * from "./types.js";
