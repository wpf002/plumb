import { prisma } from "@plumb/db";
import { QboClient, type QboTokens } from "@plumb/qbo";
import type { AdapterContext, CanonicalBatch, SourceAdapter } from "./types.js";
import { cents, daysAgo, rng } from "./sample.js";

/**
 * QuickBooks Online, read-oriented: customers, vendors, invoices, payments,
 * bills, and bank account balances. Runs alongside the existing job, cost,
 * and time sync (packages/qbo) through the same OAuth connection.
 */

interface QRef { value: string; name?: string }
interface QInvoice { Id: string; CustomerRef: QRef; TxnDate: string; DueDate?: string; TotalAmt: number; Balance: number }
interface QBill { Id: string; VendorRef: QRef; TxnDate: string; DueDate?: string; TotalAmt: number; Balance: number }
interface QPayment { Id: string; TxnDate: string; Line?: { Amount: number; LinkedTxn?: { TxnId: string; TxnType: string }[] }[] }
interface QAccount { Id: string; Name: string; AccountType: string; CurrentBalance: number; AcctNum?: string }

async function client(companyId: string) {
  const conn = await prisma.qboConnection.findUniqueOrThrow({ where: { companyId } });
  return new QboClient({
    realmId: conn.realmId,
    environment: conn.environment as "production" | "sandbox",
    tokens: { accessToken: conn.accessToken, refreshToken: conn.refreshToken, expiresAt: conn.expiresAt },
    onTokenRefresh: async (t: QboTokens) => {
      await prisma.qboConnection.update({ where: { companyId }, data: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt } });
    },
  });
}

const day = (s?: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

export const quickbooks: SourceAdapter = {
  key: "quickbooks",
  name: "QuickBooks Online",
  category: "accounting",
  phase: 1,
  env: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET"],
  provides: ["customers", "vendors", "invoices", "payments", "bills", "accounts"],
  credentialFields: [],
  live: (ctx) => !!ctx.connected?.has("quickbooks"),
  async fetch(ctx) {
    const q = await client(ctx.companyId);
    const where = ctx.since ? `WHERE MetaData.LastUpdatedTime > '${ctx.since.toISOString()}'` : "";
    const [customers, vendors, invoices, bills, payments, accounts] = await Promise.all([
      q.query<{ Id: string; DisplayName: string }>("Customer", where),
      q.query<{ Id: string; DisplayName: string }>("Vendor", where),
      q.query<QInvoice>("Invoice", where),
      q.query<QBill>("Bill", where),
      q.query<QPayment>("Payment", where),
      q.query<QAccount>("Account", "WHERE AccountType IN ('Bank', 'Credit Card')"),
    ]);
    const paidOn = new Map<string, Date>();
    const pays: NonNullable<CanonicalBatch["payments"]> = [];
    for (const p of payments) {
      for (const line of p.Line ?? []) {
        for (const l of line.LinkedTxn ?? []) {
          if (l.TxnType !== "Invoice") continue;
          pays.push({ invoiceExternalId: l.TxnId, date: day(p.TxnDate)!, amountCents: Math.round(line.Amount * 100) });
          paidOn.set(l.TxnId, day(p.TxnDate)!);
        }
      }
    }
    return {
      customers: customers.map((c) => ({ externalId: c.Id, name: c.DisplayName })),
      vendors: vendors.map((v) => ({ externalId: v.Id, name: v.DisplayName })),
      invoices: invoices.map((i) => ({ externalId: i.Id, customerExternalId: i.CustomerRef.value, customerName: i.CustomerRef.name ?? null, issueDate: day(i.TxnDate)!, dueDate: day(i.DueDate), amountCents: Math.round(i.TotalAmt * 100), paidDate: i.Balance === 0 ? paidOn.get(i.Id) ?? day(i.TxnDate) : null })),
      payments: pays,
      bills: bills.map((b) => ({ externalId: b.Id, vendorExternalId: b.VendorRef.value, vendorName: b.VendorRef.name ?? null, billDate: day(b.TxnDate)!, dueDate: day(b.DueDate), amountCents: Math.round(b.TotalAmt * 100), paidDate: b.Balance === 0 ? day(b.DueDate) ?? day(b.TxnDate) : null })),
      accounts: accounts.map((a) => ({ externalId: a.Id, name: a.Name, type: a.AccountType === "Bank" ? ("checking" as const) : ("credit" as const), mask: a.AcctNum?.slice(-4) ?? null, balanceCents: Math.round(a.CurrentBalance * 100) * (a.AccountType === "Bank" ? 1 : -1), asOf: new Date() })),
    };
  },
  sample(ctx) {
    const r = rng(`qbo:${ctx.companyId}`);
    const names = ["Rogers-Healy GC", "Northwest ISD", "Greenview Medical", "Cedar Ridge HOA", "Lakeside Church"];
    const invoices = Array.from({ length: 12 }, (_, i) => {
      const issued = daysAgo(10 + i * 9);
      const paid = i > 3 && r() > 0.3;
      return { externalId: `inv${i}`, customerExternalId: `c${i % 5}`, customerName: names[i % 5], issueDate: issued, dueDate: daysAgo(10 + i * 9 - 30), amountCents: cents(4_000 + r() * 46_000), paidDate: paid ? daysAgo(i * 9 - 25) : null };
    });
    return {
      customers: names.map((name, i) => ({ externalId: `c${i}`, name })),
      vendors: ["City Electric Supply", "Graybar", "United Rentals"].map((name, i) => ({ externalId: `v${i}`, name })),
      invoices,
      bills: Array.from({ length: 8 }, (_, i) => ({ externalId: `bill${i}`, vendorExternalId: `v${i % 3}`, vendorName: null, billDate: daysAgo(5 + i * 11), dueDate: daysAgo(5 + i * 11 - 30), amountCents: cents(800 + r() * 9_000), paidDate: i > 2 ? daysAgo(i * 11 - 20) : null })),
      accounts: [{ externalId: "35", name: "Operating Checking", type: "checking", mask: "4402", balanceCents: cents(184_220), asOf: new Date() }],
    };
  },
};
