import { prisma } from "@plumb/db";
import {
  amortizationSchedule,
  CASES,
  forecastError,
  forecastRevenue,
  incomeTotals,
  monthKeyOf,
  monthWindows,
  nextMonths,
  projectCash,
  weekWindows,
  type CashForecast,
  type DatedFlow,
  type FlowCategory,
  type ForecastInput,
  type RevenueForecast,
} from "@plumb/engine";
import { addDays } from "@plumb/shared";
import { toEngineLiability } from "../map.js";
import { companyAsOf, loadWorld } from "../snapshot.js";
import { loadLedger, type Ledger } from "./ledger.js";

/**
 * Assemble forecast inputs from a company's books as of a date.
 *
 * With a ledger (imported or synced books) the forecast is driven by the
 * revenue forecast: open invoices and bills are known flows; future revenue
 * arrives after the company's own collection lag; variable costs follow
 * revenue at the trailing non-labor cost ratio; payroll, overhead, debt
 * service, and distributions run at trailing rates. Without a ledger it falls
 * back to the scheduled-obligation model the cash page already uses.
 */

const n = (b: bigint | null | undefined) => Number(b ?? 0n);
const DAY = 86_400_000;
const monthStart = (period: string) => new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7) - 1, 1));

interface Assembled {
  input: ForecastInput;
  revenue: RevenueForecast;
  basis: { reserveSource: "setting" | "one_month_of_costs"; collectionLagDays: number; vendorLagDays: number; nonLaborCostPct: number; hasLedger: boolean };
}

/** Monthly project, recurring, and residual service revenue history up to a month. */
async function revenueHistory(companyId: string, ledger: Ledger, throughMonth: string) {
  const periods = await prisma.projectPeriod.findMany({ where: { project: { companyId } }, select: { period: true, revenueMonth: true } });
  const project = new Map<string, number>();
  for (const p of periods) if (p.period <= throughMonth) project.set(p.period, (project.get(p.period) ?? 0) + n(p.revenueMonth));

  const entries = await prisma.recurringRevenueEntry.findMany({ where: { companyId }, select: { period: true, amount: true } });
  const recurring = new Map<string, number>();
  for (const e of entries) if (e.period <= throughMonth) recurring.set(e.period, (recurring.get(e.period) ?? 0) + n(e.amount));
  // No recurring detail: fall back to ledger revenue lines that read as recurring.
  if (recurring.size === 0) {
    for (const a of ledger.accounts.filter((x) => x.type === "REVENUE" && /recurring|maintenance|agreement/i.test(x.serviceLine ?? x.name))) {
      for (const [p, v] of a.amounts) if (p <= throughMonth) recurring.set(p, (recurring.get(p) ?? 0) + v);
    }
  }
  const service = new Map<string, number>();
  for (const p of ledger.periods.filter((x) => x <= throughMonth)) {
    const total = incomeTotals(ledger.accounts, [p]).revenue;
    const residual = total - (project.get(p) ?? 0) - (recurring.get(p) ?? 0);
    // Rounding residue on a project-only business is not a service line.
    if (Math.abs(residual) > Math.max(10_000, total * 0.01)) service.set(p, residual);
  }
  return { project, recurring, service };
}

/** Signed work as of a date: each job's remaining value from its WIP history or percent complete. */
async function signedJobs(companyId: string, asOf: Date, backtest: boolean) {
  const asOfMonth = monthKeyOf(asOf);
  // A backtest only knows jobs that had started by its date; a live forecast
  // also counts signed jobs that start within the year.
  const projects = await prisma.project.findMany({
    where: { companyId, startDate: { lte: backtest ? asOf : addDays(asOf, 366) } },
    include: { changeOrders: true, periods: true, milestones: true },
  });
  const jobs = [];
  for (const p of projects) {
    const revised = n(p.contractValue) + p.changeOrders.filter((c) => c.status === "APPROVED").reduce((s, c) => s + n(c.contractDelta), 0);
    const recognized = p.periods.filter((x) => x.period <= asOfMonth).reduce((s, x) => s + n(x.revenueMonth), 0);
    const pct = p.periods.length ? Math.min(1, recognized / Math.max(1, revised)) : p.percentComplete ?? (p.status === "CLOSED" ? 1 : 0);
    const remaining = Math.round(revised * (1 - pct));
    const live = p.periods.length ? p.periods.some((x) => x.period > asOfMonth) || (p.status !== "CLOSED" && remaining > 0) : p.status !== "CLOSED";
    if (!live || remaining <= 0) continue;
    const unbilled = p.milestones.filter((m) => m.status === "PLANNED" || m.status === "READY");
    jobs.push({
      id: p.id,
      name: p.name,
      remainingCents: remaining,
      start: p.startDate,
      end: p.expectedEndDate ?? p.endDate,
      netDays: p.netDays,
      milestones: unbilled.length ? unbilled.map((m) => ({ date: m.expectedDate, cents: n(m.amount) })) : undefined,
    });
  }
  return jobs;
}

export async function assembleForecast(companyId: string, opts: { asOf?: Date; horizonDays?: number; backtest?: boolean } = {}): Promise<Assembled> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const asOf = opts.asOf ?? (await companyAsOf(companyId));
  const asOfMonth = monthKeyOf(asOf);
  const ledger = await loadLedger(companyId);
  const hasLedger = ledger.periods.some((p) => p <= asOfMonth);
  const horizonEnd = addDays(asOf, opts.horizonDays ?? 400);

  if (!hasLedger) return assembleFromSchedules(companyId, asOf, company.cashSafetyThreshold);

  const trailing = ledger.periods.filter((p) => p <= asOfMonth).slice(-3);
  const t12 = ledger.periods.filter((p) => p <= asOfMonth).slice(-12);
  const t3 = incomeTotals(ledger.accounts, trailing);
  const sumLines = (pred: (a: Ledger["accounts"][number]) => boolean, ps: string[]) =>
    ledger.accounts.filter((a) => a.statement === "INCOME" && pred(a)).reduce((s, a) => s + ps.reduce((t, p) => t + (a.amounts.get(p) ?? 0), 0), 0);
  const payrollSub = new Set(["LABOR", "PAYROLL", "OWNER_COMP"]);
  const monthlyPayroll = sumLines((a) => payrollSub.has(a.subtype ?? ""), trailing) / trailing.length;
  const nonLaborCogs = sumLines((a) => a.type === "COGS" && a.subtype !== "LABOR", t12);
  const t12Revenue = incomeTotals(ledger.accounts, t12).revenue;
  const nonLaborCostPct = t12Revenue > 0 ? nonLaborCogs / t12Revenue : 0;
  const monthlyOverhead =
    sumLines((a) => a.type === "OPEX" && !payrollSub.has(a.subtype ?? "") && a.subtype !== "DEPRECIATION" && a.subtype !== "INTEREST", trailing) / trailing.length;
  const distributions = t12.reduce((s, p) => s + Math.abs(ledger.get("CASH_FLOW", "owner_distributions", p) ?? 0), 0) / Math.max(1, t12.length);
  const capexMonthly = t12.reduce((s, p) => s + Math.abs(ledger.get("CASH_FLOW", "capex", p) ?? 0), 0) / Math.max(1, t12.length);

  // Collection lag: how long this company's paid invoices actually took.
  const paid = await prisma.invoice.findMany({
    where: { companyId, paidDate: { not: null, lte: asOf }, issueDate: { gte: addDays(asOf, -365) } },
    select: { issueDate: true, paidDate: true, amount: true },
  });
  const lagWeighted = paid.reduce((s, i) => s + ((i.paidDate!.getTime() - i.issueDate.getTime()) / DAY) * n(i.amount), 0);
  const lagDays = paid.length ? Math.max(0, Math.round(lagWeighted / paid.reduce((s, i) => s + n(i.amount), 0))) : 30;
  // Vendor lag: how long this company takes to pay bills, from bill history.
  const paidBills = await prisma.bill.findMany({
    where: { companyId, paidDate: { not: null, lte: asOf }, billDate: { gte: addDays(asOf, -365) } },
    select: { billDate: true, paidDate: true },
  });
  const vendorLagDays = paidBills.length
    ? Math.round(paidBills.reduce((s, b) => s + (b.paidDate!.getTime() - b.billDate.getTime()) / DAY, 0) / paidBills.length)
    : 30;

  const flows: DatedFlow[] = [];

  // Known items: open invoices and bills.
  const openInv = await prisma.invoice.findMany({
    where: { companyId, issueDate: { lte: asOf }, status: { not: "VOID" }, OR: [{ paidDate: null }, { paidDate: { gt: asOf } }] },
    include: { customer: true },
  });
  for (const i of openInv) {
    const late = i.customer?.avgDaysToPay != null ? Math.max(0, i.customer.avgDaysToPay - (i.customer.paymentTermsDays ?? i.termsDays)) : 0;
    const expected = new Date(Math.max(addDays(asOf, 7).getTime(), addDays(i.dueDate, late).getTime()));
    flows.push({ date: expected, cents: n(i.amount), category: "collections", label: i.customer?.name ?? "Customer" });
  }
  const openBills = await prisma.bill.findMany({
    where: { companyId, billDate: { lte: asOf }, status: { not: "VOID" }, OR: [{ paidDate: null }, { paidDate: { gt: asOf } }] },
    include: { vendor: true },
  });
  for (const b of openBills) {
    flows.push({
      date: new Date(Math.max(addDays(asOf, 3).getTime(), b.dueDate.getTime())),
      cents: n(b.amount),
      category: /subcontract/i.test(b.category ?? b.vendor?.category ?? "") ? "subcontractors" : "payables",
      label: b.vendor?.name ?? b.category ?? "Vendor",
    });
  }

  // Future revenue, collected after the lag. Earned in month m, received in m + lag;
  // the months already earned sit in open receivables above.
  const history = await revenueHistory(companyId, ledger, asOfMonth);
  const jobs = await signedJobs(companyId, asOf, !!opts.backtest);
  const opps = opts.backtest ? [] : await prisma.opportunity.findMany({ where: { companyId, status: "OPEN" } });
  const durations = (await prisma.project.findMany({ where: { companyId }, select: { startDate: true, endDate: true } })).map(
    (p) => Math.max(1, Math.round((p.endDate.getTime() - p.startDate.getTime()) / (30.44 * DAY)))
  );
  const typicalDuration = durations.length ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : 3;
  const revenue = forecastRevenue({
    asOf,
    signed: jobs,
    pipeline: opps.map((o) => ({
      id: o.id,
      name: o.description,
      valueCents: n(o.estimatedValue),
      probabilityPct: o.probabilityPct,
      expectedStart: o.expectedStart,
      durationMonths: typicalDuration,
    })),
    recurringHistory: history.recurring,
    serviceHistory: history.service,
    projectHistory: history.project,
    months: 14,
  });

  // Revenue is earned through each month and received `lagDays` later; costs
  // are incurred alongside it and paid `vendorLagDays` later. Work earned
  // before the as-of date is already in open receivables and payables above.
  for (const m of revenue.months) {
    const parts: [FlowCategory, number, string][] = [
      ["progress_billings", m.signedCents, "Signed work"],
      ["progress_billings", m.unsignedCents, "Expected new work"],
      ["recurring_receipts", m.recurringCents, "Recurring revenue"],
      ["service_revenue", m.serviceCents, "Service revenue"],
    ];
    for (const [category, cents, label] of parts) {
      if (cents <= 0) continue;
      // Earned in four weekly slices, each received after the collection lag.
      for (let w = 0; w < 4; w++) {
        flows.push({ date: addDays(monthStart(m.month), 3 + w * 7 + lagDays), cents: Math.round(cents / 4), category, label });
      }
    }
    const variable = Math.round((m.signedCents + m.unsignedCents + m.recurringCents + m.serviceCents) * nonLaborCostPct);
    if (variable > 0) {
      for (let w = 0; w < 4; w++) {
        flows.push({ date: addDays(monthStart(m.month), 3 + w * 7 + vendorLagDays), cents: Math.round(variable / 4), category: "materials", label: "Materials & subs" });
      }
    }
  }

  // Debt service from the liability register.
  for (const l of (await prisma.liability.findMany({ where: { companyId, active: true } })).map(toEngineLiability)) {
    for (const pmt of amortizationSchedule(l, asOf, horizonEnd)) {
      flows.push({ date: pmt.date, cents: pmt.amountCents, category: "debt_payments", label: l.name });
    }
  }

  const reserveFromSetting = n(company.cashSafetyThreshold);
  const reserve = reserveFromSetting > 0 ? reserveFromSetting : Math.round(monthlyPayroll + monthlyOverhead);
  const locLimit = (await prisma.liability.findMany({ where: { companyId, kind: "LINE_OF_CREDIT" } })).reduce((s, l) => s + n(l.creditLimit), 0);

  return {
    input: {
      asOf,
      openingCashCents: ledger.get("BALANCE", "cash", trailing.at(-1)!) ?? 0,
      reserveTargetCents: reserve,
      locLimitCents: locLimit,
      locBalanceCents: ledger.get("BALANCE", "line_of_credit", trailing.at(-1)!) ?? 0,
      flows,
      streams: [
        { category: "payroll", label: "Payroll", monthlyCents: Math.round(monthlyPayroll), cadence: "biweekly", anchorDay: 4 },
        { category: "operating_expenses", label: "Overhead", monthlyCents: Math.round(monthlyOverhead), cadence: "monthly", anchorDay: 1 },
        ...(distributions > 0 ? [{ category: "distributions" as const, label: "Owner distributions", monthlyCents: Math.round(distributions), cadence: "monthly" as const, anchorDay: 15 }] : []),
        ...(capexMonthly > 0 ? [{ category: "capex" as const, label: "Equipment purchases", monthlyCents: Math.round(capexMonthly), cadence: "monthly" as const, anchorDay: 10 }] : []),
      ],
    },
    revenue,
    basis: {
      reserveSource: reserveFromSetting > 0 ? "setting" : "one_month_of_costs",
      collectionLagDays: lagDays,
      vendorLagDays,
      nonLaborCostPct: Math.round(nonLaborCostPct * 1000) / 10,
      hasLedger: true,
    },
  };
}

/** No ledger: use the scheduled world (cash events, obligations, milestones, services). */
async function assembleFromSchedules(companyId: string, asOf: Date, threshold: bigint): Promise<Assembled> {
  const { world, projected } = await loadWorld(companyId, { asOf, horizonDays: 400 });
  const map: Record<string, FlowCategory> = {
    PROGRESS_BILLING: "progress_billings",
    RETAINAGE_RELEASE: "progress_billings",
    PAYROLL: "payroll",
    VENDOR_BILL: "payables",
    OVERHEAD: "operating_expenses",
    TAX: "taxes",
    LOAN: "debt_payments",
    INSURANCE: "insurance",
  };
  const flows: DatedFlow[] = [...world.ledger, ...projected]
    .filter((e) => !e.actualDate && (e.status === "EXPECTED" || e.status === "LATE"))
    .map((e) => ({
      date: e.expectedDate < asOf ? addDays(asOf, 3) : e.expectedDate,
      cents: e.amountCents,
      category: e.direction === "IN" ? (e.category === "PROGRESS_BILLING" ? "collections" : "other_inflow") : map[e.category] ?? "other_outflow",
      label: "label" in e ? String((e as { label: string }).label) : e.category.toLowerCase().replace(/_/g, " "),
    }));
  const months = nextMonths(asOf, 14);
  return {
    input: {
      asOf,
      openingCashCents: world.openingCashCents,
      reserveTargetCents: n(threshold),
      locLimitCents: 0,
      locBalanceCents: 0,
      flows,
      streams: [],
    },
    revenue: {
      months: months.map((m) => {
        const inMonth = flows.filter((f) => monthKeyOf(f.date) === m && ["collections", "progress_billings", "recurring_receipts"].includes(f.category));
        const total = inMonth.reduce((s, f) => s + f.cents, 0);
        return { month: m, signedCents: total, unsignedCents: 0, pipelineCents: 0, recurringCents: 0, serviceCents: 0, totalCents: total };
      }),
      totals: { signed: 0, unsigned: 0, pipeline: 0, recurring: 0, service: 0, likely: 0, total: 0 },
      growth: { recurringYoYPct: null, serviceYoYPct: null },
    },
    basis: { reserveSource: "setting", collectionLagDays: 0, vendorLagDays: 0, nonLaborCostPct: 0, hasLedger: false },
  };
}

export async function thirteenWeek(companyId: string, opts: { case?: keyof typeof CASES } = {}) {
  const a = await assembleForecast(companyId);
  const forecast = projectCash(a.input, weekWindows(a.input.asOf, 13), CASES[opts.case ?? "base"]);
  await snapshotForecast(companyId, a.input.asOf, "CASH_13W", forecast);
  return { asOf: a.input.asOf, basis: a.basis, forecast };
}

export async function twelveMonth(companyId: string) {
  const a = await assembleForecast(companyId);
  const windows = monthWindows(a.input.asOf, 12);
  const cases = Object.fromEntries(
    (["base", "upside", "downside"] as const).map((k) => [k, projectCash(a.input, windows, CASES[k])])
  ) as Record<"base" | "upside" | "downside", CashForecast>;
  await snapshotForecast(companyId, a.input.asOf, "CASH_12M", cases.base);
  return { asOf: a.input.asOf, basis: a.basis, cases };
}

export async function revenueForecast(companyId: string) {
  const a = await assembleForecast(companyId);
  const months = a.revenue.months.slice(0, 12);
  const sum = (k: "signedCents" | "unsignedCents" | "pipelineCents" | "recurringCents" | "serviceCents" | "totalCents") => months.reduce((s, m) => s + m[k], 0);
  await snapshotForecast(companyId, a.input.asOf, "REVENUE_12M", months);
  return {
    asOf: a.input.asOf,
    months,
    totals: {
      signed: sum("signedCents"),
      unsigned: sum("unsignedCents"),
      likely: sum("totalCents"),
      pipeline: sum("pipelineCents"),
      recurring: sum("recurringCents"),
      service: sum("serviceCents"),
      projectedAnnual: sum("totalCents"),
      projectedMonthlyAvg: Math.round(sum("totalCents") / Math.max(1, months.length)),
    },
    growth: a.revenue.growth,
  };
}

/** Keep one snapshot per kind per as-of day, so forecasts can be graded later. */
async function snapshotForecast(companyId: string, asOf: Date, kind: string, payload: unknown) {
  const day = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const existing = await prisma.forecastSnapshot.findFirst({ where: { companyId, kind, asOf: day } });
  if (existing) return;
  await prisma.forecastSnapshot.create({ data: { companyId, kind, asOf: day, payload: JSON.parse(JSON.stringify(payload)) } });
}

/**
 * Forecast vs actual. Two sources: stored snapshots whose months have since
 * closed, and a backtest that reruns the forecast from six months before the
 * books' end using only what was known then, graded against what happened.
 */
export async function forecastAccuracy(companyId: string) {
  const ledger = await loadLedger(companyId);
  const asOf = await companyAsOf(companyId);
  const asOfMonth = monthKeyOf(asOf);
  const closed = ledger.periods.filter((p) => p <= asOfMonth);
  if (closed.length < 18) return { backtest: null, snapshots: [] };

  const backtestMonth = closed.at(-7)!;
  const backtestAsOf = new Date(Date.UTC(+backtestMonth.slice(0, 4), +backtestMonth.slice(5, 7), 0));
  const a = await assembleForecast(companyId, { asOf: backtestAsOf, backtest: true });
  const forecast = new Map(a.revenue.months.slice(0, 6).map((m) => [m.month, m.totalCents]));
  const actual = new Map(closed.slice(-6).map((p) => [p, incomeTotals(ledger.accounts, [p]).revenue]));
  const revenueErr = forecastError(forecast, actual);

  const cash = projectCash(a.input, monthWindows(backtestAsOf, 6), CASES.base);
  const cashForecast = new Map(cash.buckets.map((b) => [b.label, b.endingCents]));
  const cashActual = new Map(closed.slice(-6).map((p) => [p, ledger.get("BALANCE", "cash", p) ?? 0]));

  const next6 = closed.slice(-6);
  const errPct = (f: number, a: number) => (a ? Math.round(((f - a) / Math.abs(a)) * 1000) / 10 : null);

  // Payroll: the run rate the forecast carried against what was actually paid.
  const payrollStream = a.input.streams.find((x) => x.category === "payroll");
  const payrollForecast = (payrollStream?.monthlyCents ?? 0) * next6.length;
  const payrollSub = new Set(["LABOR", "PAYROLL", "OWNER_COMP"]);
  const payrollActual = ledger.accounts.filter((x) => x.statement === "INCOME" && payrollSub.has(x.subtype ?? "")).reduce((t, x) => t + next6.reduce((u, p) => u + (x.amounts.get(p) ?? 0), 0), 0);

  // Backlog: work signed at the backtest date against revenue those jobs actually earned in the next six months.
  const periods = await prisma.projectPeriod.findMany({ where: { project: { companyId } }, select: { projectId: true, period: true, revenueMonth: true, revenueCumulative: true, revisedContract: true, projectedGrossProfit: true } });
  const byProject = new Map<string, typeof periods>();
  for (const x of periods) byProject.set(x.projectId, [...(byProject.get(x.projectId) ?? []), x]);
  let backlogForecast = 0;
  let backlogActual = 0;
  const marginErrors: number[] = [];
  for (const rows of byProject.values()) {
    rows.sort((x, y) => x.period.localeCompare(y.period));
    const at = rows.filter((x) => x.period <= backtestMonth).at(-1);
    const after = rows.filter((x) => x.period > backtestMonth && x.period <= next6[next6.length - 1]);
    if (at && after.length && at.revisedContract) {
      backlogForecast += Math.max(0, n(at.revisedContract) - n(at.revenueCumulative));
      backlogActual += after.reduce((t, x) => t + n(x.revenueMonth), 0);
      // Job margin: the margin projected at the backtest date against where the job ended up.
      const end = rows.at(-1)!;
      if (at.projectedGrossProfit != null && end.projectedGrossProfit != null && end !== at && end.revisedContract) {
        const projected = (n(at.projectedGrossProfit) / n(at.revisedContract)) * 100;
        const final = (n(end.projectedGrossProfit) / n(end.revisedContract)) * 100;
        marginErrors.push(Math.abs(projected - final));
      }
    }
  }

  const snapshots = await prisma.forecastSnapshot.findMany({ where: { companyId }, orderBy: { asOf: "desc" }, take: 10, select: { kind: true, asOf: true, createdAt: true } });
  return {
    backtest: {
      asOf: backtestAsOf.toISOString().slice(0, 10),
      revenue: {
        ...revenueErr,
        months: [...forecast].map(([m, f]) => ({ month: m, forecastCents: f, actualCents: actual.get(m) ?? null })),
      },
      cash: {
        ...forecastError(cashForecast, cashActual),
        months: [...cashForecast].map(([m, f]) => ({ month: m, forecastCents: f, actualCents: cashActual.get(m) ?? null })),
      },
      payroll: payrollStream ? { forecastCents: payrollForecast, actualCents: payrollActual, errorPct: errPct(payrollForecast, payrollActual) } : null,
      backlog: backlogForecast ? { forecastCents: backlogForecast, actualCents: backlogActual, errorPct: errPct(backlogForecast, backlogActual) } : null,
      jobMargin: marginErrors.length ? { jobs: marginErrors.length, avgErrorPts: Math.round((marginErrors.reduce((t, x) => t + x, 0) / marginErrors.length) * 10) / 10 } : null,
    },
    snapshots,
  };
}
