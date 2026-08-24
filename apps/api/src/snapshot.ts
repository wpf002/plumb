import { prisma } from "@plumb/db";
import {
  computeCashFlow,
  computeHealth,
  computeMargin,
  computeWip,
  type CashFlowResult,
  type HealthResult,
  type MarginResult,
  type WipReport,
} from "@plumb/engine";
import { monthKey } from "@plumb/shared";
import { n, toEngineProject, toEngineCosts, toEngineChangeOrders } from "./map.js";

const DEFAULT_OPENING_CENTS = 250_000_00;
const ACTIVE = ["ACTIVE", "AWARDED"] as const;

export interface CompanySnapshot {
  company: { id: string; name: string; cashSafetyThresholdCents: number };
  openingCashCents: number;
  cash: CashFlowResult;
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

  const events = await prisma.cashEvent.findMany({ where: { companyId } });
  const cash = computeCashFlow({
    openingCashCents: openingCash,
    asOf,
    horizonDays,
    stressDelayDays,
    safetyThresholdCents: n(company.cashSafetyThreshold),
    events: events.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      direction: e.direction,
      amountCents: n(e.amount),
      category: e.category,
      expectedDate: e.expectedDate,
      actualDate: e.actualDate,
      status: e.status,
    })),
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
  const inbound = events.filter((e) => e.direction === "IN" && e.status !== "RECEIVED");
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
    margins,
    wip,
    health,
    projectNames,
  };
}
