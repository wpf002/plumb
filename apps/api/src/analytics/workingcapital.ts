import { prisma } from "@plumb/db";
import {
  agingReport,
  collectionsPriority,
  currentRatioReading,
  debtToEquityReading,
  dscrReading,
  incomeTotals,
  locUtilizationReading,
  quickRatioReading,
  type Aging,
  type OpenItem,
} from "@plumb/engine";
import { monthlyEquivalentCents } from "@plumb/shared";
import { periodOf } from "../import/csv.js";
import { companyAsOf, openingCashCents } from "../snapshot.js";
import type { ArAging, LocHistory } from "./types.js";
import type { Ledger } from "./ledger.js";

/** Label for invoices with no customer on file. */
export const UNKNOWN_CUSTOMER = "Unknown customer";

const n = (b: bigint | null | undefined) => Number(b ?? 0n);

/** Receivables open at `asOf`: issued on or before it and not yet paid by it. */
export async function openReceivables(companyId: string, asOf: Date): Promise<OpenItem[]> {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, issueDate: { lte: asOf }, status: { not: "VOID" }, OR: [{ paidDate: null }, { paidDate: { gt: asOf } }] },
    include: { customer: true },
  });
  if (invoices.length > 0) {
    return invoices.map((i) => ({
      id: i.externalId ?? i.id,
      party: i.customer?.name ?? UNKNOWN_CUSTOMER,
      partyId: i.customer?.externalId ?? null,
      amountCents: n(i.amount),
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      partyAvgDaysLate:
        i.customer?.avgDaysToPay !== null && i.customer?.avgDaysToPay !== undefined
          ? i.customer.avgDaysToPay - (i.customer.paymentTermsDays ?? i.termsDays)
          : null,
    }));
  }
  // Companies without invoice detail (manual or QBO-synced cash ledger): use
  // expected inbound cash that has come due.
  const events = await prisma.cashEvent.findMany({
    where: { companyId, direction: "IN", actualDate: null, status: { in: ["EXPECTED", "LATE"] }, expectedDate: { lte: asOf } },
    include: { project: true },
  });
  return events.map((e) => ({
    id: e.id,
    party: e.project?.client ?? "Unassigned",
    amountCents: n(e.amount),
    issueDate: e.expectedDate,
    dueDate: e.expectedDate,
  }));
}

export async function openPayables(companyId: string, asOf: Date): Promise<OpenItem[]> {
  const bills = await prisma.bill.findMany({
    where: { companyId, billDate: { lte: asOf }, status: { not: "VOID" }, OR: [{ paidDate: null }, { paidDate: { gt: asOf } }] },
    include: { vendor: true },
  });
  if (bills.length > 0) {
    return bills.map((b) => ({
      id: b.externalId ?? b.id,
      party: b.vendor?.name ?? b.category ?? "Unknown vendor",
      partyId: b.vendor?.externalId ?? null,
      amountCents: n(b.amount),
      issueDate: b.billDate,
      dueDate: b.dueDate,
    }));
  }
  const events = await prisma.cashEvent.findMany({
    where: { companyId, direction: "OUT", category: "VENDOR_BILL", actualDate: null, status: "EXPECTED", expectedDate: { lte: asOf } },
  });
  return events.map((e) => ({ id: e.id, party: "Vendor", amountCents: n(e.amount), issueDate: e.expectedDate, dueDate: e.expectedDate }));
}

export function toArAging(aging: Aging): ArAging {
  const top = aging.byParty[0] ?? null;
  const pastDue = [...aging.byParty].sort((a, b) => b.pastDue30Cents - a.pastDue30Cents)[0];
  return {
    asOf: aging.asOf,
    totalCents: aging.totalCents,
    pastDue30Cents: aging.pastDue30Cents,
    largest: top ? { customer: top.party, externalId: top.partyId, cents: top.totalCents } : null,
    largestPastDue:
      pastDue && pastDue.pastDue30Cents > 0
        ? { customer: pastDue.party, externalId: pastDue.partyId, pastDueCents: pastDue.pastDue30Cents, totalCents: pastDue.totalCents }
        : null,
  };
}

export async function arAging(companyId: string): Promise<{ aging: Aging; asOf: Date }> {
  const asOf = await companyAsOf(companyId);
  return { aging: agingReport(await openReceivables(companyId, asOf), asOf), asOf };
}

/** Line-of-credit history from the balance sheet; limit from the liability record. */
export async function locHistory(companyId: string, ledger: Ledger): Promise<LocHistory> {
  const lines = await prisma.liability.findMany({ where: { companyId, kind: "LINE_OF_CREDIT" } });
  const limitCents = lines.reduce((s, l) => s + n(l.creditLimit), 0);
  let peakBalanceCents = 0;
  let peakPeriod: string | null = null;
  for (const p of ledger.periods) {
    const v = ledger.get("BALANCE", "line_of_credit", p) ?? 0;
    if (v > peakBalanceCents) {
      peakBalanceCents = v;
      peakPeriod = p;
    }
  }
  if (ledger.periods.length === 0) {
    peakBalanceCents = lines.reduce((s, l) => s + n(l.currentBalance), 0);
  }
  return { limitCents, peakBalanceCents, peakPeriod, everDrawn: peakBalanceCents > 0 };
}

const DEBT_KEYS = /loan|debt|mortgage|line_of_credit|notes_payable/;

/** Total debt at the as-of month: ledger debt lines when present, else the liability register. */
export async function totalDebtCents(companyId: string, ledger: Ledger): Promise<number> {
  const asOfPeriod = periodOf(await companyAsOf(companyId));
  const last = ledger.periods.filter((p) => p <= asOfPeriod).at(-1);
  const debtLines = ledger.accounts.filter((a) => a.statement === "BALANCE" && a.type === "LIABILITY" && DEBT_KEYS.test(a.key));
  if (last && debtLines.length) return debtLines.reduce((s, a) => s + (a.amounts.get(last) ?? 0), 0);
  const register = await prisma.liability.aggregate({ where: { companyId, active: true }, _sum: { currentBalance: true } });
  return n(register._sum.currentBalance);
}

export interface WorkingCapital {
  asOf: string;
  cashCents: number;
  receivablesCents: number;
  inventoryCents: number;
  currentAssetsCents: number;
  payablesCents: number;
  currentDebtCents: number;
  currentLiabilitiesCents: number;
  workingCapitalCents: number;
  currentRatio: number | null;
  quickRatio: number | null;
  readings: { currentRatio: ReturnType<typeof currentRatioReading>; quickRatio: ReturnType<typeof quickRatioReading> };
}

/**
 * Working capital at the as-of month. From the balance sheet when the company
 * has one; otherwise assembled from cash, open receivables, open payables, and
 * the next twelve months of loan principal.
 */
export async function workingCapital(companyId: string, ledger: Ledger): Promise<WorkingCapital> {
  const asOf = await companyAsOf(companyId);
  const last = ledger.periods.filter((p) => p <= periodOf(asOf)).at(-1);
  const bs = (pred: (a: Ledger["accounts"][number]) => boolean) =>
    last ? ledger.accounts.filter((a) => a.statement === "BALANCE" && pred(a)).reduce((s, a) => s + (a.amounts.get(last) ?? 0), 0) : 0;

  let cash: number, ar: number, inventory: number, ca: number, ap: number, currentDebt: number, cl: number;
  if (last) {
    cash = bs((a) => a.key === "cash");
    ar = bs((a) => /receivable/.test(a.key));
    inventory = bs((a) => /inventory/.test(a.key));
    ca = bs((a) => a.type === "ASSET" && a.subtype === "CURRENT");
    ap = bs((a) => a.key === "accounts_payable");
    currentDebt = bs((a) => a.key === "line_of_credit");
    cl = bs((a) => a.type === "LIABILITY" && a.subtype === "CURRENT");
  } else {
    cash = await openingCashCents(companyId);
    ar = (await openReceivables(companyId, asOf)).reduce((s, i) => s + i.amountCents, 0);
    inventory = 0;
    ca = cash + ar;
    ap = (await openPayables(companyId, asOf)).reduce((s, i) => s + i.amountCents, 0);
    const loans = await prisma.liability.findMany({ where: { companyId, active: true } });
    currentDebt = loans.reduce((s, l) => s + Math.min(n(l.currentBalance), monthlyEquivalentCents(n(l.paymentAmount), l.paymentFrequency) * 12), 0);
    cl = ap + currentDebt;
  }
  const currentRatio = cl > 0 ? Math.round((ca / cl) * 100) / 100 : null;
  const quickRatio = cl > 0 ? Math.round(((cash + ar) / cl) * 100) / 100 : null;
  return {
    asOf: asOf.toISOString().slice(0, 10),
    cashCents: cash,
    receivablesCents: ar,
    inventoryCents: inventory,
    currentAssetsCents: ca,
    payablesCents: ap,
    currentDebtCents: currentDebt,
    currentLiabilitiesCents: cl,
    workingCapitalCents: ca - cl,
    currentRatio,
    quickRatio,
    readings: { currentRatio: currentRatioReading(currentRatio), quickRatio: quickRatioReading(quickRatio) },
  };
}

export interface DebtDashboard {
  totalDebtCents: number;
  annualDebtServiceCents: number;
  monthlyDebtBurdenCents: number;
  debtToEquity: number | null;
  dscr: number | null;
  loc: LocHistory & { balanceCents: number; utilizationPct: number | null };
  readings: Record<"dscr" | "debtToEquity" | "loc", { label: string; tone: string }>;
  loans: {
    id: string;
    lender: string | null;
    type: string;
    name: string;
    originalCents: number;
    balanceCents: number;
    paymentCents: number;
    ratePct: number;
    maturity: Date | null;
    collateral: string | null;
  }[];
}

export async function debtDashboard(companyId: string, ledger: Ledger): Promise<DebtDashboard> {
  const asOf = await companyAsOf(companyId);
  const last = ledger.periods.filter((p) => p <= periodOf(asOf)).at(-1);
  const loans = await prisma.liability.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { currentBalance: "desc" }] });
  const monthly = loans
    .filter((l) => l.active && l.kind !== "LINE_OF_CREDIT")
    .reduce((s, l) => s + monthlyEquivalentCents(n(l.paymentAmount), l.paymentFrequency), 0);
  const totalDebt = await totalDebtCents(companyId, ledger);
  const equity = last
    ? ledger.accounts.filter((a) => a.statement === "BALANCE" && a.type === "ASSET").reduce((s, a) => s + (a.amounts.get(last) ?? 0), 0) -
      ledger.accounts.filter((a) => a.statement === "BALANCE" && a.type === "LIABILITY").reduce((s, a) => s + (a.amounts.get(last) ?? 0), 0)
    : null;
  const t12 = ledger.periods.filter((p) => p <= periodOf(asOf)).slice(-12);
  const ebitda = t12.length ? incomeTotals(ledger.accounts, t12).ebitda : null;
  const annual = monthly * 12;
  const dscr = annual > 0 && ebitda !== null ? Math.round((ebitda / annual) * 100) / 100 : null;
  const dte = equity && equity > 0 ? Math.round((totalDebt / equity) * 100) / 100 : null;
  const loc = await locHistory(companyId, ledger);
  const locBalance = last ? ledger.get("BALANCE", "line_of_credit", last) ?? 0 : loans.filter((l) => l.kind === "LINE_OF_CREDIT").reduce((s, l) => s + n(l.currentBalance), 0);
  const utilization = loc.limitCents > 0 ? Math.round((locBalance / loc.limitCents) * 1000) / 10 : null;
  return {
    totalDebtCents: totalDebt,
    annualDebtServiceCents: annual,
    monthlyDebtBurdenCents: monthly,
    debtToEquity: dte,
    dscr,
    loc: { ...loc, balanceCents: locBalance, utilizationPct: utilization },
    readings: { dscr: dscrReading(dscr), debtToEquity: debtToEquityReading(dte), loc: locUtilizationReading(utilization) },
    loans: loans.map((l) => ({
      id: l.id,
      lender: l.lender,
      type: l.kind,
      name: l.name,
      originalCents: n(l.originalPrincipal),
      balanceCents: n(l.currentBalance),
      paymentCents: n(l.paymentAmount),
      ratePct: l.interestRatePct,
      maturity: l.maturityDate ?? l.payoffDate,
      collateral: l.collateral,
    })),
  };
}

export async function collections(companyId: string) {
  const asOf = await companyAsOf(companyId);
  const items = await openReceivables(companyId, asOf);
  return collectionsPriority(items, asOf).slice(0, 15);
}
