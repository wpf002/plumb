import { describe, it, expect } from "vitest";
import { parseCsv, toRecords, cents, date } from "../src/import/csv.js";
import { classifyIncome, classifyBalance, classifyCashFlow } from "../src/import/glclassify.js";
import { loanToken, kindOf } from "../src/import/importer.js";

describe("csv parsing", () => {
  it("handles quoted commas, escaped quotes, newlines in quotes, and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n1,"Musco - Multi-Field, Complex","say ""hi"""\r\n2,"two\nlines",x\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "Musco - Multi-Field, Complex", 'say "hi"'],
      ["2", "two\nlines", "x"],
    ]);
  });

  it("names a blank index column 'period' (pandas export)", () => {
    const { headers, records } = toRecords(",cash,ar\n2022-01,100.5,20\n");
    expect(headers).toEqual(["period", "cash", "ar"]);
    expect(records[0].period).toBe("2022-01");
  });

  it("converts money to integer cents and blanks to null", () => {
    expect(cents("1,234.56")).toBe(123456);
    expect(cents("-0.0")).toBe(0);
    expect(cents("")).toBeNull();
    expect(cents("nan")).toBeNull();
  });

  it("parses month and day dates at UTC midnight", () => {
    expect(date("2025-12")?.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(date("2021-06-01")?.toISOString()).toBe("2021-06-01T00:00:00.000Z");
    expect(date("soon")).toBeNull();
  });
});

describe("file recognition", () => {
  it("maps every DNRD export file to a kind by prefix", () => {
    expect(kindOf("03_income_statement_monthly.csv")).toBe("income");
    expect(kindOf("08_project_monthly_wip.csv")).toBe("wip");
    expect(kindOf("08_project_monthly_progress.csv")).toBe("progress");
    expect(kindOf("09b_payroll_monthly_detail.csv")).toBe("payroll");
    expect(kindOf("11c_amort_truck2024.csv")).toBe("amortization");
    expect(kindOf("20b_maintenance_agreement_detail.csv")).toBe("maintenanceDetail");
    expect(kindOf("20b_recurring_revenue_monthly.csv")).toBe("recurringMonthly");
    expect(kindOf("19_ai_insights.md")).toBeNull();
    expect(kindOf("99_mystery.csv")).toBeNull();
  });

  it("matches amortization files to loans despite naming drift", () => {
    expect(loanToken("11c_amort_truck2024.csv")).toBe(loanToken("LOAN-TRUCK24"));
    expect(loanToken("11_amort_mortgage.csv")).toBe(loanToken("MORTGAGE-01"));
    expect(loanToken("11b_amort_bobcat.csv")).toBe(loanToken("LOAN-BOBCAT"));
    expect(loanToken("11_amort_vanfleet21.csv")).not.toBe(loanToken("LOAN-VANFLEET23"));
  });
});

describe("statement classification", () => {
  it("types income lines by prefix and tags service lines", () => {
    const lines = classifyIncome(["period", "revenue_musco", "total_revenue", "cogs_direct_labor", "opex_depreciation", "opex_interest", "gross_margin_pct", "net_income"]);
    const by = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(by.revenue_musco).toMatchObject({ type: "REVENUE", serviceLine: "Musco" });
    expect(by.total_revenue.type).toBe("SUBTOTAL");
    expect(by.cogs_direct_labor).toMatchObject({ type: "COGS", subtype: "LABOR" });
    expect(by.opex_depreciation.subtype).toBe("DEPRECIATION");
    expect(by.opex_interest.subtype).toBe("INTEREST");
    expect(by.gross_margin_pct).toBeUndefined(); // ratios are computed, not stored
  });

  it("types balance-sheet lines by position against the totals", () => {
    const lines = classifyBalance(["period", "cash", "costs_in_excess_of_billings", "equipment_vehicles_net", "total_assets", "accounts_payable", "billings_in_excess_of_costs", "vehicle_equipment_debt", "total_liabilities", "total_equity", "check_balance_error"]);
    const by = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(by.cash).toMatchObject({ type: "ASSET", subtype: "CURRENT" });
    expect(by.costs_in_excess_of_billings).toMatchObject({ type: "ASSET", subtype: "CURRENT" });
    expect(by.equipment_vehicles_net).toMatchObject({ type: "ASSET", subtype: "FIXED" });
    expect(by.billings_in_excess_of_costs).toMatchObject({ type: "LIABILITY", subtype: "CURRENT" });
    expect(by.vehicle_equipment_debt).toMatchObject({ type: "LIABILITY", subtype: "LONG_TERM" });
    expect(by.total_equity.type).toBe("SUBTOTAL");
    expect(by.check_balance_error).toBeUndefined();
  });

  it("types cash-flow lines into operating, investing, financing", () => {
    const lines = classifyCashFlow(["period", "net_income", "change_in_retainage_receivable", "operating_cash_flow", "capex", "loc_draws", "owner_distributions", "ending_cash"]);
    const by = Object.fromEntries(lines.map((l) => [l.key, l.type]));
    expect(by).toMatchObject({
      net_income: "CF_OPERATING",
      change_in_retainage_receivable: "CF_OPERATING",
      operating_cash_flow: "SUBTOTAL",
      capex: "CF_INVESTING",
      loc_draws: "CF_FINANCING",
      owner_distributions: "CF_FINANCING",
      ending_cash: "SUBTOTAL",
    });
  });
});

describe("bank export dates", () => {
  it("reads M/D/YYYY and M/D/YY", () => {
    expect(date("3/7/2025")?.toISOString().slice(0, 10)).toBe("2025-03-07");
    expect(date("12/31/25")?.toISOString().slice(0, 10)).toBe("2025-12-31");
  });
});
