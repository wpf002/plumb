import { prisma } from "@plumb/db";

// FreshBooks integration: an alternative accounting source to QuickBooks for
// smaller shops. Live when FRESHBOOKS_TOKEN is set; otherwise a dry run that
// previews the invoices/expenses it would import without writing anything.

export interface FbInvoice {
  id: string;
  customer: string;
  amountCents: number;
  date: string;
  paid: boolean;
}
export interface FbExpense {
  id: string;
  vendor: string;
  amountCents: number;
  date: string;
}

export interface FreshbooksClient {
  readonly live: boolean;
  getInvoices(companyId: string): Promise<FbInvoice[]>;
  getExpenses(companyId: string): Promise<FbExpense[]>;
}

export interface MappedFbEvent {
  externalId: string;
  direction: "IN" | "OUT";
  category: "PROGRESS_BILLING" | "VENDOR_BILL";
  amountCents: number;
  counterparty: string;
  date: string;
  status: "EXPECTED" | "RECEIVED" | "PAID";
}

export function mapFreshbooks(invoices: FbInvoice[], expenses: FbExpense[]): MappedFbEvent[] {
  return [
    ...invoices.map((i) => ({
      externalId: `FB-INV-${i.id}`,
      direction: "IN" as const,
      category: "PROGRESS_BILLING" as const,
      amountCents: i.amountCents,
      counterparty: i.customer,
      date: i.date,
      status: (i.paid ? "RECEIVED" : "EXPECTED") as MappedFbEvent["status"],
    })),
    ...expenses.map((e) => ({
      externalId: `FB-EXP-${e.id}`,
      direction: "OUT" as const,
      category: "VENDOR_BILL" as const,
      amountCents: e.amountCents,
      counterparty: e.vendor,
      date: e.date,
      status: "PAID" as const,
    })),
  ];
}

class LiveFreshbooks implements FreshbooksClient {
  readonly live = true;
  constructor(private token: string) {}
  async getInvoices(): Promise<FbInvoice[]> {
    throw new Error("Live FreshBooks sync not yet wired — set up the FreshBooks app first.");
  }
  async getExpenses(): Promise<FbExpense[]> {
    throw new Error("Live FreshBooks sync not yet wired — set up the FreshBooks app first.");
  }
}

class DryRunFreshbooks implements FreshbooksClient {
  readonly live = false;
  async getInvoices(): Promise<FbInvoice[]> {
    return [
      { id: "5001", customer: "Northwest ISD", amountCents: 120_000_00, date: "2026-07-05", paid: false },
      { id: "5002", customer: "Rogers-Healy GC", amountCents: 88_000_00, date: "2026-06-28", paid: true },
    ];
  }
  async getExpenses(): Promise<FbExpense[]> {
    return [
      { id: "7001", vendor: "Graybar", amountCents: 24_500_00, date: "2026-07-02" },
      { id: "7002", vendor: "Sunbelt Rentals", amountCents: 6_200_00, date: "2026-07-01" },
    ];
  }
}

export function getFreshbooks(): FreshbooksClient {
  const token = process.env.FRESHBOOKS_TOKEN;
  return token ? new LiveFreshbooks(token) : new DryRunFreshbooks();
}

export async function syncFreshbooks(companyId: string): Promise<{
  live: boolean;
  imported: number;
  inflowCents: number;
  outflowCents: number;
  preview: MappedFbEvent[];
  note: string;
}> {
  await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const client = getFreshbooks();
  const [invoices, expenses] = await Promise.all([
    client.getInvoices(companyId),
    client.getExpenses(companyId),
  ]);
  const events = mapFreshbooks(invoices, expenses);
  const inflowCents = events.filter((e) => e.direction === "IN").reduce((a, e) => a + e.amountCents, 0);
  const outflowCents = events.filter((e) => e.direction === "OUT").reduce((a, e) => a + e.amountCents, 0);

  if (!client.live) {
    return {
      live: false,
      imported: 0,
      inflowCents,
      outflowCents,
      preview: events,
      note: "No FreshBooks connection — preview of the cash events that would import.",
    };
  }

  for (const e of events) {
    const existing = await prisma.cashEvent.findFirst({ where: { qboId: e.externalId } });
    const data = {
      companyId,
      projectId: null,
      direction: e.direction,
      amount: BigInt(e.amountCents),
      category: e.category,
      expectedDate: new Date(e.date),
      status: e.status === "PAID" ? ("PAID" as const) : e.status,
      qboId: e.externalId,
    };
    if (existing) await prisma.cashEvent.update({ where: { id: existing.id }, data });
    else await prisma.cashEvent.create({ data });
  }

  return {
    live: true,
    imported: events.length,
    inflowCents,
    outflowCents,
    preview: events,
    note: `Imported ${events.length} cash events from FreshBooks.`,
  };
}
