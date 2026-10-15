import { Pending, type Analytics } from "./types.js";
import { loadLedger, type Ledger } from "./ledger.js";
import { annualStatement, cashLow, firstCash, monthPoint, netIncomeVariancePct, worstProfitYear } from "./statements.js";
import { arAging, locHistory, toArAging, totalDebtCents } from "./workingcapital.js";

/**
 * Build the analytics surface for one company. Each domain is filled in by the
 * phase that owns it; until then its methods throw `Pending`, which the
 * acceptance scoreboard reports as not-yet-built rather than as a failure.
 */
export function analyticsFor(companyId: string): Analytics {
  const pending = (phase: string, what: string) => async () => {
    throw new Pending(phase, what);
  };
  // The ledger is loaded once per analytics instance and shared by every domain.
  let ledgerP: Promise<Ledger> | null = null;
  const ledger = () => (ledgerP ??= loadLedger(companyId));
  return {
    companyId,
    statements: {
      annual: async (year) => annualStatement(await ledger(), year),
      month: async (period) => monthPoint(await ledger(), period),
      cashLow: async (year) => cashLow(await ledger(), year),
      firstCash: async () => firstCash(await ledger()),
    },
    budget: {
      netIncomeVariancePct: (year) => netIncomeVariancePct(companyId, year),
      worstProfitYear: () => worstProfitYear(companyId),
    },
    debt: {
      loc: async () => locHistory(companyId, await ledger()),
      totalCents: async () => totalDebtCents(companyId, await ledger()),
    },
    ar: { aging: async () => toArAging((await arAging(companyId)).aging) },
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
