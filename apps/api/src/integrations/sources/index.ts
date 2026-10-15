import { prisma } from "@plumb/db";
import { detectRecurring } from "@plumb/engine";
import { applyBatch, summarizeBatch } from "./apply.js";
import { canStoreSecrets, seal, unseal } from "./secrets.js";
import type { AdapterContext, CanonicalBatch, SourceAdapter } from "./types.js";
import { gusto } from "./gusto.js";
import { plaid } from "./plaid.js";
import { quickbooks } from "./quickbooks.js";
import { stripe } from "./stripe.js";
import { PHASE2 } from "./vertical.js";

/** Every outside system DNRD reads from, in roadmap order. */
export const SOURCES: SourceAdapter[] = [quickbooks, plaid, stripe, gusto, ...PHASE2];

export function sourceFor(key: string) {
  const s = SOURCES.find((x) => x.key === key);
  if (!s) throw Object.assign(new Error(`Unknown source ${key}.`), { status: 404 });
  return s;
}

async function contextFor(companyId: string, key: string): Promise<AdapterContext> {
  const [conns, qbo] = await Promise.all([prisma.integrationConnection.findMany({ where: { companyId } }), prisma.qboConnection.findUnique({ where: { companyId } })]);
  const connected = new Set(conns.filter((c) => c.status === "CONNECTED").map((c) => c.source));
  if (qbo) connected.add("quickbooks");
  const mine = conns.find((c) => c.source === key);
  return { companyId, connected, credentials: unseal(mine?.credentials), since: mine?.lastSyncAt ?? undefined };
}

export async function listSources(companyId: string) {
  const [conns, logs] = await Promise.all([
    prisma.integrationConnection.findMany({ where: { companyId } }),
    prisma.syncLog.findMany({ where: { companyId }, orderBy: { startedAt: "desc" }, take: 100 }),
  ]);
  const out = [];
  for (const s of SOURCES) {
    const ctx = await contextFor(companyId, s.key);
    const conn = conns.find((c) => c.source === s.key);
    const last = logs.find((l) => l.provider === s.key);
    out.push({
      key: s.key,
      name: s.name,
      category: s.category,
      phase: s.phase,
      provides: s.provides,
      live: s.live(ctx),
      csvOnly: !!s.csvOnly,
      credentialFields: s.credentialFields,
      connected: !!conn || ctx.connected?.has(s.key) === true,
      env: s.env,
      lastSync: last ? { at: last.finishedAt ?? last.startedAt, status: last.status, counts: last.counts, error: last.error } : null,
      lastError: conn?.lastError ?? null,
    });
  }
  return { canStoreCredentials: canStoreSecrets(), sources: out };
}

const preview = (b: CanonicalBatch) =>
  Object.fromEntries(
    Object.entries(b)
      .filter(([, v]) => Array.isArray(v) && v.length)
      .map(([k, v]) => [k, (v as unknown[]).slice(0, 5)])
  );

/** What a sync would bring in. Live sources are read but nothing is written. */
export async function previewSource(companyId: string, key: string) {
  const s = sourceFor(key);
  const ctx = await contextFor(companyId, key);
  const live = s.live(ctx);
  const batch = live ? await s.fetch(ctx) : s.sample(ctx);
  return { source: key, live, counts: summarizeBatch(batch), preview: preview(batch) };
}

export async function syncSource(companyId: string, key: string) {
  const s = sourceFor(key);
  const ctx = await contextFor(companyId, key);
  if (!s.live(ctx)) throw Object.assign(new Error(`${s.name} isn't connected.`), { status: 409 });
  const log = await prisma.syncLog.create({ data: { companyId, provider: key, kind: ctx.since ? "INCREMENTAL" : "FULL", status: "RUNNING" } });
  try {
    const counts = await applyBatch(companyId, key, await s.fetch(ctx));
    await prisma.syncLog.update({ where: { id: log.id }, data: { status: "OK", counts, finishedAt: new Date() } });
    await prisma.integrationConnection.upsert({
      where: { companyId_source: { companyId, source: key } },
      create: { companyId, source: key, lastSyncAt: new Date() },
      update: { lastSyncAt: new Date(), lastError: null },
    });
    return { source: key, counts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.syncLog.update({ where: { id: log.id }, data: { status: "ERROR", error: msg.slice(0, 1000), finishedAt: new Date() } });
    await prisma.integrationConnection.updateMany({ where: { companyId, source: key }, data: { lastError: msg.slice(0, 500) } });
    throw e;
  }
}

export async function connectSource(companyId: string, key: string, credentials: Record<string, string>) {
  sourceFor(key);
  const sealed = seal(credentials);
  await prisma.integrationConnection.upsert({
    where: { companyId_source: { companyId, source: key } },
    create: { companyId, source: key, credentials: sealed, status: "CONNECTED" },
    update: { credentials: sealed, status: "CONNECTED", lastError: null },
  });
  return { source: key, connected: true };
}

export async function disconnectSource(companyId: string, key: string) {
  await prisma.integrationConnection.deleteMany({ where: { companyId, source: key } });
  return { source: key, connected: false };
}

/** Recurring charges and deposits found in the last 13 months of feeds. */
export async function recurringTransactions(companyId: string) {
  const since = new Date(Date.now() - 400 * 86_400_000);
  const txns = await prisma.bankTransaction.findMany({
    where: { companyId, date: { gte: since }, pending: false, OR: [{ kind: null }, { kind: { notIn: ["TRANSFER", "PAYOUT"] } }] },
    select: { date: true, amount: true, description: true, merchant: true },
  });
  const series = detectRecurring(txns.map((t) => ({ date: t.date, amountCents: Number(t.amount), description: t.description, merchant: t.merchant })));
  return {
    transactions: txns.length,
    series,
    monthlyOutCents: series.filter((s) => s.direction === "out").reduce((t, s) => t + s.monthlyEquivalentCents, 0),
    monthlyInCents: series.filter((s) => s.direction === "in").reduce((t, s) => t + s.monthlyEquivalentCents, 0),
  };
}
