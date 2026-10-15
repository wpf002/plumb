import { prisma } from "@plumb/db";
import { HIRE_DEFAULTS, crewExpansion, fleetSummary, hireAnalysis, type CrewExpansionInput, type FleetAsset, type HireInput } from "@plumb/engine";
import { monthlyEquivalentCents } from "@plumb/shared";
import { companyAsOf } from "../snapshot.js";
import type { Ledger } from "./ledger.js";
import { completeYears, revenuePerFieldEmployee, serviceLines } from "./operations.js";
import { loadJobs } from "./projects.js";
import { workingCapital } from "./workingcapital.js";

/**
 * Fleet and capital decisions for one company. The engine does the math; this
 * module reads the company's data to fill in what it can (margin, capacity,
 * wages, cash) so the owner only supplies the what-if inputs.
 */

const n = (b: bigint | null | undefined) => Number(b ?? 0n);

export async function loadFleet(companyId: string): Promise<FleetAsset[]> {
  const rows = await prisma.asset.findMany({
    where: { companyId, disposedAt: null, category: { in: ["VEHICLE", "EQUIPMENT", "TECHNOLOGY"] } },
    include: { liabilities: { where: { active: true } } },
    orderBy: { purchaseDate: "asc" },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.assetType,
    unitCount: a.unitCount,
    purchaseDate: a.purchaseDate,
    costCents: n(a.purchaseCost),
    salvageCents: n(a.salvageValue),
    usefulLifeMonths: a.usefulLifeMonths,
    marketValueCents: a.currentValue === null ? null : n(a.currentValue),
    replacementCostCents: a.replacementCost === null ? null : n(a.replacementCost),
    annualRepairCents: a.repairCostAnnual === null ? null : n(a.repairCostAnnual),
    annualMaintenanceCents: a.maintenanceCostAnnual === null ? null : n(a.maintenanceCostAnnual),
    downtimeDaysAnnual: a.downtimeDaysAnnual,
    loanBalanceCents: a.liabilities.reduce((s, l) => s + n(l.currentBalance), 0),
    monthlyPaymentCents: a.liabilities.reduce((s, l) => s + monthlyEquivalentCents(n(l.paymentAmount), l.paymentFrequency), 0),
  }));
}

export async function fleet(companyId: string) {
  const asOf = await companyAsOf(companyId);
  return { asOf: asOf.toISOString().slice(0, 10), ...fleetSummary(await loadFleet(companyId), asOf) };
}

/** What the company's own numbers say, used to prefill every capital decision. */
export async function capitalDefaults(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const jobs = (await loadJobs(companyId)).filter((j) => j.actual.total > 0 && j.costKnown);
  const jobMargin = jobs.length ? jobs.reduce((s, j) => s + j.projectedMarginPct, 0) / jobs.length : null;
  const sl = serviceLines(ledger, years);
  const y = years.at(-1);
  const gm = y ? sl.lines.reduce((s, l) => s + l.byYear[y].grossProfitCents, 0) / Math.max(1, sl.lines.reduce((s, l) => s + l.byYear[y].revenueCents, 0)) : null;
  // A mature crew's revenue: the best year of project-type revenue.
  const projectLines = sl.lines.filter((l) => /project|install|construction|remodel|musco|commercial|school/i.test(l.line) && !/recurring|maint|service/i.test(l.line));
  const bestProjectYear = Math.max(0, ...years.map((yr) => projectLines.reduce((s, l) => s + l.byYear[yr].revenueCents, 0)));
  const projectCrews = await prisma.crew.count({ where: { companyId, kind: "PROJECT", employees: { some: {} } } });
  const per = await Promise.all(years.map((yr) => revenuePerFieldEmployee(companyId, ledger, yr).then((r) => ({ yr, ...r }))));
  const best = per.filter((p) => p.fieldCount > 0).sort((a, b) => b.cents - a.cents)[0];
  const field = await prisma.employee.findMany({ where: { companyId, cogsAllocationPct: { gte: 1 } }, include: { timeEntries: { where: { period: { startsWith: String(y ?? asOf.getUTCFullYear()) } } } } });
  const paid = field.filter((e) => e.timeEntries.length);
  const avgWage = paid.length ? paid.reduce((s, e) => s + e.timeEntries.reduce((t, x) => t + n(x.grossPay), 0), 0) / paid.length : null;
  const wc = await workingCapital(companyId, ledger);
  return {
    asOf: asOf.toISOString().slice(0, 10),
    jobMarginPct: jobMargin === null ? null : Math.round(jobMargin * 100) / 100,
    grossMarginPct: gm === null ? null : Math.round(gm * 10000) / 100,
    // Per crew: the best project year split across today's project crews.
    matureCrewCapacityCents: bestProjectYear ? Math.round(bestProjectYear / Math.max(1, projectCrews)) : null,
    revenuePerFieldCents: best?.cents ?? null,
    bestFieldYear: best?.yr ?? null,
    fieldCount: per.at(-1)?.fieldCount ?? 0,
    avgFieldWageCents: avgWage === null ? null : Math.round(avgWage),
    cashCents: wc.cashCents,
    ...HIRE_DEFAULTS,
  };
}

export type CrewExpansionScenario = Omit<CrewExpansionInput, "matureCapacityCents" | "grossMarginPct" | "cashCents"> &
  Partial<Pick<CrewExpansionInput, "matureCapacityCents" | "grossMarginPct">>;

export async function crewExpansionFor(companyId: string, ledger: Ledger, input: CrewExpansionScenario) {
  const d = await capitalDefaults(companyId, ledger);
  const matureCapacityCents = input.matureCapacityCents ?? d.matureCrewCapacityCents ?? 0;
  const grossMarginPct = input.grossMarginPct ?? d.jobMarginPct ?? d.grossMarginPct ?? 0;
  return { assumptions: { matureCapacityCents, grossMarginPct }, ...crewExpansion({ ...input, matureCapacityCents, grossMarginPct, cashCents: d.cashCents }) };
}

export type HireScenario = Partial<HireInput> & { count?: number };

export async function hireFor(companyId: string, ledger: Ledger, input: HireScenario) {
  const d = await capitalDefaults(companyId, ledger);
  const filled: HireInput = {
    annualWageCents: input.annualWageCents ?? d.avgFieldWageCents ?? 0,
    payrollTaxPct: input.payrollTaxPct ?? d.payrollTaxPct,
    workersCompPct: input.workersCompPct ?? d.workersCompPct,
    benefitsMonthlyCents: input.benefitsMonthlyCents ?? 0,
    equipmentMonthlyCents: input.equipmentMonthlyCents ?? 0,
    vehicleMonthlyCents: input.vehicleMonthlyCents ?? 0,
    toolsMonthlyCents: input.toolsMonthlyCents ?? 0,
    grossMarginPct: input.grossMarginPct ?? d.grossMarginPct ?? 0,
    revenuePerFieldEmployeeCents: input.revenuePerFieldEmployeeCents ?? d.revenuePerFieldCents ?? undefined,
    count: input.count ?? 1,
  };
  return { assumptions: filled, ...hireAnalysis(filled) };
}
