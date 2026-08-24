import { prisma } from "@plumb/db";
import {
  computeCashFlow,
  computeHealth,
  computeMargin,
  computeWip,
  expandSchedules,
  summarizeObligations,
  type MilestoneGroup,
  type CashFlowResult,
  type HealthResult,
  type MarginResult,
  type ObligationSummary,
  type ProjectedCashEvent,
  type WipReport,
} from "@plumb/engine";
import { addDays, monthKey } from "@plumb/shared";
import {
  n,
  toEngineProject,
  toEngineCosts,
  toEngineChangeOrders,
  toEngineLiability,
  toEngineRecurring,
  toEngineMilestone,
} from "./map.js";

const DEFAULT_OPENING_CENTS = 250_000_00;
const ACTIVE = ["ACTIVE", "AWARDED"] as const;

export interface CompanySnapshot {
  company: { id: string; name: string; cashSafetyThresholdCents: number };
  openingCashCents: number;
  cash: CashFlowResult;
  /** Scheduled obligations feeding the forecast, and the monthly fixed nut. */
  obligations: ObligationSummary;
  projected: ProjectedCashEvent[];
  margins: MarginResult[];
  wip: WipReport & { rows: (WipReport["rows"][number] & { name?: string })[] };
  health: HealthResult;
  projectNames: Record<string, string>;
}

/**
 * Opening cash for a company: the latest bank snapshot, or the demo default
 * before onboarding sets one. Single source so the forecast and the balance
 * sheet never show different cash.
 */
export async function openingCashCents(companyId: string, fallback?: number): Promise<number> {
  const snap = await prisma.cashSnapshot.findFirst({
    where: { companyId },
    orderBy: { asOf: "desc" },
  });
  return snap ? n(snap.balance) : fallback ?? DEFAULT_OPENING_CENTS;
}

/**
 * The full decision picture for a company at `asOf`: cash forecast (base +
 * stress), per-project margins, WIP, and the health rollup. Single source for
 * the health route and the weekly digest so their numbers never drift.
 */
export async function loadSnapshot(
  companyId: string,
  opts: { asOf?: Date; openingCents?: number; horizonDays?: number; stressDelayDays?: number } = {}
): Promise<CompanySnapshot> {
  const asOf = opts.asOf ?? new Date();
  const horizonDays = opts.horizonDays ?? 90;
  const stressDelayDays = opts.stressDelayDays ?? 30;

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  const openingCash = await openingCashCents(companyId, opts.openingCents);

  const ledger = await prisma.cashEvent.findMany({ where: { companyId } });
  const ledgerEvents = ledger.map((e) => ({
    id: e.id,
    projectId: e.projectId,
    direction: e.direction,
    amountCents: n(e.amount),
    category: e.category,
    expectedDate: e.expectedDate,
    actualDate: e.actualDate,
    status: e.status,
  }));

  // Scheduled obligations become projected events the forecast consumes exactly
  // like observed ones. Anything the ledger already settled (matched by source
  // key) is dropped here rather than counted twice.
  const [liabilityRows, overheadRows, billingProjects] = await Promise.all([
    prisma.liability.findMany({ where: { companyId, active: true } }),
    prisma.recurringExpense.findMany({ where: { companyId, active: true } }),
    prisma.project.findMany({
      where: { companyId, status: { in: [...ACTIVE] } },
      include: { milestones: true },
    }),
  ]);
  const liabilities = liabilityRows.map(toEngineLiability);
  const overheads = overheadRows.map(toEngineRecurring);
  const milestoneGroups: MilestoneGroup[] = billingProjects
    .filter((p) => p.milestones.length > 0)
    .map((p) => ({
      context: {
        projectId: p.id,
        projectName: p.name,
        netDays: p.netDays,
        // Per-payer lateness lands in Phase 11; until then terms are taken at
        // face value and lateness is explored through the stress scenario.
        payerDaysLate: 0,
        retainageReleaseDate: p.expectedEndDate ?? p.endDate,
      },
      milestones: p.milestones.map(toEngineMilestone),
    }));

  const projected = expandSchedules({
    asOf,
    horizonEnd: addDays(asOf, horizonDays),
    liabilities,
    overheads,
    milestoneGroups,
    supersededKeys: ledger.map((e) => e.sourceKey).filter((k): k is string => !!k),
  });
  const obligations = summarizeObligations(overheads, liabilities);

  const cash = computeCashFlow({
    openingCashCents: openingCash,
    asOf,
    horizonDays,
    stressDelayDays,
    safetyThresholdCents: n(company.cashSafetyThreshold),
    events: [...ledgerEvents, ...projected],
  });

  const projects = await prisma.project.findMany({
    where: { companyId, status: { in: [...ACTIVE] } },
    include: { costs: true, changeOrders: true },
  });
  const margins = projects.map((p) =>
    computeMargin(toEngineProject(p), toEngineCosts(p.costs), toEngineChangeOrders(p.changeOrders))
  );
  const projectNames = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const wipReport = computeWip(
    projects.map((p) => ({
      project: toEngineProject(p),
      costs: toEngineCosts(p.costs),
      changeOrders: toEngineChangeOrders(p.changeOrders),
    }))
  );
  const wip = {
    ...wipReport,
    rows: wipReport.rows.map((r) => ({ ...r, name: projectNames[r.projectId] })),
  };

  // Peak crew utilization over the next 3 months.
  const commitments = await prisma.laborCommitment.findMany({
    where: { project: { companyId, status: { in: [...ACTIVE] } } },
  });
  const byMonth: Record<string, number> = {};
  for (const c of commitments) byMonth[c.month] = (byMonth[c.month] ?? 0) + c.hours;
  const next3 = [0, 1, 2].map((m) =>
    monthKey(new Date(asOf.getUTCFullYear(), asOf.getUTCMonth() + m, 1))
  );
  const cap = company.monthlyLaborHours || 1;
  const peakUtilization90d = Math.max(0, ...next3.map((m) => (byMonth[m] ?? 0) / cap));

  // Receivables aging: inbound cash not yet received.
  const inbound = ledger.filter((e) => e.direction === "IN" && e.status !== "RECEIVED");
  const arOutstandingCents = inbound.reduce((a, e) => a + n(e.amount), 0);
  const arPastDueCents = inbound
    .filter((e) => e.expectedDate < asOf)
    .reduce((a, e) => a + n(e.amount), 0);

  const health = computeHealth({
    cash,
    margins,
    portfolioTargetMarginPct: company.portfolioTargetMargin,
    peakUtilization90d,
    arPastDueCents,
    arOutstandingCents,
  });

  return {
    company: {
      id: company.id,
      name: company.name,
      cashSafetyThresholdCents: n(company.cashSafetyThreshold),
    },
    openingCashCents: openingCash,
    cash,
    obligations,
    projected,
    margins,
    wip,
    health,
    projectNames,
  };
}
