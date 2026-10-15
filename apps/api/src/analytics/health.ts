import { prisma } from "@plumb/db";
import {
  currentRatioReading,
  grossMarginReading,
  incomeTotals,
  runwayReading,
  shortTermPosition,
  type Reading,
} from "@plumb/engine";
import { periodOf } from "../import/csv.js";
import { companyAsOf, loadSnapshot } from "../snapshot.js";
import type { Ledger } from "./ledger.js";
import { arAging, debtDashboard, workingCapital } from "./workingcapital.js";

/**
 * The primary DNRD dashboard: one view of where the business stands, every
 * metric paired with a reading an owner can act on, and the concerns that need
 * attention ranked by severity.
 */

export interface Metric {
  key: string;
  label: string;
  /** Cents for money, a plain number for ratios and percentages. */
  value: number | null;
  unit: "money" | "pct" | "ratio" | "months";
  reading?: Reading;
  /** Short context: the period or basis behind the number. */
  basis?: string;
}

export interface Concern {
  kind: "jobs_at_risk" | "overdue_receivables" | "margin_deterioration" | "payroll_pressure" | "capacity" | "equipment_debt";
  severity: "critical" | "warning";
  title: string;
  detail: string;
}

export interface HealthDashboard {
  asOf: string;
  hasLedger: boolean;
  position: Reading;
  groups: { key: string; label: string; metrics: Metric[] }[];
  concerns: Concern[];
}

const pctOf = (v: number, base: number) => (base === 0 ? 0 : Math.round((v / base) * 1000) / 10);
const fmt = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

export async function healthDashboard(companyId: string, ledger: Ledger): Promise<HealthDashboard> {
  const asOf = await companyAsOf(companyId);
  const asOfPeriod = periodOf(asOf);
  const periods = ledger.periods.filter((p) => p <= asOfPeriod);
  const hasLedger = periods.length > 0;
  const last = periods.at(-1);
  const year = asOfPeriod.slice(0, 4);
  const ytd = periods.filter((p) => p.startsWith(year));
  const t3 = periods.slice(-3);
  const t3PriorYear = t3.map((p) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`);

  const [wc, debt, ar, snap, opps, projects, capacity, assets] = await Promise.all([
    workingCapital(companyId, ledger),
    debtDashboard(companyId, ledger),
    arAging(companyId),
    loadSnapshot(companyId, { horizonDays: 90 }),
    prisma.opportunity.findMany({ where: { companyId, status: "OPEN" } }),
    prisma.project.findMany({ where: { companyId, status: { in: ["ACTIVE", "AWARDED"] } }, include: { changeOrders: true } }),
    prisma.crewCapacityPeriod.findMany({ where: { crew: { companyId } }, include: { crew: true }, orderBy: { period: "desc" }, take: 20 }),
    prisma.asset.findMany({ where: { companyId, disposedAt: null } }),
  ]);

  const month = last ? incomeTotals(ledger.accounts, [last]) : null;
  const ytdT = ytd.length ? incomeTotals(ledger.accounts, ytd) : null;
  const t3T = t3.length ? incomeTotals(ledger.accounts, t3) : null;
  const t3PY = t3PriorYear.every((p) => ledger.periods.includes(p)) ? incomeTotals(ledger.accounts, t3PriorYear) : null;

  // Payroll: field labor plus office payroll, taxes, and owner pay, last month.
  const payrollSubtypes = new Set(["LABOR", "PAYROLL", "OWNER_COMP"]);
  const payrollIn = (ps: string[]) =>
    ledger.accounts
      .filter((a) => a.statement === "INCOME" && payrollSubtypes.has(a.subtype ?? ""))
      .reduce((s, a) => s + ps.reduce((t, p) => t + (a.amounts.get(p) ?? 0), 0), 0);
  const payrollMonth = last ? payrollIn([last]) : null;

  const backlog = projects.reduce((s, p) => {
    const revised = Number(p.contractValue) + p.changeOrders.filter((c) => c.status === "APPROVED").reduce((t, c) => t + Number(c.contractDelta), 0);
    return s + Math.round(revised * (1 - (p.percentComplete ?? 0)));
  }, 0);
  const weighted = opps.reduce((s, o) => s + Math.round((Number(o.estimatedValue) * o.probabilityPct) / 100), 0);

  // Year-end projections: actual so far plus the trailing-three-month run rate
  // for the months left in the fiscal year.
  const monthsLeft = 12 - ytd.length;
  const projYearRevenue = ytdT && t3T ? ytdT.revenue + Math.round((t3T.revenue / t3.length) * monthsLeft) : null;
  const projYearProfit = ytdT && t3T ? ytdT.netIncome + Math.round((t3T.netIncome / t3.length) * monthsLeft) : null;

  const cash30 = snap.cash.base.series[Math.min(30, snap.cash.base.series.length - 1)]?.balanceCents ?? null;
  const cash90 = snap.cash.base.endingBalanceCents;
  const monthlyBurn = t3T ? (t3T.cogs + t3T.opex - t3T.depreciation) / t3.length : null;
  const cashMonths = monthlyBurn && monthlyBurn > 0 ? wc.cashCents / monthlyBurn : null;
  const gm = ytdT ? pctOf(ytdT.grossProfit, ytdT.revenue) : null;
  const gmPrior = t3PY ? pctOf(t3PY.grossProfit, t3PY.revenue) : null;
  const gmRecent = t3T ? pctOf(t3T.grossProfit, t3T.revenue) : null;

  const valuation = await prisma.valuationInput.findUnique({ where: { companyId } });
  const normalizedEbitda = valuation ? Math.round(Number((valuation.data as Record<string, string>).normalized_ebitda_2025 ?? 0) * 100) || null : null;

  const groups: HealthDashboard["groups"] = [
    {
      key: "liquidity",
      label: "Liquidity",
      metrics: [
        { key: "cash", label: "Cash on Hand", value: wc.cashCents, unit: "money", reading: runwayReading(cashMonths), basis: "months of costs covered" },
        { key: "available_credit", label: "Available Credit", value: debt.loc.limitCents > 0 ? debt.loc.limitCents - debt.loc.balanceCents : null, unit: "money", reading: debt.readings.loc as Reading },
        { key: "ar", label: "Receivables", value: wc.receivablesCents, unit: "money" },
        { key: "ap", label: "Payables", value: wc.payablesCents, unit: "money" },
        { key: "working_capital", label: "Working Capital", value: wc.workingCapitalCents, unit: "money" },
        { key: "current_ratio", label: "Current Ratio", value: wc.currentRatio, unit: "ratio", reading: currentRatioReading(wc.currentRatio) },
      ],
    },
    {
      key: "profit",
      label: "Profit",
      metrics: [
        { key: "monthly_revenue", label: "Revenue This Month", value: month?.revenue ?? null, unit: "money", basis: last },
        { key: "ytd_revenue", label: "Revenue YTD", value: ytdT?.revenue ?? null, unit: "money", basis: year },
        { key: "gross_profit", label: "Gross Profit YTD", value: ytdT?.grossProfit ?? null, unit: "money" },
        { key: "gross_margin", label: "Gross Margin", value: gm, unit: "pct", reading: gmRecent !== null ? grossMarginReading(gmRecent, gmPrior) : undefined, basis: "last 3 months vs a year ago" },
        { key: "operating_profit", label: "Operating Profit YTD", value: ytdT?.operatingIncome ?? null, unit: "money" },
        { key: "ebitda", label: "EBITDA YTD", value: ytdT?.ebitda ?? null, unit: "money" },
        { key: "normalized_ebitda", label: "Normalized EBITDA", value: normalizedEbitda, unit: "money", basis: "owner pay at market" },
        { key: "net_income", label: "Net Income YTD", value: ytdT?.netIncome ?? null, unit: "money" },
        { key: "payroll", label: "Payroll This Month", value: payrollMonth, unit: "money", basis: month ? `${pctOf(payrollMonth ?? 0, month.revenue)}% of revenue` : undefined },
      ],
    },
    {
      key: "debt",
      label: "Debt",
      metrics: [
        { key: "current_debt", label: "Debt Outstanding", value: debt.totalDebtCents, unit: "money", reading: debt.readings.debtToEquity as Reading },
        { key: "annual_debt_service", label: "Annual Debt Service", value: debt.annualDebtServiceCents, unit: "money", reading: debt.readings.dscr as Reading, basis: debt.dscr !== null ? `${debt.dscr}x coverage` : undefined },
      ],
    },
    {
      key: "outlook",
      label: "Outlook",
      metrics: [
        { key: "backlog", label: "Signed Backlog", value: backlog, unit: "money" },
        { key: "weighted_pipeline", label: "Weighted Pipeline", value: weighted, unit: "money" },
        { key: "cash_30", label: "Cash in 30 Days", value: cash30, unit: "money" },
        { key: "cash_90", label: "Cash in 90 Days", value: cash90, unit: "money" },
        { key: "year_end_revenue", label: "Projected Year-End Revenue", value: projYearRevenue, unit: "money" },
        { key: "year_end_profit", label: "Projected Year-End Profit", value: projYearProfit, unit: "money" },
      ],
    },
  ];

  // ---- concerns ----------------------------------------------------------
  const concerns: Concern[] = [];
  const atRisk = snap.margins.filter((m) => m.atRisk);
  if (atRisk.length) {
    concerns.push({
      kind: "jobs_at_risk",
      severity: atRisk.length > 1 ? "critical" : "warning",
      title: `${atRisk.length} job${atRisk.length === 1 ? "" : "s"} below target margin`,
      detail: atRisk.slice(0, 3).map((m) => `${m.projectName} heading for ${m.projectedFinalMarginPct.toFixed(1)}%`).join("; "),
    });
  }
  if (ar.aging.pastDue30Cents > 0) {
    const worst = [...ar.aging.byParty].sort((a, b) => b.pastDue30Cents - a.pastDue30Cents)[0];
    concerns.push({
      kind: "overdue_receivables",
      severity: ar.aging.pastDue30Cents > ar.aging.totalCents * 0.2 ? "critical" : "warning",
      title: `${fmt(ar.aging.pastDue30Cents)} more than 30 days past terms`,
      detail: `${pctOf(ar.aging.pastDue30Cents, ar.aging.totalCents)}% of receivables. Largest: ${worst.party} at ${fmt(worst.pastDue30Cents)}.`,
    });
  }
  if (gmRecent !== null && gmPrior !== null && gmRecent < gmPrior - 2) {
    concerns.push({
      kind: "margin_deterioration",
      severity: gmRecent < gmPrior - 5 ? "critical" : "warning",
      title: `Gross margin down ${(gmPrior - gmRecent).toFixed(1)} points`,
      detail: `${gmRecent}% over the last three months against ${gmPrior}% a year earlier.`,
    });
  }
  if (t3T && t3PY) {
    const payNow = pctOf(payrollIn(t3), t3T.revenue);
    const payBefore = pctOf(payrollIn(t3PriorYear), t3PY.revenue);
    if (payNow > payBefore + 3) {
      concerns.push({
        kind: "payroll_pressure",
        severity: payNow > payBefore + 6 ? "critical" : "warning",
        title: `Payroll is ${payNow}% of revenue`,
        detail: `Up from ${payBefore}% a year earlier over the same three months.`,
      });
    }
  }
  if (payrollMonth && cash30 !== null && cash30 < payrollMonth) {
    concerns.push({
      kind: "payroll_pressure",
      severity: "critical",
      title: "Cash in 30 days is below one month of payroll",
      detail: `${fmt(cash30)} projected against ${fmt(payrollMonth)} of monthly payroll.`,
    });
  }
  const latestUtil = new Map<string, number>();
  for (const c of capacity) if (c.utilizationPct !== null && !latestUtil.has(c.crewId)) latestUtil.set(c.crewId, c.utilizationPct);
  for (const [crewId, util] of latestUtil) {
    if (util >= 90) {
      const crew = capacity.find((c) => c.crewId === crewId)!.crew;
      concerns.push({
        kind: "capacity",
        severity: util >= 100 ? "critical" : "warning",
        title: `${crew.name} at ${Math.round(util)}% of capacity`,
        detail: "New work will wait on this crew.",
      });
    }
  }
  if (debt.dscr !== null && debt.dscr < 1.25) {
    concerns.push({
      kind: "equipment_debt",
      severity: debt.dscr < 1 ? "critical" : "warning",
      title: `Debt coverage at ${debt.dscr}x`,
      detail: `Trailing EBITDA covers a year of loan payments ${debt.dscr} times; lenders look for 1.25x.`,
    });
  }
  if ((debt.loc.utilizationPct ?? 0) >= 50) {
    concerns.push({
      kind: "equipment_debt",
      severity: (debt.loc.utilizationPct ?? 0) >= 90 ? "critical" : "warning",
      title: `Line of credit ${debt.loc.utilizationPct}% drawn`,
      detail: `${fmt(debt.loc.balanceCents)} of ${fmt(debt.loc.limitCents)}.`,
    });
  }
  const worn = assets.filter((a) => {
    if (!a.usefulLifeMonths) return false;
    const months = (asOf.getTime() - a.purchaseDate.getTime()) / (30.44 * 86_400_000);
    return months > a.usefulLifeMonths;
  });
  if (worn.length) {
    concerns.push({
      kind: "equipment_debt",
      severity: "warning",
      title: `${worn.length} asset${worn.length === 1 ? "" : "s"} past useful life`,
      detail: worn.slice(0, 3).map((a) => a.name).join("; "),
    });
  }
  concerns.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  return {
    asOf: asOf.toISOString().slice(0, 10),
    hasLedger,
    position: shortTermPosition(wc.currentRatio, cashMonths),
    groups,
    concerns,
  };
}

