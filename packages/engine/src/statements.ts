import type { Cents } from "@plumb/shared";

/**
 * Financial statements from ledger accounts.
 *
 * Input is the ledger as stored: accounts with a statement, a type, and a
 * monthly amount series. Output is a statement with one column per reporting
 * period (month, quarter, year, YTD, trailing 12) and optional comparison
 * columns. Subtotals are recomputed from the typed lines, never copied from
 * the source, so a statement only balances if the classification is right.
 */

export type StatementKind = "INCOME" | "BALANCE" | "CASH_FLOW";

export interface LedgerAccount {
  key: string;
  name: string;
  statement: StatementKind;
  type: string;
  subtype: string | null;
  serviceLine: string | null;
  sortOrder: number;
  /** period (YYYY-MM) -> cents */
  amounts: Map<string, Cents>;
}

export type View = "monthly" | "quarterly" | "annual" | "ytd" | "t12";

export interface Column {
  label: string;
  /** The months this column covers. Balance-sheet columns use the last one. */
  periods: string[];
}

export interface StatementLine {
  key: string;
  label: string;
  /** "line" for an account, "subtotal" for a computed total, "header" for a section label. */
  kind: "line" | "subtotal" | "header";
  section: string;
  values: Cents[];
  /** Percent of revenue for income-statement rows; omitted elsewhere. */
  pctOfRevenue?: number[];
}

export interface Statement {
  kind: StatementKind;
  columns: Column[];
  lines: StatementLine[];
}

/** Every month the ledger covers, ascending. */
export function ledgerPeriods(accounts: LedgerAccount[]): string[] {
  return [...new Set(accounts.flatMap((a) => [...a.amounts.keys()]))].sort();
}

function shift(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Reporting columns ending at `through`, newest last. */
export function columnsFor(view: View, periods: string[], through: string, count = 12): Column[] {
  const avail = periods.filter((p) => p <= through);
  if (avail.length === 0) return [];
  const last = avail[avail.length - 1];
  switch (view) {
    case "monthly":
      return avail.slice(-count).map((p) => ({ label: p, periods: [p] }));
    case "quarterly": {
      const byQ = new Map<string, string[]>();
      for (const p of avail) {
        const [y, m] = p.split("-").map(Number);
        const q = `${y} Q${Math.ceil(m / 3)}`;
        byQ.set(q, [...(byQ.get(q) ?? []), p]);
      }
      return [...byQ].slice(-Math.min(count, 8)).map(([label, ps]) => ({ label, periods: ps }));
    }
    case "annual": {
      const byY = new Map<string, string[]>();
      for (const p of avail) byY.set(p.slice(0, 4), [...(byY.get(p.slice(0, 4)) ?? []), p]);
      return [...byY].slice(-Math.min(count, 5)).map(([label, ps]) => ({ label, periods: ps }));
    }
    case "ytd": {
      const y = last.slice(0, 4);
      return [{ label: `${y} YTD`, periods: avail.filter((p) => p.startsWith(y)) }];
    }
    case "t12":
      return [{ label: `T12 to ${last}`, periods: avail.slice(-12) }];
  }
}

/** The same column, a year earlier — the prior-year comparison. */
export function priorYear(c: Column): Column {
  return { label: `${c.label} (PY)`, periods: c.periods.map((p) => shift(p, -12)) };
}

/** The same-length window immediately before — the prior-period comparison. */
export function priorPeriod(c: Column): Column {
  const n = c.periods.length;
  return { label: `${c.label} (PP)`, periods: c.periods.map((p) => shift(p, -n)) };
}

const sumOver = (a: LedgerAccount, periods: string[]) => periods.reduce((s, p) => s + (a.amounts.get(p) ?? 0), 0);
const atEnd = (a: LedgerAccount, periods: string[]) => a.amounts.get(periods[periods.length - 1]) ?? 0;

function byType(accounts: LedgerAccount[], statement: StatementKind, types: string[]) {
  return accounts
    .filter((a) => a.statement === statement && types.includes(a.type))
    .sort((x, y) => x.sortOrder - y.sortOrder);
}

/** Totals for one column of the income statement. */
export interface IncomeTotals {
  revenue: Cents;
  cogs: Cents;
  grossProfit: Cents;
  opex: Cents;
  operatingIncome: Cents;
  otherNet: Cents;
  netIncome: Cents;
  depreciation: Cents;
  interest: Cents;
  ebitda: Cents;
}

export function incomeTotals(accounts: LedgerAccount[], periods: string[]): IncomeTotals {
  const s = (types: string[]) => byType(accounts, "INCOME", types).reduce((t, a) => t + sumOver(a, periods), 0);
  const sub = (subtype: string) =>
    byType(accounts, "INCOME", ["OPEX", "COGS"])
      .filter((a) => a.subtype === subtype)
      .reduce((t, a) => t + sumOver(a, periods), 0);
  const revenue = s(["REVENUE"]);
  const cogs = s(["COGS"]);
  const opex = s(["OPEX"]);
  const otherNet = s(["OTHER_INCOME"]) - s(["OTHER_EXPENSE"]);
  const grossProfit = revenue - cogs;
  const operatingIncome = grossProfit - opex;
  const netIncome = operatingIncome + otherNet;
  const depreciation = sub("DEPRECIATION");
  const interest = sub("INTEREST");
  return {
    revenue,
    cogs,
    grossProfit,
    opex,
    // Operating income here excludes interest, which sits in opex in many
    // small-business charts; EBITDA adds both back explicitly.
    operatingIncome: operatingIncome + interest,
    otherNet,
    netIncome,
    depreciation,
    interest,
    ebitda: netIncome + interest + depreciation,
  };
}

const pctOf = (v: number, base: number) => (base === 0 ? 0 : Math.round((v / base) * 10000) / 100);

export function incomeStatement(accounts: LedgerAccount[], columns: Column[]): Statement {
  const lines: StatementLine[] = [];
  const totals = columns.map((c) => incomeTotals(accounts, c.periods));
  const rev = totals.map((t) => t.revenue);
  const row = (key: string, label: string, kind: StatementLine["kind"], section: string, values: number[]): StatementLine => ({
    key,
    label,
    kind,
    section,
    values,
    pctOfRevenue: values.map((v, i) => pctOf(v, rev[i])),
  });

  const section = (title: string, types: string[]) => {
    for (const a of byType(accounts, "INCOME", types)) {
      lines.push(row(a.key, a.name, "line", title, columns.map((c) => sumOver(a, c.periods))));
    }
  };

  section("Revenue", ["REVENUE"]);
  lines.push(row("total_revenue", "Total Revenue", "subtotal", "Revenue", rev));
  section("Direct Costs", ["COGS"]);
  lines.push(row("total_cogs", "Total Direct Costs", "subtotal", "Direct Costs", totals.map((t) => t.cogs)));
  lines.push(row("gross_profit", "Gross Profit", "subtotal", "Gross Profit", totals.map((t) => t.grossProfit)));
  section("Operating Expenses", ["OPEX"]);
  lines.push(row("total_opex", "Total Operating Expenses", "subtotal", "Operating Expenses", totals.map((t) => t.opex)));
  if (byType(accounts, "INCOME", ["OTHER_INCOME", "OTHER_EXPENSE"]).length) {
    section("Other", ["OTHER_INCOME", "OTHER_EXPENSE"]);
  }
  lines.push(row("ebitda", "EBITDA", "subtotal", "Profit", totals.map((t) => t.ebitda)));
  lines.push(row("net_income", "Net Income", "subtotal", "Profit", totals.map((t) => t.netIncome)));
  return { kind: "INCOME", columns, lines };
}

export function balanceSheet(accounts: LedgerAccount[], columns: Column[]): Statement {
  const lines: StatementLine[] = [];
  const at = (a: LedgerAccount) => columns.map((c) => atEnd(a, c.periods));
  const group = (title: string, type: string, subtypes: (string | null)[]) => {
    const accts = byType(accounts, "BALANCE", [type]).filter((a) => subtypes.includes(a.subtype));
    for (const a of accts) lines.push({ key: a.key, label: a.name, kind: "line", section: title, values: at(a) });
    return columns.map((_, i) => accts.reduce((t, a) => t + at(a)[i], 0));
  };
  const add = (...xs: number[][]) => columns.map((_, i) => xs.reduce((t, x) => t + x[i], 0));

  const ca = group("Current Assets", "ASSET", ["CURRENT"]);
  lines.push({ key: "total_current_assets", label: "Total Current Assets", kind: "subtotal", section: "Current Assets", values: ca });
  const fa = group("Fixed Assets", "ASSET", ["FIXED", null]);
  const ta = add(ca, fa);
  lines.push({ key: "total_assets", label: "Total Assets", kind: "subtotal", section: "Assets", values: ta });

  const cl = group("Current Liabilities", "LIABILITY", ["CURRENT"]);
  lines.push({ key: "total_current_liabilities", label: "Total Current Liabilities", kind: "subtotal", section: "Current Liabilities", values: cl });
  const ltl = group("Long-Term Liabilities", "LIABILITY", ["LONG_TERM", null]);
  const tl = add(cl, ltl);
  lines.push({ key: "total_liabilities", label: "Total Liabilities", kind: "subtotal", section: "Liabilities", values: tl });

  // Equity is whatever closes the sheet; the source carries it as one line.
  const equity = columns.map((_, i) => ta[i] - tl[i]);
  lines.push({ key: "total_equity", label: "Owner Equity", kind: "subtotal", section: "Equity", values: equity });
  lines.push({ key: "total_liabilities_equity", label: "Total Liabilities & Equity", kind: "subtotal", section: "Equity", values: add(tl, equity) });
  return { kind: "BALANCE", columns, lines };
}

export function cashFlowStatement(accounts: LedgerAccount[], columns: Column[]): Statement {
  const lines: StatementLine[] = [];
  const section = (title: string, type: string) => {
    const accts = byType(accounts, "CASH_FLOW", [type]);
    for (const a of accts) lines.push({ key: a.key, label: a.name, kind: "line", section: title, values: columns.map((c) => sumOver(a, c.periods)) });
    return columns.map((c) => accts.reduce((t, a) => t + sumOver(a, c.periods), 0));
  };
  const op = section("Operating", "CF_OPERATING");
  lines.push({ key: "operating_cash_flow", label: "Cash From Operations", kind: "subtotal", section: "Operating", values: op });
  const inv = section("Investing", "CF_INVESTING");
  lines.push({ key: "investing_cash_flow", label: "Cash From Investing", kind: "subtotal", section: "Investing", values: inv });
  const fin = section("Financing", "CF_FINANCING");
  lines.push({ key: "financing_cash_flow", label: "Cash From Financing", kind: "subtotal", section: "Financing", values: fin });
  const net = columns.map((_, i) => op[i] + inv[i] + fin[i]);
  lines.push({ key: "net_change_in_cash", label: "Net Change In Cash", kind: "subtotal", section: "Cash", values: net });

  const cash = accounts.find((a) => a.statement === "BALANCE" && a.key === "cash");
  if (cash) {
    const ending = columns.map((c) => atEnd(cash, c.periods));
    const beginning = columns.map((c) => cash.amounts.get(shift(c.periods[0], -1)) ?? ending[columns.indexOf(c)] - net[columns.indexOf(c)]);
    lines.push({ key: "beginning_cash", label: "Beginning Cash", kind: "subtotal", section: "Cash", values: beginning });
    lines.push({ key: "ending_cash", label: "Ending Cash", kind: "subtotal", section: "Cash", values: ending });
  }
  return { kind: "CASH_FLOW", columns, lines };
}

export interface ProfitVsCash {
  netIncome: Cents;
  operatingCashFlow: Cents;
  gap: Cents;
  /** The working-capital and non-cash lines that explain the gap, largest first. */
  drivers: { key: string; label: string; cents: Cents }[];
}

/**
 * Why profit and cash differ for a set of months. A contractor can book profit
 * while slow payers, retainage, or material buys drain the bank; this names the
 * lines responsible.
 */
export function profitVsCash(accounts: LedgerAccount[], periods: string[]): ProfitVsCash {
  const op = byType(accounts, "CASH_FLOW", ["CF_OPERATING"]);
  const ni = op.find((a) => a.key === "net_income");
  const netIncome = ni ? sumOver(ni, periods) : incomeTotals(accounts, periods).netIncome;
  const operatingCashFlow = op.reduce((t, a) => t + sumOver(a, periods), 0);
  const drivers = op
    .filter((a) => a.key !== "net_income")
    .map((a) => ({ key: a.key, label: a.name, cents: sumOver(a, periods) }))
    .filter((d) => d.cents !== 0)
    .sort((x, y) => Math.abs(y.cents) - Math.abs(x.cents));
  return { netIncome, operatingCashFlow, gap: operatingCashFlow - netIncome, drivers };
}

export interface BudgetVariance {
  line: string;
  budget: Cents;
  actual: Cents;
  variance: Cents;
  variancePct: number;
}

/** Budget vs actual for a year, with each variance as a share of budget. */
export function budgetVsActual(rows: { line: string; budget: Cents; actual: Cents | null }[]): BudgetVariance[] {
  return rows.map((r) => {
    const actual = r.actual ?? 0;
    const variance = actual - r.budget;
    return { line: r.line, budget: r.budget, actual, variance, variancePct: r.budget === 0 ? 0 : Math.round((variance / Math.abs(r.budget)) * 1000) / 10 };
  });
}
