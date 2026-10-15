import type { AdapterContext, CanonicalBatch, SourceAdapter } from "./types.js";
import { cents, daysAgo, rng } from "./sample.js";

/**
 * Plaid: checking, savings, and card accounts with up to 24 months of
 * transactions (the link token requests 730 days). Live with a per-company
 * access token, or PLAID_ACCESS_TOKEN for a single-tenant install.
 */

const HOSTS: Record<string, string> = { sandbox: "https://sandbox.plaid.com", development: "https://development.plaid.com", production: "https://production.plaid.com" };

const creds = (ctx: AdapterContext) => ({
  clientId: process.env.PLAID_CLIENT_ID,
  secret: process.env.PLAID_SECRET,
  accessToken: ctx.credentials?.accessToken ?? process.env.PLAID_ACCESS_TOKEN,
  host: HOSTS[process.env.PLAID_ENV ?? "sandbox"] ?? HOSTS.sandbox,
});

async function call<T>(ctx: AdapterContext, path: string, body: Record<string, unknown>): Promise<T> {
  const c = creds(ctx);
  const res = await fetch(`${c.host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: c.clientId, secret: c.secret, access_token: c.accessToken, ...body }),
  });
  if (!res.ok) throw new Error(`Plaid ${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

const TYPE: Record<string, "checking" | "savings" | "credit" | "loan"> = { checking: "checking", savings: "savings", "credit card": "credit", mortgage: "loan", auto: "loan", "line of credit": "credit" };

interface PlaidAccount { account_id: string; name: string; mask: string | null; type: string; subtype: string | null; balances: { current: number | null; available: number | null } }
interface PlaidTxn { transaction_id: string; account_id: string; date: string; amount: number; name: string; merchant_name: string | null; pending: boolean; personal_finance_category?: { primary: string } | null }

export const plaid: SourceAdapter = {
  key: "plaid",
  name: "Bank Feed (Plaid)",
  category: "banking",
  phase: 1,
  env: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
  provides: ["accounts", "transactions"],
  credentialFields: [],
  live: (ctx) => {
    const c = creds(ctx);
    return !!(c.clientId && c.secret && c.accessToken);
  },
  async fetch(ctx) {
    const now = new Date();
    const bal = await call<{ accounts: PlaidAccount[] }>(ctx, "/accounts/balance/get", {});
    const accounts = bal.accounts.map((a) => ({
      externalId: a.account_id,
      name: a.name,
      type: a.type === "depository" ? (a.subtype === "savings" ? ("savings" as const) : ("checking" as const)) : TYPE[a.subtype ?? ""] ?? ("credit" as const),
      mask: a.mask,
      balanceCents: Math.round((a.balances.current ?? a.balances.available ?? 0) * 100) * (a.type === "credit" || a.type === "loan" ? -1 : 1),
      asOf: now,
    }));
    const transactions: NonNullable<CanonicalBatch["transactions"]> = [];
    let cursor: string | undefined = ctx.credentials?.cursor;
    for (let page = 0; page < 50; page++) {
      const r = await call<{ added: PlaidTxn[]; modified: PlaidTxn[]; has_more: boolean; next_cursor: string }>(ctx, "/transactions/sync", { cursor, count: 500 });
      for (const t of [...r.added, ...r.modified]) {
        transactions.push({
          externalId: t.transaction_id,
          accountExternalId: t.account_id,
          date: new Date(`${t.date}T00:00:00Z`),
          // Plaid reports outflows as positive amounts.
          amountCents: -Math.round(t.amount * 100),
          description: t.name,
          merchant: t.merchant_name,
          category: t.personal_finance_category?.primary ?? null,
          kind: t.personal_finance_category?.primary === "TRANSFER_IN" || t.personal_finance_category?.primary === "TRANSFER_OUT" ? "TRANSFER" : null,
          pending: t.pending,
        });
      }
      cursor = r.next_cursor;
      if (!r.has_more) break;
    }
    return { accounts, transactions };
  },
  sample(ctx) {
    const r = rng(`plaid:${ctx.companyId}`);
    const now = new Date();
    const tx: NonNullable<CanonicalBatch["transactions"]> = [];
    let n = 0;
    const add = (daysBack: number, dollars: number, description: string, category: string, account = "chk") =>
      tx.push({ externalId: `s${n++}`, accountExternalId: account, date: daysAgo(daysBack, now), amountCents: cents(dollars), description, category });
    for (let d = 180; d >= 0; d--) {
      const day = daysAgo(d, now);
      if (day.getUTCDate() === 1) add(d, -4_850, "ACH DEBIT RIVERSIDE PROPERTIES RENT", "RENT_AND_UTILITIES");
      if (day.getUTCDate() === 15) add(d, -1_912.4, "ALLY AUTO PMT", "LOAN_PAYMENTS");
      if (day.getUTCDate() === 5) add(d, -1_386, "NEXT INSURANCE PREMIUM", "GENERAL_SERVICES");
      if (day.getUTCDate() === 9) add(d, -349, "QUICKBOOKS ONLINE", "GENERAL_SERVICES", "card");
      if (d % 14 === 3) add(d, -(21_400 + Math.round(r() * 900)), "GUSTO PAYROLL", "GENERAL_SERVICES");
      if (d % 7 === 2) add(d, -(310 + Math.round(r() * 160)), "SHELL OIL", "TRANSPORTATION", "card");
      if (r() < 0.18) add(d, -(400 + Math.round(r() * 3_800)), "CITY ELECTRIC SUPPLY", "GENERAL_MERCHANDISE", "card");
      if (r() < 0.12) add(d, 8_000 + Math.round(r() * 42_000), "CUSTOMER DEPOSIT REMOTE", "INCOME");
    }
    return {
      accounts: [
        { externalId: "chk", name: "Business Checking", type: "checking", mask: "4402", balanceCents: cents(184_220), asOf: now },
        { externalId: "sav", name: "Reserve Savings", type: "savings", mask: "9917", balanceCents: cents(60_000), asOf: now },
        { externalId: "card", name: "Business Card", type: "credit", mask: "1006", balanceCents: cents(-7_640), asOf: now },
      ],
      transactions: tx,
    };
  },
};
