import { prisma } from "@plumb/db";
import { incomeTotals } from "@plumb/engine";
import { companyAsOf } from "../snapshot.js";
import type { Ledger } from "./ledger.js";
import { completeYears } from "./operations.js";
import { backlog } from "./projects.js";
import { arAging, debtDashboard, openPayables, workingCapital } from "./workingcapital.js";
import { agingReport } from "@plumb/engine";

/**
 * The package a lender asks for at renewal: three years of results, covenant
 * ratios, receivables and payables aging, the loan schedule, and backlog.
 */
export async function lenderPackage(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const years = completeYears(ledger, asOf).slice(-3);
  const [wc, debt, ar, ap, bl] = await Promise.all([
    workingCapital(companyId, ledger),
    debtDashboard(companyId, ledger),
    arAging(companyId),
    openPayables(companyId, asOf),
    backlog(companyId),
  ]);
  const last = ledger.periods.filter((p) => p <= asOf.toISOString().slice(0, 7)).at(-1);
  const sumBs = (type: string) => (last ? ledger.accounts.filter((a) => a.statement === "BALANCE" && a.type === type).reduce((s, a) => s + (a.amounts.get(last) ?? 0), 0) : 0);
  const equity = sumBs("ASSET") - sumBs("LIABILITY");
  const results = years.map((y) => {
    const t = incomeTotals(ledger.accounts, ledger.periods.filter((p) => p.startsWith(String(y))));
    return { year: y, revenueCents: t.revenue, grossProfitCents: t.grossProfit, ebitdaCents: t.ebitda, netIncomeCents: t.netIncome, interestCents: t.interest, depreciationCents: t.depreciation };
  });
  const latest = results.at(-1);
  const apAging = agingReport(ap, asOf);
  return {
    company: company.name,
    asOf: asOf.toISOString().slice(0, 10),
    results,
    covenants: {
      dscr: debt.dscr,
      debtToEbitda: latest && latest.ebitdaCents > 0 ? Math.round((debt.totalDebtCents / latest.ebitdaCents) * 100) / 100 : null,
      debtToEquity: debt.debtToEquity,
      currentRatio: wc.currentRatio,
      quickRatio: wc.quickRatio,
      workingCapitalCents: wc.workingCapitalCents,
      tangibleNetWorthCents: equity,
      annualDebtServiceCents: debt.annualDebtServiceCents,
    },
    receivables: { totalCents: ar.aging.totalCents, buckets: ar.aging.buckets },
    payables: { totalCents: apAging.totalCents, buckets: apAging.buckets },
    loans: debt.loans.filter((l) => l.balanceCents > 0),
    backlog: { signedCents: bl.signedCents, weightedPipelineCents: bl.weightedPipelineCents },
  };
}

type Pkg = Awaited<ReturnType<typeof lenderPackage>>;
const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));
const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One CSV with a section per table, the way a credit analyst pastes it into a spreadsheet. */
export function lenderCsv(p: Pkg): string {
  const rows: unknown[][] = [];
  rows.push(["Lender Package", p.company], ["As Of", p.asOf], []);
  rows.push(["Results", ...p.results.map((r) => r.year)]);
  for (const [label, k] of [["Revenue", "revenueCents"], ["Gross Profit", "grossProfitCents"], ["EBITDA", "ebitdaCents"], ["Interest", "interestCents"], ["Depreciation", "depreciationCents"], ["Net Income", "netIncomeCents"]] as const) rows.push([label, ...p.results.map((r) => dollars(r[k]))]);
  rows.push([], ["Covenants", "Value"]);
  const c = p.covenants;
  rows.push(["Debt Service Coverage", c.dscr ?? ""], ["Debt to EBITDA", c.debtToEbitda ?? ""], ["Debt to Equity", c.debtToEquity ?? ""], ["Current Ratio", c.currentRatio ?? ""], ["Quick Ratio", c.quickRatio ?? ""], ["Working Capital", dollars(c.workingCapitalCents)], ["Tangible Net Worth", dollars(c.tangibleNetWorthCents)], ["Annual Debt Service", dollars(c.annualDebtServiceCents)]);
  const buckets = ["current", "1-30", "31-60", "61-90", "90+"] as const;
  rows.push([], ["Aging", ...buckets, "Total"]);
  rows.push(["Receivables", ...buckets.map((b) => dollars(p.receivables.buckets[b])), dollars(p.receivables.totalCents)]);
  rows.push(["Payables", ...buckets.map((b) => dollars(p.payables.buckets[b])), dollars(p.payables.totalCents)]);
  rows.push([], ["Loans", "Lender", "Balance", "Payment", "Rate %", "Maturity", "Collateral"]);
  for (const l of p.loans) rows.push([l.name, l.lender ?? "", dollars(l.balanceCents), dollars(l.paymentCents), l.ratePct, l.maturity ? new Date(l.maturity).toISOString().slice(0, 10) : "", l.collateral ?? ""]);
  rows.push([], ["Signed Backlog", dollars(p.backlog.signedCents)], ["Weighted Pipeline", dollars(p.backlog.weightedPipelineCents)]);
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
