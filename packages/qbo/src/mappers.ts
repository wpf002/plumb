import { sourceKeyFor, type Frequency } from "@plumb/shared";
import type { CostCategory } from "@plumb/shared";

// --- Minimal QBO entity shapes (only fields we consume) ---------------------

export interface QboRef {
  value: string;
  name?: string;
}
export interface QboInvoice {
  Id: string;
  TotalAmt: number;
  Balance: number;
  TxnDate: string;
  DueDate?: string;
  CustomerRef: QboRef;
}
export interface QboExpenseLine {
  Amount?: number;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: { CustomerRef?: QboRef; AccountRef?: QboRef };
  ItemBasedExpenseLineDetail?: { CustomerRef?: QboRef; ItemRef?: QboRef };
}
export interface QboBill {
  Id: string;
  TotalAmt: number;
  TxnDate: string;
  DueDate?: string;
  VendorRef?: QboRef;
  Line?: QboExpenseLine[];
}
export interface QboPurchase extends QboBill {
  PaymentType?: string;
}
export interface QboTimeActivity {
  Id: string;
  TxnDate: string;
  Hours?: number;
  Minutes?: number;
  HourlyRate?: number;
  CustomerRef?: QboRef;
}
export interface QboCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  Job?: boolean;
  ParentRef?: QboRef;
}

const cents = (dollars: number): number => Math.round((dollars ?? 0) * 100);

// --- Category classification ------------------------------------------------

const RULES: [RegExp, CostCategory][] = [
  [/labor|wage|payroll|apprentice|journeyman|foreman/i, "LABOR"],
  [/material|wire|conduit|pipe|lumber|fixture|gear|panel|breaker|supply/i, "MATERIAL"],
  [/equip|rental|lift|tool|machine/i, "EQUIPMENT"],
  [/travel|mileage|fuel|per\s?diem|lodging/i, "TRAVEL"],
  [/sub|subcontract/i, "SUBCONTRACT"],
];

/** A per-company override: if the QBO name contains `keyword`, use `category`. */
export interface CategoryOverride {
  keyword: string;
  category: CostCategory;
}

/**
 * Map a QBO account/item name to a Plumb cost category. Per-company overrides win
 * over the built-in rules, so a shop can correct its own chart of accounts
 * (e.g. "Rexel" -> MATERIAL) without touching code.
 */
export function classifyCategory(
  name?: string,
  overrides: CategoryOverride[] = []
): CostCategory {
  if (!name) return "OTHER";
  const lower = name.toLowerCase();
  for (const o of overrides) {
    if (o.keyword && lower.includes(o.keyword.toLowerCase())) return o.category;
  }
  for (const [re, cat] of RULES) if (re.test(name)) return cat;
  return "OTHER";
}

// --- Mapped outputs (fed to the persistence layer in sync.ts) ---------------

export interface MappedProject {
  qboJobId: string;
  name: string;
  client: string;
  isJob: boolean;
}
export interface MappedCashEvent {
  qboId: string;
  qboJobId?: string;
  direction: "IN" | "OUT";
  amountCents: number;
  category:
    | "PROGRESS_BILLING"
    | "VENDOR_BILL"
    | "PAYROLL"
    | "OVERHEAD";
  expectedDate: Date;
  status: "EXPECTED" | "RECEIVED";
}
export interface MappedCost {
  qboId: string;
  qboJobId?: string;
  category: CostCategory;
  amountCents: number;
  laborHours?: number;
  vendorName?: string;
  docType: "BILL" | "RECEIPT" | "PAYROLL" | "OTHER";
  incurredDate: Date;
}

export function mapCustomer(c: QboCustomer): MappedProject {
  return {
    qboJobId: c.Id,
    name: c.DisplayName,
    client: c.CompanyName ?? c.ParentRef?.name ?? c.DisplayName,
    isJob: Boolean(c.Job || c.ParentRef),
  };
}

/** Invoice -> inbound progress billing + contributes to billedToDate. */
export function mapInvoice(inv: QboInvoice): MappedCashEvent {
  return {
    qboId: `INV-${inv.Id}`,
    qboJobId: inv.CustomerRef?.value,
    direction: "IN",
    amountCents: cents(inv.TotalAmt),
    category: "PROGRESS_BILLING",
    expectedDate: new Date(inv.DueDate ?? inv.TxnDate),
    status: inv.Balance === 0 ? "RECEIVED" : "EXPECTED",
  };
}

function firstJobRef(lines?: QboExpenseLine[]): QboRef | undefined {
  for (const l of lines ?? []) {
    const r =
      l.AccountBasedExpenseLineDetail?.CustomerRef ??
      l.ItemBasedExpenseLineDetail?.CustomerRef;
    if (r) return r;
  }
  return undefined;
}
function firstAccountName(lines?: QboExpenseLine[]): string | undefined {
  for (const l of lines ?? []) {
    const n =
      l.AccountBasedExpenseLineDetail?.AccountRef?.name ??
      l.ItemBasedExpenseLineDetail?.ItemRef?.name;
    if (n) return n;
  }
  return undefined;
}

/** Bill/Purchase -> a job cost + an outbound cash obligation. */
export function mapBill(
  bill: QboBill,
  kind: "BILL" | "PURCHASE",
  overrides: CategoryOverride[] = []
): { cost: MappedCost; cash: MappedCashEvent } {
  const job = firstJobRef(bill.Line);
  const category = classifyCategory(firstAccountName(bill.Line), overrides);
  const incurred = new Date(bill.TxnDate);
  return {
    cost: {
      qboId: `${kind}-${bill.Id}`,
      qboJobId: job?.value,
      category,
      amountCents: cents(bill.TotalAmt),
      vendorName: bill.VendorRef?.name,
      docType: kind === "BILL" ? "BILL" : "RECEIPT",
      incurredDate: incurred,
    },
    cash: {
      qboId: `${kind}CASH-${bill.Id}`,
      qboJobId: job?.value,
      direction: "OUT",
      amountCents: cents(bill.TotalAmt),
      category: "VENDOR_BILL",
      expectedDate: new Date(bill.DueDate ?? bill.TxnDate),
      status: kind === "PURCHASE" ? "RECEIVED" : "EXPECTED",
    },
  };
}

/** TimeActivity -> labor cost with hours. */
export function mapTime(t: QboTimeActivity): MappedCost {
  const hours = (t.Hours ?? 0) + (t.Minutes ?? 0) / 60;
  const rate = t.HourlyRate ?? 0;
  return {
    qboId: `TIME-${t.Id}`,
    qboJobId: t.CustomerRef?.value,
    category: "LABOR",
    amountCents: cents(hours * rate),
    laborHours: Math.round(hours * 100) / 100,
    docType: "PAYROLL",
    incurredDate: new Date(t.TxnDate),
  };
}

/** An obligation that a synced bill can settle, matched by vendor substring. */
export interface ObligationMatcher {
  origin: "LIABILITY" | "OVERHEAD";
  id: string;
  frequency: Frequency;
  keyword: string;
}

/**
 * Does this bill settle a scheduled obligation?
 *
 * Returns the source key of the obligation-and-period so the projected payment
 * is superseded rather than counted a second time. Matching is a case-insensitive
 * substring on the vendor name — the same shape as the category-mapping
 * overrides, and the same thing an owner can reason about.
 */
export function matchObligation(
  vendorName: string | undefined,
  date: Date,
  matchers: ObligationMatcher[]
): string | null {
  if (!vendorName) return null;
  const v = vendorName.toLowerCase();
  for (const m of matchers) {
    if (m.keyword && v.includes(m.keyword.toLowerCase())) {
      return sourceKeyFor(m.origin, m.id, m.frequency, date);
    }
  }
  return null;
}
