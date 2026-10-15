import { Pending, type Analytics } from "./types.js";
import { loadLedger, type Ledger } from "./ledger.js";
import { annualStatement, cashLow, firstCash, monthPoint, netIncomeVariancePct, worstProfitYear } from "./statements.js";
import { arAging, locHistory, toArAging, totalDebtCents } from "./workingcapital.js";
import * as jobs from "./projects.js";
import * as ops from "./operations.js";
import * as capital from "./capital.js";
import * as scen from "./scenarios.js";
import * as val from "./valuation.js";

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
    valuation: {
      compute: async () => val.valuation(companyId, await ledger()),
      exitReadiness: async () => val.exitReadiness(companyId, await ledger()),
    },
    scenarios: {
      loseCustomerShare: async (c, p, o) => scen.loseCustomerShare(companyId, await ledger(), c, p, o),
      exitServiceLine: async (l, o) => scen.exitServiceLine(companyId, await ledger(), l, o),
      growServiceLine: async (l, p, o) => scen.growServiceLine(companyId, await ledger(), l, p, o),
      materialsIncrease: async (p) => scen.materialsIncrease(companyId, await ledger(), p),
      crewExpansion: async (input) => capital.crewExpansionFor(companyId, await ledger(), input),
      fieldHire: async (count) => {
        const h = await capital.hireFor(companyId, await ledger(), { count });
        return { addedCapacityCents: h.addedCapacityCents ?? 0 };
      },
      capacityHeadroom: async () => ops.capacityHeadroom(companyId, await ledger()),
      paymentDelay: (amt, days) => scen.paymentDelay(companyId, amt, days),
    },
  };
}

export * from "./types.js";
