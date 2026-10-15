import { prisma } from "@plumb/db";
import { bookValueCents, incomeTotals } from "@plumb/engine";
import { companyAsOf } from "../snapshot.js";
import type { Ledger } from "./ledger.js";
import { completeYears } from "./operations.js";

/**
 * The year-end package a CPA asks for: P&L by account with a suggested tax
 * line, payroll totals, contractor payments over the 1099 threshold, asset
 * purchases and depreciation, loan interest, owner distributions, and the
 * year-end balance sheet. Book figures; the CPA makes the tax adjustments.
 */

const NEC_THRESHOLD_CENTS = 600_00;
const n = (b: bigint | null | undefined) => Number(b ?? 0n);

/** Suggested tax line for an account, for the CPA to confirm. */
export function taxLine(a: { type: string; subtype: string | null; key: string; name: string }): string {
  const k = `${a.key} ${a.name}`.toLowerCase();
  if (a.type === "REVENUE") return "Gross receipts";
  if (a.type === "COGS") return /subcontract/.test(k) ? "Cost of goods sold: contract labor" : /labor|payroll|wage/.test(k) ? "Cost of goods sold: labor" : /material/.test(k) ? "Cost of goods sold: materials" : "Cost of goods sold: other";
  if (a.subtype === "OWNER_COMP" || /officer/.test(k)) return "Compensation of officers";
  if (a.subtype === "DEPRECIATION") return "Depreciation";
  if (a.subtype === "INTEREST") return "Interest";
  if (/payroll tax|payroll_tax|benefit/.test(k)) return "Taxes, benefits: payroll";
  if (/payroll|salar|wage|admin_payroll|gm_salary|sales_payroll/.test(k)) return "Salaries and wages";
  if (/(^|[^a-z])rent|lease/.test(k)) return "Rents";
  if (/occupancy/.test(k)) return "Utilities";
  if (/property tax|license|permit/.test(k)) return "Taxes and licenses";
  if (/insurance/.test(k)) return "Insurance";
  if (/repair|maintenance/.test(k)) return "Repairs and maintenance";
  if (/advertis|marketing/.test(k)) return "Advertising";
  if (/professional|legal|accounting/.test(k)) return "Legal and professional services";
  if (/vehicle|fuel|auto/.test(k)) return "Car and truck expenses";
  if (/utilit/.test(k)) return "Utilities";
  if (/software|office|supplies|it\b|crm/.test(k)) return "Office expense";
  if (a.type === "OTHER_INCOME") return "Other income";
  return "Other deductions";
}

export async function taxPackage(companyId: string, ledger: Ledger, year?: number) {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const y = year ?? years.at(-1);
  if (!y) throw new Error("The tax package needs a full year of books.");
  const periods = ledger.periods.filter((p) => p.startsWith(String(y)));
  const sumOf = (a: (typeof ledger.accounts)[number]) => periods.reduce((s, p) => s + (a.amounts.get(p) ?? 0), 0);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const t = incomeTotals(ledger.accounts, periods);

  const pnl = ledger.accounts
    .filter((a) => a.statement === "INCOME")
    .map((a) => ({ account: a.name, type: a.type, taxLine: taxLine(a), amountCents: sumOf(a) }))
    .filter((r) => r.amountCents !== 0);
  const byLine = new Map<string, number>();
  for (const r of pnl) byLine.set(r.taxLine, (byLine.get(r.taxLine) ?? 0) + r.amountCents);

  // Payroll by person from the payroll detail.
  const entries = await prisma.timeEntry.findMany({ where: { companyId, period: { startsWith: String(y) } }, include: { employee: true } });
  const people = new Map<string, { name: string; position: string | null; grossCents: number; hours: number }>();
  for (const e of entries) {
    const p = people.get(e.employeeId) ?? { name: e.employee.name, position: e.employee.position, grossCents: 0, hours: 0 };
    p.grossCents += n(e.grossPay);
    p.hours += e.regularHours + e.overtimeHours;
    people.set(e.employeeId, p);
  }

  // Contractors: subcontract vendors paid in the year, over the 1099-NEC threshold.
  const bills = await prisma.bill.findMany({ where: { companyId, OR: [{ paidDate: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) } }] }, include: { vendor: true } });
  const contractors = new Map<string, { vendor: string; paidCents: number }>();
  for (const b of bills) {
    const isSub = b.vendor?.isSubcontractor || /sub/i.test(b.vendor?.category ?? "") || /sub/i.test(b.category ?? "");
    if (!isSub || !b.vendor) continue;
    const c = contractors.get(b.vendor.id) ?? { vendor: b.vendor.name, paidCents: 0 };
    c.paidCents += n(b.amount);
    contractors.set(b.vendor.id, c);
  }

  // Assets placed in service this year and book depreciation per asset.
  const assets = await prisma.asset.findMany({ where: { companyId } });
  const start = new Date(Date.UTC(y - 1, 11, 31));
  const end = new Date(Date.UTC(y, 11, 31));
  const asset = (a: (typeof assets)[number]) => ({ purchaseDate: a.purchaseDate, costCents: n(a.purchaseCost), salvageCents: n(a.salvageValue), usefulLifeMonths: a.usefulLifeMonths });
  const purchases = assets.filter((a) => a.purchaseDate.getUTCFullYear() === y).map((a) => ({ asset: a.name, placedInService: a.purchaseDate.toISOString().slice(0, 10), costCents: n(a.purchaseCost) }));
  const depreciation = assets
    .filter((a) => a.category !== "REAL_ESTATE" && a.purchaseDate <= end && a.usefulLifeMonths)
    .map((a) => {
      const open = a.purchaseDate > start ? n(a.purchaseCost) : bookValueCents(asset(a), start);
      return { asset: a.name, bookDepreciationCents: open - bookValueCents(asset(a), end) };
    })
    .filter((r) => r.bookDepreciationCents > 0);

  const cf = (re: RegExp) => ledger.accounts.filter((a) => a.statement === "CASH_FLOW" && re.test(a.key)).reduce((s, a) => s + sumOf(a), 0);
  const distributions = Math.abs(cf(/distribution|draw|dividend/)) || n(company.ownerDistributionsCents);
  const capex = Math.abs(cf(/capex|capital_expend/));

  const last = periods.at(-1)!;
  const balance = ledger.accounts
    .filter((a) => a.statement === "BALANCE" && a.type !== "SUBTOTAL")
    .map((a) => ({ account: a.name, type: a.type, amountCents: a.amounts.get(last) ?? 0 }))
    .filter((r) => r.amountCents !== 0);

  return {
    company: company.name,
    legalStructure: company.legalStructure,
    accountingMethod: company.accountingMethod,
    year: y,
    years,
    summary: {
      revenueCents: t.revenue,
      cogsCents: t.cogs,
      grossProfitCents: t.grossProfit,
      opexCents: t.opex,
      netIncomeCents: t.netIncome,
      depreciationCents: t.depreciation,
      interestCents: t.interest,
      payrollCents: [...people.values()].reduce((s, p) => s + p.grossCents, 0),
      contractorCents: [...contractors.values()].reduce((s, c) => s + c.paidCents, 0),
      assetPurchasesCents: purchases.reduce((s, p) => s + p.costCents, 0) || capex,
      distributionsCents: distributions,
    },
    taxLines: [...byLine].map(([line, amountCents]) => ({ line, amountCents })).sort((a, b) => b.amountCents - a.amountCents),
    pnl,
    payroll: [...people.values()].sort((a, b) => b.grossCents - a.grossCents),
    contractors: [...contractors.values()].map((c) => ({ ...c, form1099: c.paidCents >= NEC_THRESHOLD_CENTS })).sort((a, b) => b.paidCents - a.paidCents),
    assetPurchases: purchases,
    depreciation,
    balance,
  };
}

type Pkg = Awaited<ReturnType<typeof taxPackage>>;
const dollars = (c: number) => (c / 100).toFixed(2);
const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function taxCsv(p: Pkg): string {
  const rows: unknown[][] = [["Tax Package", p.company], ["Year", p.year], ["Entity Type", p.legalStructure ?? ""], ["Accounting Method", p.accountingMethod ?? ""], ["Basis", "Book figures; tax lines are suggestions for review"], []];
  const s = p.summary;
  rows.push(["Summary", "Amount"], ["Gross Receipts", dollars(s.revenueCents)], ["Cost of Goods Sold", dollars(s.cogsCents)], ["Gross Profit", dollars(s.grossProfitCents)], ["Operating Expenses", dollars(s.opexCents)], ["Net Income", dollars(s.netIncomeCents)], ["Depreciation", dollars(s.depreciationCents)], ["Interest", dollars(s.interestCents)], ["Payroll", dollars(s.payrollCents)], ["Contractor Payments", dollars(s.contractorCents)], ["Asset Purchases", dollars(s.assetPurchasesCents)], ["Owner Distributions", dollars(s.distributionsCents)], []);
  rows.push(["Tax Line", "Amount"], ...p.taxLines.map((l) => [l.line, dollars(l.amountCents)]), []);
  rows.push(["Account", "Type", "Suggested Tax Line", "Amount"], ...p.pnl.map((r) => [r.account, r.type, r.taxLine, dollars(r.amountCents)]), []);
  rows.push(["Employee", "Position", "Hours", "Gross Pay"], ...p.payroll.map((e) => [e.name, e.position ?? "", e.hours.toFixed(1), dollars(e.grossCents)]), []);
  rows.push(["Contractor", "Paid", "1099-NEC"], ...p.contractors.map((c) => [c.vendor, dollars(c.paidCents), c.form1099 ? "Yes" : "No"]), []);
  rows.push(["Asset Purchased", "Placed in Service", "Cost"], ...p.assetPurchases.map((a) => [a.asset, a.placedInService, dollars(a.costCents)]), []);
  rows.push(["Asset", "Book Depreciation"], ...p.depreciation.map((d) => [d.asset, dollars(d.bookDepreciationCents)]), []);
  rows.push(["Balance Sheet Account", "Type", `Dec 31, ${p.year}`], ...p.balance.map((b) => [b.account, b.type, dollars(b.amountCents)]));
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
