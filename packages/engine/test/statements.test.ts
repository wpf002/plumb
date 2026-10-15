import { describe, it, expect } from "vitest";
import {
  balanceSheet,
  budgetVsActual,
  cashFlowStatement,
  columnsFor,
  incomeStatement,
  incomeTotals,
  priorPeriod,
  priorYear,
  profitVsCash,
  type LedgerAccount,
} from "../src/statements.js";

const acct = (key: string, statement: LedgerAccount["statement"], type: string, amounts: Record<string, number>, extra: Partial<LedgerAccount> = {}): LedgerAccount => ({
  key, name: key, statement, type, subtype: null, serviceLine: null, sortOrder: 0, amounts: new Map(Object.entries(amounts)), ...extra,
});

const months = ["2024-11", "2024-12", "2025-01", "2025-02", "2025-03"];
const each = (v: number) => Object.fromEntries(months.map((m) => [m, v]));

const ledger: LedgerAccount[] = [
  acct("revenue_service", "INCOME", "REVENUE", each(100_000), { serviceLine: "Service" }),
  acct("cogs_labor", "INCOME", "COGS", each(60_000), { subtype: "LABOR" }),
  acct("opex_rent", "INCOME", "OPEX", each(10_000)),
  acct("opex_depreciation", "INCOME", "OPEX", each(2_000), { subtype: "DEPRECIATION" }),
  acct("opex_interest", "INCOME", "OPEX", each(1_000), { subtype: "INTEREST" }),
  acct("cash", "BALANCE", "ASSET", { "2024-12": 50_000, "2025-03": 80_000 }, { subtype: "CURRENT" }),
  acct("equipment_net", "BALANCE", "ASSET", { "2024-12": 30_000, "2025-03": 28_000 }, { subtype: "FIXED" }),
  acct("accounts_payable", "BALANCE", "LIABILITY", { "2024-12": 20_000, "2025-03": 25_000 }, { subtype: "CURRENT" }),
  acct("net_income", "CASH_FLOW", "CF_OPERATING", each(27_000)),
  acct("change_in_ar", "CASH_FLOW", "CF_OPERATING", each(-40_000)),
  acct("owner_distributions", "CASH_FLOW", "CF_FINANCING", each(-5_000)),
];

describe("statement columns", () => {
  it("builds annual, quarterly, YTD and trailing-12 columns through a month", () => {
    expect(columnsFor("annual", months, "2025-03").map((c) => c.label)).toEqual(["2024", "2025"]);
    expect(columnsFor("quarterly", months, "2025-03").map((c) => c.label)).toEqual(["2024 Q4", "2025 Q1"]);
    expect(columnsFor("ytd", months, "2025-03")[0].periods).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(columnsFor("t12", months, "2025-02")[0].periods).toHaveLength(4);
  });

  it("shifts columns for prior-year and prior-period comparisons", () => {
    const q1 = { label: "2025 Q1", periods: ["2025-01", "2025-02", "2025-03"] };
    expect(priorYear(q1).periods).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(priorPeriod(q1).periods).toEqual(["2024-10", "2024-11", "2024-12"]);
  });
});

describe("income statement", () => {
  it("recomputes every subtotal from typed lines", () => {
    const t = incomeTotals(ledger, ["2025-01"]);
    expect(t).toMatchObject({ revenue: 100_000, cogs: 60_000, grossProfit: 40_000, opex: 13_000, netIncome: 27_000 });
    expect(t.ebitda).toBe(30_000); // net income + interest + depreciation
  });

  it("reports each line as a share of revenue", () => {
    const s = incomeStatement(ledger, [{ label: "Jan", periods: ["2025-01"] }]);
    const labor = s.lines.find((l) => l.key === "cogs_labor")!;
    expect(labor.pctOfRevenue![0]).toBe(60);
    expect(s.lines.find((l) => l.key === "gross_profit")!.values[0]).toBe(40_000);
  });
});

describe("balance sheet", () => {
  it("takes the last month of a column and balances with equity", () => {
    const s = balanceSheet(ledger, [{ label: "2025 Q1", periods: ["2025-01", "2025-02", "2025-03"] }]);
    const v = (k: string) => s.lines.find((l) => l.key === k)!.values[0];
    expect(v("total_assets")).toBe(108_000);
    expect(v("total_liabilities")).toBe(25_000);
    expect(v("total_equity")).toBe(83_000);
    expect(v("total_liabilities_equity")).toBe(v("total_assets"));
  });
});

describe("cash flow and profit vs cash", () => {
  it("sums sections and lands on the balance sheet's cash", () => {
    const s = cashFlowStatement(ledger, [{ label: "Q1", periods: ["2025-01", "2025-02", "2025-03"] }]);
    const v = (k: string) => s.lines.find((l) => l.key === k)!.values[0];
    expect(v("operating_cash_flow")).toBe(3 * -13_000);
    expect(v("financing_cash_flow")).toBe(-15_000);
    expect(v("ending_cash")).toBe(80_000);
    expect(v("beginning_cash")).toBe(50_000);
  });

  it("names what separates profit from cash", () => {
    const r = profitVsCash(ledger, ["2025-01"]);
    expect(r.netIncome).toBe(27_000);
    expect(r.operatingCashFlow).toBe(-13_000);
    expect(r.gap).toBe(-40_000);
    expect(r.drivers[0]).toMatchObject({ key: "change_in_ar", cents: -40_000 });
  });
});

describe("budget vs actual", () => {
  it("expresses variance against the budget's magnitude", () => {
    const [rev, ni] = budgetVsActual([
      { line: "REVENUE", budget: 100_000, actual: 94_200 },
      { line: "NET_INCOME", budget: 20_000, actual: 13_500 },
    ]);
    expect(rev.variancePct).toBe(-5.8);
    expect(ni.variancePct).toBe(-32.5);
  });
});
