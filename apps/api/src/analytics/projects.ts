import { prisma } from "@plumb/db";
import { incomeTotals, monthKeyOf } from "@plumb/engine";
import { addDays } from "@plumb/shared";
import { companyAsOf } from "../snapshot.js";
import { loadLedger } from "./ledger.js";
import type { CostMix, FadeFlag, MarginPerformance, Overruns, ProjectTypeStat, StandoutFlag } from "./types.js";

/**
 * Job-level financials: profitability, estimate vs actual, WIP, over/under
 * billing, change orders, retainage, backlog, and pipeline. One loader feeds
 * every view so the numbers agree across tabs.
 */

const n = (b: bigint | null | undefined) => Number(b ?? 0n);
const pct = (v: number, base: number) => (base === 0 ? 0 : Math.round((v / base) * 10000) / 100);
const CATS = ["LABOR", "MATERIAL", "SUBCONTRACT", "EQUIPMENT", "OTHER"] as const;

/** Margin gap (points) beyond which a finished job counts as under- or over-performing. */
export const PERFORMANCE_BAND_PTS = 5;

export interface Job {
  id: string;
  externalId: string | null;
  name: string;
  customer: string;
  type: string | null;
  category: string | null;
  segment: string | null;
  status: string;
  start: Date;
  end: Date;
  originalContractCents: number;
  approvedChangeOrdersCents: number;
  pendingChangeOrdersCents: number;
  revisedContractCents: number;
  estimate: Record<string, number> & { total: number; hours: number };
  actual: Record<string, number> & { total: number };
  projectedTotalCostCents: number;
  projectedGrossProfitCents: number;
  originalMarginPct: number;
  targetMarginPct: number;
  projectedMarginPct: number;
  percentComplete: number;
  /** False for signed jobs with no estimate or cost lines; projections then use the target margin. */
  costKnown: boolean;
  costVariancePct: number;
  flag: "on_track" | "at_risk" | "over" | "under" | "outperform";
}

export async function loadJobs(companyId: string): Promise<Job[]> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { portfolioTargetMargin: true } });
  const rows = await prisma.project.findMany({
    where: { companyId },
    include: { budgetLines: true, costs: true, changeOrders: true, customer: true, periods: { orderBy: { period: "desc" }, take: 1 } },
    orderBy: { startDate: "asc" },
  });
  return rows.map((p) => {
    const approved = p.changeOrders.filter((c) => c.status === "APPROVED").reduce((s, c) => s + n(c.contractDelta), 0);
    const pending = p.changeOrders.filter((c) => c.status === "PENDING" || c.status === "REQUESTED").reduce((s, c) => s + n(c.contractDelta), 0);
    const approvedCost = p.changeOrders.filter((c) => c.status === "APPROVED").reduce((s, c) => s + n(c.costDelta), 0);
    const revised = n(p.contractValue) + approved;
    const estimate = Object.fromEntries(CATS.map((c) => [c, 0])) as Job["estimate"];
    estimate.total = 0;
    estimate.hours = 0;
    for (const b of p.budgetLines) {
      const cat = b.category === "TRAVEL" ? "OTHER" : b.category;
      estimate[cat] = (estimate[cat] ?? 0) + n(b.budgetedCost);
      estimate.total += n(b.budgetedCost);
      estimate.hours += b.budgetedHours ?? 0;
    }
    if (estimate.total === 0) estimate.total = n(p.originalBidCost);
    const actual = Object.fromEntries(CATS.map((c) => [c, 0])) as Job["actual"];
    actual.total = 0;
    for (const c of p.costs) {
      const cat = c.category === "TRAVEL" ? "OTHER" : c.category;
      actual[cat] = (actual[cat] ?? 0) + n(c.amount);
      actual.total += n(c.amount);
    }
    const latest = p.periods[0];
    const pctComplete = p.status === "CLOSED" ? 1 : latest ? latest.pctComplete : p.percentComplete ?? 0;
    // Projected final cost: the current estimate from the WIP schedule when the
    // job has one; otherwise actual-to-date grossed up by percent complete,
    // never below the original estimate plus approved change-order cost.
    const costKnown = estimate.total > 0 || actual.total > 0 || !!latest?.estimatedTotalCost;
    let projectedCost: number;
    if (!costKnown) projectedCost = revised * (1 - (p.targetMarginPct || company.portfolioTargetMargin) / 100);
    else if (p.status === "CLOSED") projectedCost = actual.total || estimate.total;
    else if (latest?.estimatedTotalCost) projectedCost = n(latest.estimatedTotalCost);
    else if (pctComplete > 0.05 && actual.total > 0) projectedCost = Math.max(actual.total / pctComplete, actual.total);
    else projectedCost = estimate.total + approvedCost;
    const gp = revised - projectedCost;
    const projectedMargin = pct(gp, revised);
    const originalMargin = pct(n(p.contractValue) - estimate.total, n(p.contractValue));
    const gap = projectedMargin - p.targetMarginPct;
    const flag: Job["flag"] =
      p.status === "CLOSED"
        ? gap < -PERFORMANCE_BAND_PTS
          ? "under"
          : gap > PERFORMANCE_BAND_PTS
            ? "outperform"
            : "on_track"
        : gap < -PERFORMANCE_BAND_PTS
          ? "over"
          : gap < -2
            ? "at_risk"
            : "on_track";
    return {
      id: p.id,
      externalId: p.externalId,
      name: p.name,
      customer: p.customer?.name ?? p.client,
      type: p.category,
      category: p.segment && p.category && p.segment !== p.category ? p.segment : p.category,
      segment: p.segment,
      status: p.status,
      start: p.startDate,
      end: p.expectedEndDate ?? p.endDate,
      originalContractCents: n(p.contractValue),
      approvedChangeOrdersCents: approved,
      pendingChangeOrdersCents: pending,
      revisedContractCents: revised,
      estimate,
      actual,
      projectedTotalCostCents: Math.round(projectedCost),
      projectedGrossProfitCents: Math.round(gp),
      originalMarginPct: originalMargin,
      targetMarginPct: p.targetMarginPct,
      projectedMarginPct: projectedMargin,
      percentComplete: pctComplete,
      costKnown,
      costVariancePct: estimate.total ? pct(actual.total - estimate.total, estimate.total) : 0,
      flag,
    };
  });
}

// ---- acceptance-facing analytics ------------------------------------------

export async function marginPerformance(companyId: string): Promise<MarginPerformance> {
  const jobs = (await loadJobs(companyId)).filter((j) => !j.externalId?.startsWith("BL-"));
  const closed = jobs.filter((j) => j.status === "CLOSED" || j.percentComplete >= 1);
  const scored = jobs.filter((j) => j.actual.total > 0);
  const gaps = scored.map((j) => ({ j, gap: j.projectedMarginPct - j.targetMarginPct }));
  const under = gaps.filter((g) => g.gap < -PERFORMANCE_BAND_PTS);
  const over = gaps.filter((g) => g.gap > PERFORMANCE_BAND_PTS);
  return {
    count: scored.length || closed.length,
    under: {
      count: under.length,
      avgActualMarginPct: under.length ? Math.round((under.reduce((s, g) => s + g.j.projectedMarginPct, 0) / under.length) * 100) / 100 : 0,
      minGapPts: under.length ? Math.min(...under.map((g) => -g.gap)) : 0,
      maxGapPts: under.length ? Math.max(...under.map((g) => -g.gap)) : 0,
    },
    over: { count: over.length },
  };
}

export async function overruns(companyId: string, thresholdPct: number): Promise<Overruns> {
  const jobs = (await loadJobs(companyId)).filter((j) => j.actual.total > 0 && j.estimate.total > 0);
  const hit = jobs.filter((j) => j.actual.total > j.estimate.total * (1 + thresholdPct / 100));
  return { count: hit.length, total: jobs.length, grossProfitErodedCents: hit.reduce((s, j) => s + (j.actual.total - j.estimate.total), 0) };
}

export async function byType(companyId: string, field: "category" | "segment"): Promise<ProjectTypeStat[]> {
  const jobs = (await loadJobs(companyId)).filter((j) => j.actual.total > 0);
  const groups = new Map<string, Job[]>();
  for (const j of jobs) {
    const key = (field === "category" ? j.category : j.segment) ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  return [...groups].map(([type, js]) => ({
    type,
    count: js.length,
    avgMarginPct: Math.round((js.reduce((s, j) => s + j.projectedMarginPct, 0) / js.length) * 100) / 100,
    contractCents: js.reduce((s, j) => s + j.originalContractCents, 0),
  }));
}

export async function costMix(companyId: string, by: "type" | "category" = "type"): Promise<CostMix[]> {
  const jobs = (await loadJobs(companyId)).filter((j) => j.actual.total > 0);
  const groups = new Map<string, { labor: number; materials: number; total: number }>();
  for (const j of jobs) {
    const key = (by === "type" ? j.type : j.category) ?? "Other";
    const g = groups.get(key) ?? { labor: 0, materials: 0, total: 0 };
    g.labor += j.actual.LABOR;
    g.materials += j.actual.MATERIAL;
    g.total += j.actual.total;
    groups.set(key, g);
  }
  return [...groups].map(([category, g]) => ({ category, laborPct: pct(g.labor, g.total), materialsPct: pct(g.materials, g.total) }));
}

/** Jobs whose projected margin on the WIP schedule fell 5+ points from its high. */
export async function marginFade(companyId: string): Promise<FadeFlag[]> {
  const projects = await prisma.project.findMany({ where: { companyId }, include: { periods: { orderBy: { period: "asc" } } } });
  const out: FadeFlag[] = [];
  for (const p of projects) {
    const path = p.periods
      .filter((x) => x.projectedGrossProfit !== null && x.revisedContract && n(x.revisedContract) > 0)
      .map((x) => pct(n(x.projectedGrossProfit), n(x.revisedContract)));
    if (path.length < 2) continue;
    const peak = Math.max(...path);
    const final = path.at(-1)!;
    if (peak - final >= 5) {
      out.push({ externalId: p.externalId ?? p.id, originalContractCents: n(p.contractValue), peakProjectedMarginPct: peak, finalMarginPct: final });
    }
  }
  return out.sort((a, b) => b.peakProjectedMarginPct - b.finalMarginPct - (a.peakProjectedMarginPct - a.finalMarginPct));
}

/** Finished jobs 3.5+ points above their category's average margin — what to repeat. */
export async function standouts(companyId: string): Promise<StandoutFlag[]> {
  const jobs = (await loadJobs(companyId)).filter((j) => j.actual.total > 0 && j.status === "CLOSED");
  const sums = new Map<string, { total: number; count: number }>();
  for (const j of jobs) {
    const g = sums.get(j.category ?? "Other") ?? { total: 0, count: 0 };
    g.total += j.projectedMarginPct;
    g.count++;
    sums.set(j.category ?? "Other", g);
  }
  const avg = new Map([...sums].map(([k, g]) => [k, g.total / g.count]));
  return jobs
    .map((j) => ({ j, a: avg.get(j.category ?? "Other")! }))
    .filter(({ j, a }) => j.projectedMarginPct - a >= 3.5)
    .sort((x, y) => y.j.projectedMarginPct - y.a - (x.j.projectedMarginPct - x.a))
    .map(({ j, a }) => ({
      externalId: j.externalId ?? j.id,
      originalContractCents: j.originalContractCents,
      finalMarginPct: j.projectedMarginPct,
      categoryAvgMarginPct: Math.round(a * 100) / 100,
    }));
}

export async function startsByType(companyId: string): Promise<Record<string, number>> {
  const jobs = (await loadJobs(companyId)).filter((j) => !j.externalId?.startsWith("BL-"));
  const out: Record<string, number> = {};
  for (const j of jobs) out[j.type ?? "Other"] = (out[j.type ?? "Other"] ?? 0) + 1;
  return out;
}

// ---- WIP, change orders, retainage ------------------------------------------

export interface WipRow {
  id: string;
  externalId: string | null;
  name: string;
  revisedContractCents: number;
  approvedChangeOrdersCents: number;
  estimatedTotalCostCents: number;
  costToDateCents: number | null;
  committedCents: number;
  costToCompleteCents: number | null;
  percentComplete: number;
  earnedCents: number;
  /** Null when the source has no project-level billing (invoices not tied to jobs). */
  billedCents: number | null;
  collectedCents: number | null;
  grossProfitCents: number;
  projectedMarginPct: number;
  originalMarginPct: number;
  overUnderCents: number | null; // + overbilled (liability), - underbilled (asset)
  retainageHeldCents: number;
  pendingChangeOrdersCents: number;
  flags: string[];
}

export async function wip(companyId: string) {
  const asOf = await companyAsOf(companyId);
  const asOfMonth = monthKeyOf(asOf);
  const jobs = new Map((await loadJobs(companyId)).map((j) => [j.id, j]));
  const projects = await prisma.project.findMany({
    where: { companyId, status: { not: "CLOSED" } },
    include: { periods: true, invoices: true, changeOrders: true },
  });
  const rows: WipRow[] = [];
  for (const p of projects) {
    const j = jobs.get(p.id)!;
    if (j.externalId?.startsWith("BL-") && j.percentComplete === 0) continue; // signed, not started: backlog, not WIP
    const upTo = p.periods.filter((x) => x.period <= asOfMonth).sort((a, b) => a.period.localeCompare(b.period));
    const last = upTo.at(-1);
    const pctComplete = last ? last.pctComplete : j.percentComplete;
    const costToDate = last ? n(last.costCumulative) : j.actual.total;
    const estTotal = last?.estimatedTotalCost ? n(last.estimatedTotalCost) : j.projectedTotalCostCents;
    const revised = last?.revisedContract ? n(last.revisedContract) : j.revisedContractCents;
    const earned = last ? n(last.revenueCumulative) : Math.round(revised * pctComplete);
    const invoicesToDate = p.invoices.filter((i) => i.issueDate <= asOf);
    const hasBilling = last?.billedCumulative != null || p.invoices.length > 0 || n(p.billedToDate) > 0;
    const billed = !hasBilling ? null : last?.billedCumulative != null ? n(last.billedCumulative) : invoicesToDate.reduce((s, i) => s + n(i.amount), 0) || n(p.billedToDate);
    const collected = p.invoices.length ? invoicesToDate.filter((i) => i.paidDate && i.paidDate <= asOf).reduce((s, i) => s + n(i.amount), 0) : null;
    const retainage = last?.retainageHeldCumulative != null ? n(last.retainageHeldCumulative) : Math.round(((billed ?? 0) * p.retainagePct) / 100);
    const gp = revised - estTotal;
    const margin = pct(gp, revised);
    const pendingCo = p.changeOrders.filter((c) => c.status === "PENDING" || c.status === "REQUESTED").reduce((s, c) => s + n(c.contractDelta), 0);
    const overUnder = billed === null ? null : billed - earned;
    const flags: string[] = [];
    if (j.originalMarginPct - margin >= 3) flags.push(`margin fade ${(j.originalMarginPct - margin).toFixed(1)} pts`);
    if (overUnder !== null && -overUnder > revised * 0.1 && -overUnder > 25_000_00) flags.push("materially underbilled");
    if (collected !== null && j.costKnown && collected < costToDate) flags.push("consuming cash");
    if (pctComplete >= 0.85 && pendingCo > 0) flags.push("near completion with open change orders");
    rows.push({
      id: p.id,
      externalId: p.externalId,
      name: p.name,
      revisedContractCents: revised,
      approvedChangeOrdersCents: j.approvedChangeOrdersCents,
      estimatedTotalCostCents: estTotal,
      costToDateCents: j.costKnown ? costToDate : null,
      committedCents: last?.committedCost != null ? n(last.committedCost) : 0,
      costToCompleteCents: j.costKnown ? Math.max(0, estTotal - costToDate) : null,
      percentComplete: pctComplete,
      earnedCents: earned,
      billedCents: billed,
      collectedCents: collected,
      grossProfitCents: gp,
      projectedMarginPct: margin,
      originalMarginPct: j.originalMarginPct,
      overUnderCents: overUnder,
      retainageHeldCents: retainage,
      pendingChangeOrdersCents: pendingCo,
      flags,
    });
  }
  const sum = (k: keyof WipRow) => rows.reduce((s, r) => s + ((r[k] as number | null) ?? 0), 0);
  return {
    asOf: asOf.toISOString().slice(0, 10),
    billingKnown: rows.some((r) => r.billedCents !== null),
    rows: rows.sort((a, b) => (a.overUnderCents ?? 0) - (b.overUnderCents ?? 0) || b.revisedContractCents - a.revisedContractCents),
    totals: {
      contract: sum("revisedContractCents"),
      earned: sum("earnedCents"),
      billed: sum("billedCents"),
      collected: sum("collectedCents"),
      overbilled: rows.reduce((s, r) => s + Math.max(0, r.overUnderCents ?? 0), 0),
      underbilled: rows.reduce((s, r) => s + Math.max(0, -(r.overUnderCents ?? 0)), 0),
      retainage: sum("retainageHeldCents"),
    },
  };
}

export async function changeOrders(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const cos = await prisma.changeOrder.findMany({ where: { project: { companyId } }, include: { project: { include: { periods: { orderBy: { period: "desc" }, take: 1 }, invoices: true } } }, orderBy: { date: "desc" } });
  const byStatus: Record<string, { count: number; valueCents: number; costCents: number }> = {};
  for (const c of cos) {
    const s = (byStatus[c.status] ??= { count: 0, valueCents: 0, costCents: 0 });
    s.count++;
    s.valueCents += n(c.contractDelta);
    s.costCents += n(c.costDelta);
  }
  const marginOf = (c: (typeof cos)[number]) => (n(c.contractDelta) > 0 && n(c.costDelta) > 0 ? pct(n(c.contractDelta) - n(c.costDelta), n(c.contractDelta)) : null);
  const scope = new Map<string, { name: string; original: number; changes: number }>();
  for (const c of cos.filter((x) => x.status !== "REJECTED")) {
    const s = scope.get(c.projectId) ?? { name: c.project.name, original: n(c.project.contractValue), changes: 0 };
    s.changes += n(c.contractDelta);
    scope.set(c.projectId, s);
  }
  // Approved change-order value not yet billed on open jobs: billing past the
  // original contract is counted against the change orders first.
  const unbilledByProject = new Map<string, number>();
  for (const c of cos.filter((x) => x.status === "APPROVED" && x.project.status !== "CLOSED")) unbilledByProject.set(c.projectId, (unbilledByProject.get(c.projectId) ?? 0) + n(c.contractDelta));
  let unbilledApproved = 0;
  for (const [pid, approvedValue] of unbilledByProject) {
    const p = cos.find((c) => c.projectId === pid)!.project;
    const billed = p.periods[0]?.billedCumulative != null ? n(p.periods[0].billedCumulative) : p.invoices.reduce((t, i) => t + n(i.amount), 0) || n(p.billedToDate);
    unbilledApproved += Math.max(0, approvedValue - Math.max(0, billed - n(p.contractValue)));
  }
  return {
    byStatus,
    totals: {
      unbilledApprovedCents: unbilledApproved,
      valueCents: cos.reduce((s, c) => s + n(c.contractDelta), 0),
      costCents: cos.reduce((s, c) => s + n(c.costDelta), 0),
      timeImpactDays: cos.reduce((s, c) => s + (c.timeImpactDays ?? 0), 0),
    },
    unapprovedWork: cos.filter((c) => c.status !== "APPROVED" && c.status !== "REJECTED" && (c.performedBeforeApproval || c.project.status !== "CLOSED")).map((c) => ({
      project: c.project.name,
      valueCents: n(c.contractDelta),
      status: c.status,
      performed: c.performedBeforeApproval,
    })),
    lowMargin: cos.filter((c) => {
      const m = marginOf(c);
      return m !== null && m < company.portfolioTargetMargin;
    }).map((c) => ({ project: c.project.name, valueCents: n(c.contractDelta), marginPct: marginOf(c) })),
    scopeCreep: [...scope.values()].filter((s) => s.original > 0 && s.changes / s.original > 0.15).map((s) => ({ project: s.name, changesPct: pct(s.changes, s.original) })),
    recent: cos.slice(0, 25).map((c) => ({
      id: c.id,
      project: c.project.name,
      status: c.status,
      valueCents: n(c.contractDelta),
      costCents: n(c.costDelta),
      marginPct: marginOf(c),
      timeImpactDays: c.timeImpactDays,
      date: c.date,
      reason: c.reason,
    })),
  };
}

export async function retainage(companyId: string) {
  const asOf = await companyAsOf(companyId);
  const w = await wip(companyId);
  const projects = await prisma.project.findMany({ where: { companyId }, include: { periods: true } });
  const asOfMonth = monthKeyOf(asOf);
  const rows = [];
  for (const p of projects) {
    const live = w.rows.find((r) => r.id === p.id);
    const last = p.periods.filter((x) => x.period <= asOfMonth).sort((a, b) => a.period.localeCompare(b.period)).at(-1);
    const held = live?.retainageHeldCents ?? (last?.retainageHeldCumulative != null ? n(last.retainageHeldCumulative) : 0);
    if (held <= 0 && p.retainagePct <= 0) continue;
    const release = addDays(p.expectedEndDate ?? p.endDate, p.netDays);
    rows.push({ project: p.name, ratePct: p.retainagePct, heldCents: held, expectedRelease: release, closed: p.status === "CLOSED" });
  }
  const outstanding = rows.filter((r) => r.heldCents > 0);
  // Released retainage: the most a job ever had held, less what's still held.
  const collected = projects.reduce((t, p) => {
    const held = p.periods
      .filter((x) => x.period <= asOfMonth && x.retainageHeldCumulative != null)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((x) => n(x.retainageHeldCumulative));
    if (!held.length) return t;
    const live = w.rows.find((r) => r.id === p.id)?.retainageHeldCents ?? held[held.length - 1];
    return t + Math.max(0, Math.max(...held) - (p.status === "CLOSED" ? 0 : live));
  }, 0);
  const in90 = outstanding.filter((r) => r.expectedRelease <= addDays(asOf, 90));
  return {
    asOf: asOf.toISOString().slice(0, 10),
    totalHeldCents: outstanding.reduce((s, r) => s + r.heldCents, 0),
    next90Cents: in90.reduce((s, r) => s + r.heldCents, 0),
    collectedCents: collected,
    rows: outstanding.sort((a, b) => a.expectedRelease.getTime() - b.expectedRelease.getTime()),
  };
}

// ---- backlog + pipeline -------------------------------------------------

export async function backlog(companyId: string) {
  const asOf = await companyAsOf(companyId);
  const jobs = (await loadJobs(companyId)).filter((j) => j.status !== "CLOSED" && j.percentComplete < 1);
  const rows = jobs.map((j) => {
    const remaining = Math.round(j.revisedContractCents * (1 - j.percentComplete));
    const expectedMargin = j.targetMarginPct || j.originalMarginPct;
    return {
      id: j.id,
      name: j.name,
      customer: j.customer,
      contractCents: j.revisedContractCents,
      remainingCents: remaining,
      start: j.start,
      end: j.end,
      expectedMarginPct: expectedMargin,
      expectedLaborHours: Math.round(j.estimate.hours * (1 - j.percentComplete)),
    };
  });
  const signed = rows.reduce((s, r) => s + r.remainingCents, 0);
  const opps = await prisma.opportunity.findMany({ where: { companyId, status: "OPEN" } });
  const weighted = opps.reduce((s, o) => s + Math.round((n(o.estimatedValue) * o.probabilityPct) / 100), 0);

  const ledger = await loadLedger(companyId);
  const periods = ledger.periods.filter((p) => p <= monthKeyOf(asOf));
  const lastYear = periods.slice(-12);
  const lastYearRevenue = lastYear.length ? incomeTotals(ledger.accounts, lastYear).revenue : 0;
  // Monthly burn of project revenue: what the backlog has to cover each month.
  const projectPeriods = await prisma.projectPeriod.findMany({ where: { project: { companyId }, period: { in: periods.slice(-3) } } });
  const monthlyProjectRevenue = projectPeriods.reduce((s, p) => s + n(p.revenueMonth), 0) / Math.max(1, Math.min(3, periods.length));
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const bookedHours = rows.reduce((s, r) => s + r.expectedLaborHours, 0);
  return {
    asOf: asOf.toISOString().slice(0, 10),
    signedCents: signed,
    weightedPipelineCents: weighted,
    coverageOfLastYearRevenuePct: lastYearRevenue ? Math.round(((signed + weighted) / lastYearRevenue) * 1000) / 10 : 0,
    monthsOfCoverage: monthlyProjectRevenue > 0 ? Math.round((signed / monthlyProjectRevenue) * 10) / 10 : null,
    capacityMonthsBooked: company.monthlyLaborHours > 0 && bookedHours > 0 ? Math.round((bookedHours / company.monthlyLaborHours) * 10) / 10 : null,
    rows: rows.sort((a, b) => b.remainingCents - a.remainingCents),
  };
}

export async function pipeline(companyId: string) {
  const asOf = await companyAsOf(companyId);
  const opps = await prisma.opportunity.findMany({ where: { companyId }, include: { customer: true }, orderBy: { expectedStart: "asc" } });
  const jobs = (await loadJobs(companyId)).filter((j) => j.actual.total > 0);
  const histMargin = jobs.length ? jobs.reduce((s, j) => s + j.projectedMarginPct, 0) / jobs.length : 0;
  const open = opps.filter((o) => o.status === "OPEN").map((o) => {
    const weighted = Math.round((n(o.estimatedValue) * o.probabilityPct) / 100);
    const margin = o.expectedMarginPct ?? histMargin;
    return {
      id: o.id,
      opportunity: o.description,
      customer: o.customer?.name ?? null,
      valueCents: n(o.estimatedValue),
      probabilityPct: o.probabilityPct,
      weightedCents: weighted,
      expectedMarginPct: Math.round(margin * 10) / 10,
      expectedGrossProfitCents: Math.round((weighted * margin) / 100),
      expectedStart: o.expectedStart,
      expectedClose: o.expectedClose,
    };
  });
  const lost = opps.filter((o) => o.status === "LOST");
  const lostByYear: Record<number, number> = {};
  const lostReasons: Record<string, number> = {};
  for (const o of lost) {
    if (o.lostYear) lostByYear[o.lostYear] = (lostByYear[o.lostYear] ?? 0) + n(o.estimatedValue);
    if (o.lostReason) lostReasons[o.lostReason] = (lostReasons[o.lostReason] ?? 0) + n(o.estimatedValue);
  }
  return {
    asOf: asOf.toISOString().slice(0, 10),
    totals: {
      pipelineCents: open.reduce((s, o) => s + o.valueCents, 0),
      weightedCents: open.reduce((s, o) => s + o.weightedCents, 0),
      expectedGrossProfitCents: open.reduce((s, o) => s + o.expectedGrossProfitCents, 0),
      historicalMarginPct: Math.round(histMargin * 10) / 10,
    },
    open,
    lostByYear,
    lostReasons,
  };
}

/** Completed jobs: estimate vs actual by line, and which job types run over. */
export async function estimateVsActual(companyId: string) {
  const done = (await loadJobs(companyId)).filter((j) => j.actual.total > 0 && j.estimate.total > 0 && (j.status === "CLOSED" || j.percentComplete >= 1));
  const lines = (["LABOR", "MATERIAL", "SUBCONTRACT", "EQUIPMENT", "OTHER"] as const).map((cat) => {
    const est = done.reduce((s, j) => s + j.estimate[cat], 0);
    const act = done.reduce((s, j) => s + j.actual[cat], 0);
    return { category: cat, estimatedCents: est, actualCents: act, variancePct: est ? pct(act - est, est) : null };
  }).filter((l) => l.estimatedCents > 0 || l.actualCents > 0);
  const byTypeMap = new Map<string, Job[]>();
  for (const j of done) byTypeMap.set(j.type ?? "Other", [...(byTypeMap.get(j.type ?? "Other") ?? []), j]);
  const types = [...byTypeMap].map(([type, js]) => {
    const variances = js.map((j) => j.costVariancePct).sort((a, b) => a - b);
    const median = variances[Math.floor(variances.length / 2)];
    const overShare = js.filter((j) => j.costVariancePct > 4).length / js.length;
    const estGp = js.reduce((s, j) => s + (j.originalContractCents - j.estimate.total), 0);
    const actGp = js.reduce((s, j) => s + (j.revisedContractCents - j.actual.total), 0);
    return {
      type,
      jobs: js.length,
      medianCostVariancePct: Math.round(median * 10) / 10,
      overrunSharePct: Math.round(overShare * 1000) / 10,
      estimatedGrossProfitCents: estGp,
      actualGrossProfitCents: actGp,
      consistentlyUnderbid: js.length >= 3 && (median > 3 || overShare >= 0.3),
    };
  }).sort((a, b) => b.medianCostVariancePct - a.medianCostVariancePct);
  // Hours only when time entries are tied to jobs; imported payroll usually isn't.
  const hoursActual = (await prisma.timeEntry.aggregate({ where: { companyId, projectId: { in: done.map((j) => j.id) } }, _sum: { regularHours: true, overtimeHours: true } }))._sum;
  const actualHours = (hoursActual.regularHours ?? 0) + (hoursActual.overtimeHours ?? 0);
  const estimatedHours = done.reduce((s, j) => s + j.estimate.hours, 0);
  return {
    jobs: done.length,
    hours: actualHours > 0 && estimatedHours > 0 ? { estimated: Math.round(estimatedHours), actual: Math.round(actualHours), variancePct: pct(actualHours - estimatedHours, estimatedHours) } : null,
    lines,
    estimatedGrossProfitCents: done.reduce((s, j) => s + (j.originalContractCents - j.estimate.total), 0),
    actualGrossProfitCents: done.reduce((s, j) => s + (j.revisedContractCents - j.actual.total), 0),
    types,
  };
}
