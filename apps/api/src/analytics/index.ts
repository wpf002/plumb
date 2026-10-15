import { Pending, type Analytics } from "./types.js";
import { loadLedger, type Ledger } from "./ledger.js";
import { annualStatement, cashLow, firstCash, monthPoint, netIncomeVariancePct, worstProfitYear } from "./statements.js";
import { arAging, locHistory, toArAging, totalDebtCents } from "./workingcapital.js";
import * as jobs from "./projects.js";
import * as ops from "./operations.js";
import * as capital from "./capital.js";

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
    customers: { concentration: async () => ops.concentration(companyId, await ledger()) },
    projects: {
      marginPerformance: () => jobs.marginPerformance(companyId),
      overruns: (t) => jobs.overruns(companyId, t),
      byType: (f) => jobs.byType(companyId, f),
      costMix: () => jobs.costMix(companyId),
      marginFade: () => jobs.marginFade(companyId),
      standouts: () => jobs.standouts(companyId),
      startsByType: () => jobs.startsByType(companyId),
    },
    backlog: { summary: () => jobs.backlog(companyId) },
    pipeline: { lostByYear: async () => (await jobs.pipeline(companyId)).lostByYear },
    recurring: {
      annual: async (year) => ops.recurringAnnual(companyId, await ledger(), year),
      seasonalSwingPct: async () => ops.seasonalSwingPct(companyId, await ledger()),
    },
    crews: { utilization: () => ops.crewUtilization(companyId) },
    labor: { revenuePerFieldEmployee: async (year) => ops.revenuePerFieldEmployee(companyId, await ledger(), year) },
    fleet: { summary: () => capital.fleet(companyId) },
    valuation: { compute: pending("D12", "valuation"), exitReadiness: pending("D12", "exit readiness") },
    scenarios: {
      loseCustomerShare: pending("D11", "lose-customer scenario"),
      exitServiceLine: pending("D11", "exit-service-line scenario"),
      growServiceLine: pending("D11", "grow-service-line scenario"),
      materialsIncrease: pending("D11", "materials scenario"),
      crewExpansion: async (input) => capital.crewExpansionFor(companyId, await ledger(), input),
      fieldHire: async (count) => {
        const h = await capital.hireFor(companyId, await ledger(), { count });
        return { addedCapacityCents: h.addedCapacityCents ?? 0 };
      },
      capacityHeadroom: async () => ops.capacityHeadroom(companyId, await ledger()),
      paymentDelay: pending("D11", "payment-delay scenario"),
    },
  };
}

export * from "./types.js";
