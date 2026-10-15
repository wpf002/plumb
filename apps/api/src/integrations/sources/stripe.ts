import type { AdapterContext, CanonicalBatch, SourceAdapter } from "./types.js";
import { cents, daysAgo, rng } from "./sample.js";

/**
 * Stripe, ingest only: the company's own card payments, refunds, fees, and
 * payouts, read with a restricted read-only key. This reads the customer's
 * Stripe account; it has nothing to do with billing for DNRD.
 */

const key = (ctx: AdapterContext) => ctx.credentials?.apiKey ?? process.env.STRIPE_READ_KEY;

interface BalanceTxn { id: string; amount: number; fee: number; type: string; created: number; description: string | null; reporting_category: string }

async function get<T>(ctx: AdapterContext, path: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com${path}`, { headers: { Authorization: `Bearer ${key(ctx)}` } });
  if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

const KIND: Record<string, "CHARGE" | "REFUND" | "PAYOUT" | "FEE"> = { charge: "CHARGE", payment: "CHARGE", refund: "REFUND", payment_refund: "REFUND", payout: "PAYOUT", stripe_fee: "FEE" };

export const stripe: SourceAdapter = {
  key: "stripe",
  name: "Stripe",
  category: "payments",
  phase: 1,
  env: ["STRIPE_READ_KEY"],
  provides: ["accounts", "transactions"],
  credentialFields: ["apiKey"],
  live: (ctx) => !!key(ctx),
  async fetch(ctx) {
    const since = Math.floor((ctx.since ?? daysAgo(730)).getTime() / 1000);
    const transactions: NonNullable<CanonicalBatch["transactions"]> = [];
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const r = await get<{ data: BalanceTxn[]; has_more: boolean }>(ctx, `/v1/balance_transactions?limit=100&created[gte]=${since}${after ? `&starting_after=${after}` : ""}`);
      for (const t of r.data) {
        const date = new Date(t.created * 1000);
        transactions.push({ externalId: t.id, accountExternalId: "stripe", date, amountCents: t.amount, description: t.description ?? t.type, kind: KIND[t.type] ?? null, category: t.reporting_category });
        if (t.fee) transactions.push({ externalId: `${t.id}:fee`, accountExternalId: "stripe", date, amountCents: -t.fee, description: "Stripe fee", kind: "FEE" });
      }
      if (!r.has_more || !r.data.length) break;
      after = r.data.at(-1)!.id;
    }
    const bal = await get<{ available: { amount: number }[]; pending: { amount: number }[] }>(ctx, "/v1/balance");
    const balance = [...bal.available, ...bal.pending].reduce((s, b) => s + b.amount, 0);
    return { accounts: [{ externalId: "stripe", name: "Stripe Balance", type: "processor", balanceCents: balance, asOf: new Date() }], transactions };
  },
  sample(ctx) {
    const r = rng(`stripe:${ctx.companyId}`);
    const tx: NonNullable<CanonicalBatch["transactions"]> = [];
    let n = 0;
    for (let d = 60; d >= 0; d--) {
      if (r() < 0.35) {
        const gross = cents(180 + r() * 1_600);
        tx.push({ externalId: `ch${n}`, accountExternalId: "stripe", date: daysAgo(d), amountCents: gross, description: "Service call payment", kind: "CHARGE" });
        tx.push({ externalId: `ch${n++}:fee`, accountExternalId: "stripe", date: daysAgo(d), amountCents: -Math.round(gross * 0.029 + 30), description: "Stripe fee", kind: "FEE" });
      }
      if (d % 7 === 0) tx.push({ externalId: `po${n++}`, accountExternalId: "stripe", date: daysAgo(d), amountCents: -cents(2_400 + r() * 1_800), description: "Payout to bank", kind: "PAYOUT" });
    }
    return { accounts: [{ externalId: "stripe", name: "Stripe Balance", type: "processor", balanceCents: cents(3_180), asOf: new Date() }], transactions: tx };
  },
};
