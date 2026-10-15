import { prisma } from "@plumb/db";
import { incomeTotals, monthKeyOf } from "@plumb/engine";
import { companyAsOf } from "../snapshot.js";
import type { Ledger } from "./ledger.js";
import { loadJobs } from "./projects.js";
import type { Concentration, CrewUtilization } from "./types.js";

/**
 * Operations analytics: service lines, customers, crews, labor productivity,
 * capacity, recurring revenue, and service-call economics. Everything reads
 * the imported ledger and operating detail; nothing here writes.
 */

const n = (b: bigint | null | undefined) => Number(b ?? 0n);
const pct = (v: number, base: number) => (base === 0 ? 0 : Math.round((v / base) * 10000) / 100);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Fully direct employees: their whole cost is job cost. */
const FIELD_ALLOCATION = 1;

/** Calendar years with twelve months of ledger data on or before the as-of month. */
export function completeYears(ledger: Ledger, asOf: Date): number[] {
  const last = monthKeyOf(asOf);
  const counts = new Map<number, number>();
  for (const p of ledger.periods) if (p <= last) counts.set(Number(p.slice(0, 4)), (counts.get(Number(p.slice(0, 4))) ?? 0) + 1);
  return [...counts].filter(([, c]) => c === 12).map(([y]) => y).sort();
}

const yearPeriods = (ledger: Ledger, y: number) => ledger.periods.filter((p) => p.startsWith(String(y)));

// ---- service lines -----------------------------------------------------------

const SYNONYMS: Record<string, string[]> = {
  maintenance: ["maintenance", "recurring"],
  recurring: ["maintenance", "recurring"],
  project: ["project", "install", "construction", "remodel"],
  install: ["install", "project"],
  service: ["service"],
};

/** Revenue lines a cost account names, e.g. cogs_materials_service → the service lines. */
function linesForCost(costKey: string, lines: string[]): string[] {
  const k = costKey.toLowerCase();
  for (const [token, words] of Object.entries(SYNONYMS)) {
    if (!k.includes(token)) continue;
    const hit = lines.filter((l) => words.some((w) => l.toLowerCase().includes(w)) && !(token === "service" && /maint/i.test(l)));
    if (hit.length) return hit;
  }
  return [];
}

export interface LineYear {
  revenueCents: number;
  directCostCents: number;
  allocatedCostCents: number;
  grossProfitCents: number;
  marginPct: number;
  sharePct: number;
}

export function serviceLines(ledger: Ledger, years: number[]) {
  const revenue = ledger.accounts.filter((a) => a.statement === "INCOME" && a.type === "REVENUE");
  const cogs = ledger.accounts.filter((a) => a.statement === "INCOME" && a.type === "COGS");
  const lines = [...new Set(revenue.map((a) => a.serviceLine ?? a.name))];
  const out = new Map<string, Record<number, LineYear>>(lines.map((l) => [l, {}]));
  for (const y of years) {
    const ps = yearPeriods(ledger, y);
    const sum = (a: (typeof revenue)[number]) => ps.reduce((s, p) => s + (a.amounts.get(p) ?? 0), 0);
    const rev = new Map(lines.map((l) => [l, 0]));
    for (const a of revenue) rev.set(a.serviceLine ?? a.name, rev.get(a.serviceLine ?? a.name)! + sum(a));
    const total = [...rev.values()].reduce((s, v) => s + v, 0);
    const direct = new Map(lines.map((l) => [l, 0]));
    const allocated = new Map(lines.map((l) => [l, 0]));
    const spread = (amount: number, targets: string[], into: Map<string, number>) => {
      const base = targets.reduce((s, l) => s + rev.get(l)!, 0);
      for (const l of targets) into.set(l, into.get(l)! + (base ? (amount * rev.get(l)!) / base : amount / targets.length));
    };
    for (const a of cogs) {
      const matched = linesForCost(a.key, lines);
      if (matched.length) spread(sum(a), matched, direct);
      else spread(sum(a), lines, allocated);
    }
    for (const l of lines) {
      const cost = direct.get(l)! + allocated.get(l)!;
      out.get(l)![y] = {
        revenueCents: rev.get(l)!,
        directCostCents: Math.round(direct.get(l)!),
        allocatedCostCents: Math.round(allocated.get(l)!),
        grossProfitCents: Math.round(rev.get(l)! - cost),
        marginPct: pct(rev.get(l)! - cost, rev.get(l)!),
        sharePct: pct(rev.get(l)!, total),
      };
    }
  }
  const first = years[0];
  const last = years.at(-1)!;
  const prev = years.at(-2);
  if (!years.length) return { years, costBasis: "none" as const, lines: [] };
  // When no cost account names a line, every line carries the same blended margin.
  const anyDirect = lines.some((l) => Object.values(out.get(l)!).some((v) => v.directCostCents > 0));
  return {
    years,
    costBasis: anyDirect ? ("direct" as const) : ("allocated" as const),
    lines: lines
      .map((line) => {
        const by = out.get(line)!;
        const growth = prev !== undefined && by[prev].revenueCents ? pct(by[last].revenueCents - by[prev].revenueCents, by[prev].revenueCents) : null;
        const sinceFirst = first !== last && by[first].revenueCents ? pct(by[last].revenueCents - by[first].revenueCents, by[first].revenueCents) : null;
        return { line, byYear: by, growthPct: growth, sinceFirstPct: sinceFirst };
      })
      .sort((a, b) => b.byYear[last].revenueCents - a.byYear[last].revenueCents),
  };
}

// ---- customers ----------------------------------------------------------------

interface CustomerRow {
  key: string;
  name: string;
  segment: string | null;
  projectRevenueCents: number;
  recurringRevenueCents: number;
  revenueCents: number;
  directCostCents: number;
  grossProfitCents: number;
  marginPct: number;
  jobs: number;
  changeOrders: number;
  avgDaysToPay: number | null;
  sharePct: number;
}

/**
 * Lifetime revenue by customer: project revenue recognized to date plus
 * recurring revenue. Project cost is the job's cost in proportion to revenue
 * recognized; recurring cost uses the recurring lines' margin.
 */
export async function customerRevenue(companyId: string, ledger: Ledger): Promise<CustomerRow[]> {
  const asOf = await companyAsOf(companyId);
  const last = monthKeyOf(asOf);
  const [projects, recurring, customers, jobs] = await Promise.all([
    prisma.project.findMany({ where: { companyId }, include: { periods: { where: { period: { lte: last } } }, changeOrders: true } }),
    prisma.recurringRevenueEntry.groupBy({ by: ["customerId"], where: { companyId, period: { lte: last } }, _sum: { amount: true } }),
    prisma.customer.findMany({ where: { companyId } }),
    loadJobs(companyId),
  ]);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const custById = new Map(customers.map((c) => [c.id, c]));
  const years = completeYears(ledger, asOf);
  const sl = serviceLines(ledger, years.slice(-1));
  const recurringLines = sl.lines.filter((l) => /recurring|maint/i.test(l.line));
  const y = years.at(-1);
  const recRev = y ? recurringLines.reduce((s, l) => s + l.byYear[y].revenueCents, 0) : 0;
  const recGp = y ? recurringLines.reduce((s, l) => s + l.byYear[y].grossProfitCents, 0) : 0;
  const recurringMargin = recRev ? recGp / recRev : 0;

  // With a WIP/progress history, a job without one has recognized nothing yet
  // (signed backlog); without any history, fall back to percent complete.
  const hasHistory = projects.some((p) => p.periods.length > 0);
  const rows = new Map<string, CustomerRow>();
  const row = (key: string, name: string, segment: string | null) => {
    if (!rows.has(key))
      rows.set(key, { key, name, segment, projectRevenueCents: 0, recurringRevenueCents: 0, revenueCents: 0, directCostCents: 0, grossProfitCents: 0, marginPct: 0, jobs: 0, changeOrders: 0, avgDaysToPay: null, sharePct: 0 });
    return rows.get(key)!;
  };
  for (const p of projects) {
    const c = p.customerId ? custById.get(p.customerId) : null;
    const r = row(c?.id ?? `client:${p.client}`, c?.name ?? p.client, c?.segment ?? null);
    const j = jobById.get(p.id)!;
    const recognized = p.periods.length ? p.periods.reduce((s, x) => s + n(x.revenueMonth), 0) : hasHistory ? 0 : Math.round(j.revisedContractCents * j.percentComplete);
    if (recognized === 0) continue;
    r.projectRevenueCents += recognized;
    const costShare = j.revisedContractCents ? recognized / j.revisedContractCents : 0;
    r.directCostCents += Math.round(j.projectedTotalCostCents * costShare);
    r.jobs++;
    r.changeOrders += p.changeOrders.length;
  }
  for (const g of recurring) {
    const c = g.customerId ? custById.get(g.customerId) : null;
    const r = row(c?.id ?? "recurring:unassigned", c?.name ?? "Unassigned", c?.segment ?? null);
    const amt = n(g._sum.amount);
    r.recurringRevenueCents += amt;
    r.directCostCents += Math.round(amt * (1 - recurringMargin));
  }
  const all = [...rows.values()];
  const total = all.reduce((s, r) => s + r.projectRevenueCents + r.recurringRevenueCents, 0);
  for (const r of all) {
    r.revenueCents = r.projectRevenueCents + r.recurringRevenueCents;
    r.grossProfitCents = r.revenueCents - r.directCostCents;
    r.marginPct = pct(r.grossProfitCents, r.revenueCents);
    r.sharePct = pct(r.revenueCents, total);
    const c = custById.get(r.key);
    r.avgDaysToPay = c?.avgDaysToPay ?? null;
  }
  return all.filter((r) => r.revenueCents > 0).sort((a, b) => b.revenueCents - a.revenueCents);
}

export async function concentration(companyId: string, ledger: Ledger): Promise<Concentration> {
  const rows = await customerRevenue(companyId, ledger);
  const total = rows.reduce((s, r) => s + r.revenueCents, 0);
  const top = rows[0];
  return {
    basis: "Recognized project revenue plus recurring revenue, lifetime to date",
    totalCents: total,
    top: top ? { name: top.name, cents: top.revenueCents, pct: pct(top.revenueCents, total) } : null,
    top5Pct: pct(rows.slice(0, 5).reduce((s, r) => s + r.revenueCents, 0), total),
    maxPct: top ? pct(top.revenueCents, total) : 0,
  };
}

/** Customer table with flags for big accounts that earn little. */
export async function customers(companyId: string, ledger: Ledger) {
  const rows = await customerRevenue(companyId, ledger);
  const total = rows.reduce((s, r) => s + r.revenueCents, 0);
  const gp = rows.reduce((s, r) => s + r.grossProfitCents, 0);
  const companyMargin = pct(gp, total);
  const bigCut = rows[Math.max(0, Math.ceil(rows.length * 0.2) - 1)]?.revenueCents ?? 0;
  return {
    totalCents: total,
    marginPct: companyMargin,
    concentration: await concentration(companyId, ledger),
    rows: rows.map((r) => ({
      ...r,
      flags: [
        ...(r.revenueCents >= bigCut && r.marginPct < companyMargin - 5 ? ["high revenue, low margin"] : []),
        ...(r.avgDaysToPay !== null && r.avgDaysToPay > 45 ? [`pays in ${Math.round(r.avgDaysToPay)} days`] : []),
        ...(r.sharePct >= 25 ? ["concentration risk"] : []),
      ],
    })),
  };
}

// ---- recurring revenue ----------------------------------------------------------

export async function recurringSeries(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const last = monthKeyOf(asOf);
  const entries = await prisma.recurringRevenueEntry.findMany({ where: { companyId, period: { lte: last } }, select: { period: true, amount: true, customerId: true, segment: true } });
  const byMonth = new Map<string, number>();
  const bySegment = new Map<string, Map<string, number>>();
  const customersByMonth = new Map<string, Set<string>>();
  if (entries.length) {
    for (const e of entries) {
      byMonth.set(e.period, (byMonth.get(e.period) ?? 0) + n(e.amount));
      const seg = e.segment ?? "Recurring";
      if (!bySegment.has(seg)) bySegment.set(seg, new Map());
      bySegment.get(seg)!.set(e.period, (bySegment.get(seg)!.get(e.period) ?? 0) + n(e.amount));
      if (e.customerId && n(e.amount) > 0) {
        if (!customersByMonth.has(e.period)) customersByMonth.set(e.period, new Set());
        customersByMonth.get(e.period)!.add(e.customerId);
      }
    }
  } else {
    // No contract detail: fall back to recurring revenue lines on the P&L.
    for (const a of ledger.accounts.filter((a) => a.type === "REVENUE" && /recurring|maint/i.test(a.serviceLine ?? a.name))) {
      const seg = a.serviceLine ?? a.name;
      bySegment.set(seg, new Map());
      for (const [p, v] of a.amounts) {
        if (p > last) continue;
        byMonth.set(p, (byMonth.get(p) ?? 0) + v);
        bySegment.get(seg)!.set(p, v);
      }
    }
  }
  return { months: [...byMonth.keys()].sort(), byMonth, bySegment, customersByMonth };
}

export async function recurringAnnual(companyId: string, ledger: Ledger, year: number) {
  const s = await recurringSeries(companyId, ledger);
  const cents = s.months.filter((m) => m.startsWith(String(year))).reduce((t, m) => t + s.byMonth.get(m)!, 0);
  const revenue = incomeTotals(ledger.accounts, yearPeriods(ledger, year)).revenue;
  return { cents, sharePct: pct(cents, revenue) };
}

/** Average of each full year's (peak − trough) / peak, in percent. */
export async function seasonalSwingPct(companyId: string, ledger: Ledger) {
  const s = await recurringSeries(companyId, ledger);
  const years = [...new Set(s.months.map((m) => m.slice(0, 4)))];
  const swings = years
    .map((y) => s.months.filter((m) => m.startsWith(y)).map((m) => s.byMonth.get(m)!))
    .filter((v) => v.length === 12 && Math.max(...v) > 0)
    .map((v) => ((Math.max(...v) - Math.min(...v)) / Math.max(...v)) * 100);
  return r1(avg(swings));
}

export async function recurringDashboard(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const s = await recurringSeries(companyId, ledger);
  if (s.months.length === 0) return null;
  const lastMonth = s.months.at(-1)!;
  const mrr = s.byMonth.get(lastMonth)!;
  const yearAgo = s.months[s.months.length - 13];
  const active = s.customersByMonth.get(lastMonth);
  const before = yearAgo ? s.customersByMonth.get(yearAgo) : undefined;
  const churned = before && active ? [...before].filter((c) => !active.has(c)).length : null;
  const years = completeYears(ledger, asOf);
  const sl = serviceLines(ledger, years.slice(-1));
  const rec = sl.lines.filter((l) => /recurring|maint/i.test(l.line));
  const y = years.at(-1);
  const recRev = y ? rec.reduce((t, l) => t + l.byYear[y].revenueCents, 0) : 0;
  const recDirect = y ? rec.reduce((t, l) => t + l.byYear[y].directCostCents, 0) : 0;
  const annual = years.map((yr) => ({ year: yr, cents: s.months.filter((m) => m.startsWith(String(yr))).reduce((t, m) => t + s.byMonth.get(m)!, 0), revenue: incomeTotals(ledger.accounts, yearPeriods(ledger, yr)).revenue }));
  return {
    asOf: lastMonth,
    mrrCents: mrr,
    arrCents: mrr * 12,
    trailing12Cents: s.months.slice(-12).reduce((t, m) => t + s.byMonth.get(m)!, 0),
    activeContracts: active?.size ?? null,
    avgMonthlyContractCents: active?.size ? Math.round(mrr / active.size) : null,
    churnPct: churned !== null && before?.size ? pct(churned, before.size) : null,
    renewalPct: churned !== null && before?.size ? pct(before.size - churned, before.size) : null,
    seasonalSwingPct: await seasonalSwingPct(companyId, ledger),
    // Only when the P&L separates maintenance costs from project costs.
    grossMarginPct: recDirect > 0 ? pct(recRev - recDirect - rec.reduce((t, l) => t + (y ? l.byYear[y].allocatedCostCents : 0), 0), recRev) : null,
    annual: annual.map((a) => ({ year: a.year, cents: a.cents, sharePct: pct(a.cents, a.revenue) })),
    monthly: s.months.slice(-24).map((m) => ({
      period: m,
      totalCents: s.byMonth.get(m)!,
      bySegment: Object.fromEntries([...s.bySegment].map(([seg, mm]) => [seg, mm.get(m) ?? 0])),
    })),
  };
}

// ---- crews and labor -------------------------------------------------------------

export async function crewUtilization(companyId: string): Promise<CrewUtilization> {
  const asOf = await companyAsOf(companyId);
  const last = monthKeyOf(asOf);
  const crews = await prisma.crew.findMany({ where: { companyId }, include: { capacity: { where: { period: { lte: last }, utilizationPct: { not: null } }, orderBy: { period: "asc" } } } });
  const series = (kind: string) => crews.filter((c) => c.kind === kind && c.capacity.length).sort((a, b) => b.capacity.length - a.capacity.length)[0]?.capacity ?? [];
  const proj = series("PROJECT");
  const maint = series("MAINTENANCE");
  let project: CrewUtilization["project"] = null;
  if (proj.length) {
    const byYear = new Map<number, number[]>();
    for (const c of proj) byYear.set(Number(c.period.slice(0, 4)), [...(byYear.get(Number(c.period.slice(0, 4))) ?? []), c.utilizationPct!]);
    const [peakYear, peakVals] = [...byYear].filter(([, v]) => v.length === 12).sort((a, b) => avg(b[1]) - avg(a[1]))[0] ?? [...byYear][0];
    project = {
      avgPct: r1(avg(proj.map((c) => c.utilizationPct!))),
      peakYear,
      peakYearAvgPct: r1(avg(peakVals)),
      trailing24AvgPct: r1(avg(proj.slice(-24).map((c) => c.utilizationPct!))),
    };
  }
  return { project, maintenance: maint.length ? { trailing12AvgPct: r1(avg(maint.slice(-12).map((c) => c.utilizationPct!))) } : null };
}

/** Employees counted as field staff in a year: fully direct, and paid that year. */
async function fieldStaff(companyId: string, year: number) {
  const employees = await prisma.employee.findMany({ where: { companyId }, include: { timeEntries: { where: { period: { startsWith: String(year) } } } } });
  const hasPayroll = employees.some((e) => e.timeEntries.length);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  return employees.filter(
    (e) =>
      e.cogsAllocationPct >= FIELD_ALLOCATION &&
      (hasPayroll ? e.timeEntries.length > 0 : (!e.hireDate || e.hireDate <= end) && (!e.terminationDate || e.terminationDate >= start))
  );
}

export async function revenuePerFieldEmployee(companyId: string, ledger: Ledger, year: number) {
  const field = await fieldStaff(companyId, year);
  const revenue = incomeTotals(ledger.accounts, yearPeriods(ledger, year)).revenue;
  return { cents: field.length ? Math.round(revenue / field.length) : 0, fieldCount: field.length };
}

export async function labor(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const entries = await prisma.timeEntry.findMany({ where: { companyId }, include: { employee: true } });
  const perYear = [];
  for (const y of years) {
    const t = incomeTotals(ledger.accounts, yearPeriods(ledger, y));
    const field = await fieldStaff(companyId, y);
    const ids = new Set(field.map((e) => e.id));
    const ye = entries.filter((e) => e.period.startsWith(String(y)) && ids.has(e.employeeId));
    const hours = ye.reduce((s, e) => s + e.regularHours + e.overtimeHours, 0);
    const ot = ye.reduce((s, e) => s + e.overtimeHours, 0);
    const pay = ye.reduce((s, e) => s + n(e.grossPay), 0);
    perYear.push({
      year: y,
      fieldCount: field.length,
      revenueCents: t.revenue,
      revenuePerFieldCents: field.length ? Math.round(t.revenue / field.length) : null,
      grossProfitPerFieldCents: field.length ? Math.round(t.grossProfit / field.length) : null,
      fieldPayrollCents: pay,
      payrollPctOfRevenue: pay ? pct(pay, t.revenue) : null,
      hours: hours || null,
      revenuePerHourCents: hours ? Math.round(t.revenue / hours) : null,
      grossProfitPerHourCents: hours ? Math.round(t.grossProfit / hours) : null,
      overtimePct: hours ? pct(ot, hours) : null,
    });
  }
  // Job types whose labor runs over estimate.
  const jobs = (await loadJobs(companyId)).filter((j) => j.estimate.LABOR > 0 && j.actual.LABOR > 0);
  const byType = new Map<string, { est: number; act: number; jobs: number; over: number }>();
  for (const j of jobs) {
    const g = byType.get(j.type ?? "Other") ?? { est: 0, act: 0, jobs: 0, over: 0 };
    g.est += j.estimate.LABOR;
    g.act += j.actual.LABOR;
    g.jobs++;
    if (j.actual.LABOR > j.estimate.LABOR * 1.05) g.over++;
    byType.set(j.type ?? "Other", g);
  }
  return {
    years: perYear,
    laborOverrunsByType: [...byType]
      .map(([type, g]) => ({ type, jobs: g.jobs, laborVariancePct: pct(g.act - g.est, g.est), overrunSharePct: pct(g.over, g.jobs) }))
      .sort((a, b) => b.laborVariancePct - a.laborVariancePct),
  };
}

/**
 * Revenue a crew produces, when the books tie it to one: a crew named for a
 * service line earns that line's revenue; a company's only field crew earns
 * all of it.
 */
function crewRevenue(name: string, kind: string, fieldCrews: number, ledger: Ledger | null, periods: string[]) {
  if (!ledger || !periods.length) return null;
  const lines = ledger.accounts.filter((a) => a.statement === "INCOME" && a.type === "REVENUE");
  const sum = (as: typeof lines) => as.reduce((t, a) => t + periods.reduce((x, p) => x + (a.amounts.get(p) ?? 0), 0), 0);
  const match = lines.filter((a) => (a.serviceLine ?? a.name).toLowerCase() === name.toLowerCase());
  if (match.length) return sum(match);
  if (kind !== "SUPPORT" && fieldCrews === 1) return sum(lines);
  return null;
}

/** Payroll of crews that carry a service line's name, over the given months. */
export async function lineLabor(companyId: string, periods: string[]) {
  const crewsWithPay = await prisma.crew.findMany({ where: { companyId }, include: { employees: { include: { timeEntries: { where: { period: { in: periods } } } } } } });
  return new Map(crewsWithPay.map((c) => [c.name.toLowerCase(), c.employees.reduce((t, e) => t + e.timeEntries.reduce((x, te) => x + n(te.grossPay), 0), 0)]));
}

export async function crews(companyId: string, ledger: Ledger | null = null) {
  const asOf = await companyAsOf(companyId);
  const last = monthKeyOf(asOf);
  const from = `${Number(last.slice(0, 4)) - 1}-${last.slice(5)}`;
  const rows = await prisma.crew.findMany({
    where: { companyId },
    include: {
      employees: { include: { timeEntries: { where: { period: { gt: from, lte: last } } } } },
      capacity: { where: { period: { gt: from, lte: last } } },
    },
  });
  const field = rows.filter((c) => c.kind !== "SUPPORT" && c.employees.length > 0);
  const trailing = ledger ? ledger.periods.filter((p) => p > from && p <= last) : [];
  return field
    .map((c) => {
      const revenue = crewRevenue(c.name, c.kind, field.length, ledger, trailing);
      const te = c.employees.flatMap((e) => e.timeEntries);
      const hours = te.reduce((s, e) => s + e.regularHours + e.overtimeHours, 0);
      const ot = te.reduce((s, e) => s + e.overtimeHours, 0);
      const util = c.capacity.filter((x) => x.utilizationPct !== null).map((x) => x.utilizationPct!);
      return {
        name: c.name,
        kind: c.kind,
        headcount: c.employees.filter((e) => e.timeEntries.length).length || c.employees.length,
        payrollCents: te.reduce((s, e) => s + n(e.grossPay), 0),
        hours: hours || null,
        overtimePct: hours ? pct(ot, hours) : null,
        utilizationPct: util.length ? r1(avg(util)) : null,
        revenueCents: revenue,
        laborPctOfRevenue: revenue ? pct(te.reduce((s, e) => s + n(e.grossPay), 0), revenue) : null,
      };
    })
    .sort((a, b) => b.payrollCents - a.payrollCents);
}

// ---- capacity -------------------------------------------------------------------

/**
 * Revenue ceiling: the best year's revenue per field employee times today's
 * field headcount. Headroom is the ceiling less last year's revenue.
 */
export async function capacityHeadroom(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const per = await Promise.all(years.map(async (y) => ({ y, ...(await revenuePerFieldEmployee(companyId, ledger, y)) })));
  const best = per.filter((p) => p.fieldCount > 0).sort((a, b) => b.cents - a.cents)[0];
  const latest = per.at(-1);
  if (!best || !latest) return { ceilingCents: 0, headroomCents: 0, headroomPct: 0, bestYear: null, fieldCount: 0, lastYearRevenueCents: 0 };
  const ceiling = best.cents * latest.fieldCount;
  const lastRevenue = latest.cents * latest.fieldCount;
  const revenue = incomeTotals(ledger.accounts, yearPeriods(ledger, latest.y)).revenue;
  return {
    ceilingCents: ceiling,
    headroomCents: ceiling - revenue,
    headroomPct: pct(ceiling - revenue, revenue || lastRevenue),
    bestYear: best.y,
    bestRevenuePerFieldCents: best.cents,
    fieldCount: latest.fieldCount,
    lastYearRevenueCents: revenue,
  };
}

/**
 * Next six months of booked revenue against the monthly ceiling: signed
 * backlog spread to each job's finish, recurring at the current run rate, and
 * weighted pipeline from its expected start.
 */
export async function capacityPlan(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const head = await capacityHeadroom(companyId, ledger);
  const monthlyCeiling = head.ceilingCents / 12;
  const months = Array.from({ length: 6 }, (_, i) => monthKeyOf(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1 + i, 1))));
  const booked = new Map(months.map((m) => [m, 0]));
  const pending = new Map(months.map((m) => [m, 0]));
  const jobs = (await loadJobs(companyId)).filter((j) => j.status !== "CLOSED" && j.percentComplete < 1);
  for (const j of jobs) {
    const remaining = j.revisedContractCents * (1 - j.percentComplete);
    const span = months.filter((m) => m <= monthKeyOf(j.end));
    const target = span.length ? span : months.slice(0, 1);
    for (const m of target) booked.set(m, booked.get(m)! + remaining / target.length);
  }
  const rec = await recurringSeries(companyId, ledger);
  const recLast12 = rec.months.slice(-12);
  for (const m of months) {
    // Same calendar month last year, so seasonal service is in its right place.
    const lastYear = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
    booked.set(m, booked.get(m)! + (rec.byMonth.get(lastYear) ?? (recLast12.length ? avg(recLast12.map((x) => rec.byMonth.get(x)!)) : 0)));
  }
  const opps = await prisma.opportunity.findMany({ where: { companyId, status: "OPEN" } });
  for (const o of opps) {
    const start = o.expectedStart ? monthKeyOf(o.expectedStart) : months[0];
    const span = months.filter((m) => m >= start).slice(0, 3);
    for (const m of span) pending.set(m, pending.get(m)! + (n(o.estimatedValue) * o.probabilityPct) / 100 / span.length);
  }
  // Hours: field staff at a standard 173-hour month, committed in proportion to booked revenue.
  const availableHours = head.fieldCount * 173;
  return {
    monthlyCeilingCents: Math.round(monthlyCeiling),
    availableHours,
    headroom: head,
    months: months.map((m) => ({
      period: m,
      bookedCents: Math.round(booked.get(m)!),
      pipelineCents: Math.round(pending.get(m)!),
      bookedPct: monthlyCeiling ? r1((booked.get(m)! / monthlyCeiling) * 100) : null,
      withPipelinePct: monthlyCeiling ? r1(((booked.get(m)! + pending.get(m)!) / monthlyCeiling) * 100) : null,
      committedHours: monthlyCeiling ? Math.round((booked.get(m)! / monthlyCeiling) * availableHours) : null,
    })),
  };
}

// ---- service calls ----------------------------------------------------------------

export async function serviceCalls(companyId: string) {
  const asOf = await companyAsOf(companyId);
  const rows = await prisma.serviceCallPeriod.findMany({ where: { companyId, period: { lte: monthKeyOf(asOf) } } });
  if (rows.length === 0) return null;
  const years = [...new Set(rows.map((r) => Number(r.period.slice(0, 4))))].sort();
  const techs = await prisma.employee.count({ where: { companyId, crew: { kind: "SERVICE" } } });
  const yearly = years.map((y) => {
    const yr = rows.filter((r) => r.period.startsWith(String(y)));
    const calls = yr.reduce((s, r) => s + r.ticketCount, 0);
    const revenue = yr.reduce((s, r) => s + n(r.revenue), 0);
    return { year: y, calls, revenueCents: revenue, avgTicketCents: calls ? Math.round(revenue / calls) : 0 };
  });
  const lastYear = years.at(-1)!;
  const cats = new Map<string, { segment: string; calls: number; revenue: number; prevCalls: number; prevRevenue: number }>();
  for (const r of rows) {
    const y = Number(r.period.slice(0, 4));
    if (y < lastYear - 1) continue;
    const key = `${r.segment}|${r.category}`;
    const g = cats.get(key) ?? { segment: r.segment, calls: 0, revenue: 0, prevCalls: 0, prevRevenue: 0 };
    if (y === lastYear) {
      g.calls += r.ticketCount;
      g.revenue += n(r.revenue);
    } else {
      g.prevCalls += r.ticketCount;
      g.prevRevenue += n(r.revenue);
    }
    cats.set(key, g);
  }
  const latest = yearly.at(-1)!;
  return {
    year: lastYear,
    techs: techs || null,
    revenuePerTechCents: techs ? Math.round(latest.revenueCents / techs) : null,
    callsPerTechPerWeek: techs ? r1(latest.calls / techs / 52) : null,
    yearly,
    categories: [...cats]
      .map(([key, g]) => ({
        category: key.split("|")[1],
        segment: g.segment,
        calls: g.calls,
        revenueCents: g.revenue,
        avgTicketCents: g.calls ? Math.round(g.revenue / g.calls) : 0,
        callsChangePct: g.prevCalls ? pct(g.calls - g.prevCalls, g.prevCalls) : null,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
  };
}
