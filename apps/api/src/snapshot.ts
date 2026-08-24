import { prisma } from "@plumb/db";
import {
  computeCashFlow,
  computeHealth,
  computeMargin,
  computeWip,
  detectCollisions,
  expandSchedules,
  observePayerBehavior,
  stressDaysLate,
  summarizeMilestones,
  summarizeObligations,
  summarizeServices,
  type MilestoneGroup,
  type CashCollision,
  type MilestoneScheduleSummary,
  type ServiceSummary,
  type CashFlowResult,
  type HealthResult,
  type MarginResult,
  type ObligationSummary,
  type ProjectedCashEvent,
  type ScenarioWorld,
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
  toEngineService,
} from "./map.js";

const DEFAULT_OPENING_CENTS = 250_000_00;
const ACTIVE = ["ACTIVE", "AWARDED"] as const;

export interface CompanySnapshot {
  company: { id: string; name: string; cashSafetyThresholdCents: number };
  openingCashCents: number;
  cash: CashFlowResult;
  /** Scheduled obligations feeding the forecast, and the monthly fixed nut. */
  obligations: ObligationSummary;
  /** Recurring revenue rollup: monthly value, renewals, concentration. */
  services: ServiceSummary;
  /** Per-project billing schedules, for slipped-milestone nudges. */
  billing: MilestoneScheduleSummary[];
  /** Weeks where obligations land on money that may not arrive. */
  collisions: CashCollision[];
  /** Per-payer lateness the forecast planned on, for "why is this the date". */
  payerBehavior: {
    payerId: string;
    name: string;
    typicalDaysLate: number;
    stressDaysLate: number;
    sampleSize: number;
    source: string;
    projectIds: string[];
  }[];
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

export interface LoadedWorld {
  world: ScenarioWorld;
  /** Recurring revenue: what it's worth per month and what could walk. */
  services: ServiceSummary;
  /** Per-project billing schedules — coverage, what's left to bill, slip. */
  billing: MilestoneScheduleSummary[];
  /** Capacity and target margin, needed by the health rollup. */
  targets: { monthlyLaborHours: number; portfolioTargetMarginPct: number };
  obligations: ObligationSummary;
  payerBehavior: CompanySnapshot["payerBehavior"];
  projected: ProjectedCashEvent[];
  company: { id: string; name: string; cashSafetyThresholdCents: number };
}

/**
 * Everything a forecast is built from, assembled once.
 *
 * Both the snapshot and the scenario engine consume this, which is what
 * guarantees a "what if" is compared against exactly the same base the
 * dashboard is showing.
 */
export async function loadWorld(
  companyId: string,
  opts: { asOf?: Date; openingCents?: number; horizonDays?: number; stressDelayDays?: number } = {}
): Promise<LoadedWorld> {
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

  const [liabilityRows, overheadRows, serviceRows, billingProjects] = await Promise.all([
    prisma.liability.findMany({ where: { companyId, active: true } }),
    prisma.recurringExpense.findMany({ where: { companyId, active: true } }),
    prisma.serviceContract.findMany({
      where: { companyId, status: "ACTIVE" },
      include: { payer: { select: { typicalDaysLate: true } } },
    }),
    prisma.project.findMany({
      where: { companyId, status: { in: [...ACTIVE] } },
      include: { milestones: true, payer: true },
    }),
  ]);

  // How late each payer actually runs. Terms say 30 days; a school district may
  // take 70. The forecast plans on observed behaviour, and the stress scenario
  // puts every payer at their own worst rather than one flat number for all.
  const settled = ledger.filter((e) => e.direction === "IN" && e.actualDate && e.projectId);
  const payerOfProject = new Map(billingProjects.map((p) => [p.id, p.payer]));
  const settledByPayer = new Map<string, { dueDate: Date; paidDate: Date; amountCents: number }[]>();
  for (const e of settled) {
    const payer = payerOfProject.get(e.projectId!);
    if (!payer) continue;
    const list = settledByPayer.get(payer.id) ?? [];
    list.push({ dueDate: e.expectedDate, paidDate: e.actualDate!, amountCents: n(e.amount) });
    settledByPayer.set(payer.id, list);
  }

  const stressDelayByProjectId: Record<string, number> = {};
  const payerBehavior: CompanySnapshot["payerBehavior"] = [];
  const seenPayers = new Set<string>();
  for (const p of billingProjects) {
    if (!p.payer) continue;
    const observation = observePayerBehavior(settledByPayer.get(p.payer.id) ?? []);
    const worst = stressDaysLate(p.payer, observation, stressDelayDays);
    stressDelayByProjectId[p.id] = worst;
    if (!seenPayers.has(p.payer.id)) {
      seenPayers.add(p.payer.id);
      payerBehavior.push({
        payerId: p.payer.id,
        name: p.payer.name,
        typicalDaysLate: p.payer.typicalDaysLate,
        stressDaysLate: worst,
        sampleSize: observation.sampleSize || p.payer.sampleSize,
        source: p.payer.source,
        projectIds: billingProjects.filter((x) => x.payerId === p.payer!.id).map((x) => x.id),
      });
    }
  }

  const liabilities = liabilityRows.map(toEngineLiability);
  const overheads = overheadRows.map(toEngineRecurring);
  const milestoneGroups: MilestoneGroup[] = billingProjects
    .filter((p) => p.milestones.length > 0)
    .map((p) => ({
      context: {
        projectId: p.id,
        projectName: p.name,
        netDays: p.netDays,
        payerDaysLate: p.payer?.typicalDaysLate ?? 0,
        retainageReleaseDate: p.expectedEndDate ?? p.endDate,
      },
      milestones: p.milestones.map(toEngineMilestone),
    }));

  const services = serviceRows.map(toEngineService);
  const schedule = {
    asOf,
    horizonEnd: addDays(asOf, horizonDays),
    liabilities,
    overheads,
    milestoneGroups,
    services,
    supersededKeys: ledger.map((e) => e.sourceKey).filter((k): k is string => !!k),
  };

  return {
    world: {
      asOf,
      horizonDays,
      openingCashCents: openingCash,
      safetyThresholdCents: n(company.cashSafetyThreshold),
      stressDelayDays,
      stressDelayByProjectId,
      ledger: ledgerEvents,
      schedule,
    },
    targets: {
      monthlyLaborHours: company.monthlyLaborHours,
      portfolioTargetMarginPct: company.portfolioTargetMargin,
    },
    obligations: summarizeObligations(overheads, liabilities),
    services: summarizeServices(services, asOf),
    billing: billingProjects
      .filter((p) => p.milestones.length > 0)
      .map((p) =>
        summarizeMilestones(p.id, n(p.contractValue), p.milestones.map(toEngineMilestone), asOf)
      ),
    payerBehavior,
    projected: expandSchedules(schedule),
    company: {
      id: company.id,
      name: company.name,
      cashSafetyThresholdCents: n(company.cashSafetyThreshold),
    },
  };
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
  const loaded = await loadWorld(companyId, opts);
  const { world, obligations, services, billing, payerBehavior, projected, company, targets } =
    loaded;

  const cash = computeCashFlow({
    openingCashCents: world.openingCashCents,
    asOf: world.asOf,
    horizonDays: world.horizonDays,
    stressDelayDays: world.stressDelayDays,
    stressDelayByProjectId: world.stressDelayByProjectId,
    safetyThresholdCents: world.safetyThresholdCents,
    events: [...world.ledger, ...projected],
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
  const cap = targets.monthlyLaborHours || 1;
  const peakUtilization90d = Math.max(0, ...next3.map((m) => (byMonth[m] ?? 0) / cap));

  // Receivables aging: inbound cash not yet received.
  const inbound = world.ledger.filter((e) => e.direction === "IN" && e.status !== "RECEIVED");
  const arOutstandingCents = inbound.reduce((a, e) => a + e.amountCents, 0);
  const arPastDueCents = inbound
    .filter((e) => e.expectedDate < asOf)
    .reduce((a, e) => a + e.amountCents, 0);

  // Weeks that are fine on paper but not if a slow payer slips — the collision
  // the AI layer reports, and only expressible now that obligations and
  // billings are structured data.
  const payerDaysLateByProject: Record<string, number> = {};
  for (const p of payerBehavior) {
    for (const id of p.projectIds) payerDaysLateByProject[id] = p.typicalDaysLate;
  }
  const collisions = detectCollisions({
    asOf,
    horizonDays: world.horizonDays,
    openingCashCents: world.openingCashCents,
    safetyThresholdCents: world.safetyThresholdCents,
    events: [...world.ledger, ...projected],
    payerDaysLateByProject,
    projectNames,
  });

  const health = computeHealth({
    cash,
    margins,
    portfolioTargetMarginPct: targets.portfolioTargetMarginPct,
    peakUtilization90d,
    arPastDueCents,
    arOutstandingCents,
  });

  return {
    company,
    openingCashCents: world.openingCashCents,
    cash,
    obligations,
    services,
    billing,
    collisions,
    payerBehavior,
    projected,
    margins,
    wip,
    health,
    projectNames,
  };
}
