import { prisma } from "@plumb/db";
import { incomeTotals } from "@plumb/engine";
import type { AnnualStatement, MonthPoint } from "./types.js";
import type { Ledger } from "./ledger.js";

const pct = (v: number, base: number) => (base === 0 ? 0 : Math.round((v / base) * 10000) / 100);

export function annualStatement(ledger: Ledger, year: number): AnnualStatement {
  const periods = ledger.periods.filter((p) => p.startsWith(String(year)));
  const t = incomeTotals(ledger.accounts, periods);
  const revenueByLine: Record<string, number> = {};
  const cogsBySubtype: Record<string, number> = {};
  for (const a of ledger.accounts) {
    if (a.statement !== "INCOME") continue;
    const v = periods.reduce((s, p) => s + (a.amounts.get(p) ?? 0), 0);
    if (a.type === "REVENUE") revenueByLine[a.serviceLine ?? a.name] = (revenueByLine[a.serviceLine ?? a.name] ?? 0) + v;
    if (a.type === "COGS") cogsBySubtype[a.subtype ?? "OTHER"] = (cogsBySubtype[a.subtype ?? "OTHER"] ?? 0) + v;
  }
  return {
    year,
    revenue: t.revenue,
    cogs: t.cogs,
    grossProfit: t.grossProfit,
    grossMarginPct: pct(t.grossProfit, t.revenue),
    opex: t.opex,
    ebitda: t.ebitda,
    ebitdaMarginPct: pct(t.ebitda, t.revenue),
    netIncome: t.netIncome,
    cogsPctOfRevenue: pct(t.cogs, t.revenue),
    revenueByLine,
    cogsBySubtype,
  };
}

export function monthPoint(ledger: Ledger, period: string): MonthPoint {
  const t = incomeTotals(ledger.accounts, [period]);
  return {
    period,
    netIncome: t.netIncome,
    operatingCashFlow: ledger.get("CASH_FLOW", "operating_cash_flow", period) ??
      ledger.accounts.filter((a) => a.type === "CF_OPERATING").reduce((s, a) => s + (a.amounts.get(period) ?? 0), 0),
    cash: ledger.get("BALANCE", "cash", period) ?? 0,
  };
}

export function cashLow(ledger: Ledger, year?: number): { period: string; cents: number } {
  let best = { period: "", cents: Number.POSITIVE_INFINITY };
  for (const p of ledger.periods) {
    if (year && !p.startsWith(String(year))) continue;
    const c = ledger.get("BALANCE", "cash", p);
    if (c !== undefined && c < best.cents) best = { period: p, cents: c };
  }
  return best.period ? best : { period: "", cents: 0 };
}

/** Cash at the very start of the books: the first month's beginning balance. */
export function firstCash(ledger: Ledger): number {
  const first = ledger.periods[0];
  return ledger.get("CASH_FLOW", "beginning_cash", first) ?? ledger.get("BALANCE", "cash", first) ?? 0;
}

export async function budgetRows(companyId: string, year?: number) {
  const rows = await prisma.budget.findMany({ where: { companyId, ...(year ? { year } : {}) }, orderBy: [{ year: "asc" }, { line: "asc" }] });
  return rows.map((r) => ({ year: r.year, line: r.line, budget: Number(r.budget), actual: r.actual === null ? null : Number(r.actual) }));
}

export async function netIncomeVariancePct(companyId: string, year: number): Promise<number> {
  const r = (await budgetRows(companyId, year)).find((x) => x.line === "NET_INCOME");
  if (!r || r.actual === null || r.budget === 0) return 0;
  return Math.round(((r.actual - r.budget) / Math.abs(r.budget)) * 1000) / 10;
}

export async function worstProfitYear(companyId: string): Promise<number> {
  const rows = (await budgetRows(companyId)).filter((x) => x.line === "NET_INCOME" && x.actual !== null && x.budget !== 0);
  let worst = { year: 0, v: Number.POSITIVE_INFINITY };
  for (const r of rows) {
    const v = (r.actual! - r.budget) / Math.abs(r.budget);
    if (v < worst.v) worst = { year: r.year, v };
  }
  return worst.year;
}
