import { prisma } from "@plumb/db";
import { QboClient } from "./client.js";
import type { QboTokens } from "./oauth.js";
import {
  mapBill,
  mapCustomer,
  mapInvoice,
  mapTime,
  matchObligation,
  type ObligationMatcher,
  type QboBill,
  type QboCustomer,
  type QboInvoice,
  type QboPurchase,
  type QboTimeActivity,
} from "./mappers.js";

/** Pull recent QBO data into Plumb for one company. Idempotent by qboId. */
export async function syncCompany(
  companyId: string,
  opts: { since?: Date; full?: boolean } = {}
): Promise<{ invoices: number; bills: number; purchases: number; time: number; jobs: number }> {
  const conn = await prisma.qboConnection.findUniqueOrThrow({
    where: { companyId },
  });

  const client = new QboClient({
    realmId: conn.realmId,
    environment: conn.environment as "production" | "sandbox",
    tokens: {
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      expiresAt: conn.expiresAt,
    },
    onTokenRefresh: async (t: QboTokens) => {
      await prisma.qboConnection.update({
        where: { companyId },
        data: {
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
          expiresAt: t.expiresAt,
        },
      });
    },
  });

  const log = await prisma.syncLog.create({
    data: { companyId, kind: opts.full ? "FULL" : "INCREMENTAL", status: "OK" },
  });

  const where = opts.since
    ? `WHERE MetaData.LastUpdatedTime > '${opts.since.toISOString()}'`
    : "";

  // Per-company category overrides correct the built-in account-name rules.
  const overrides = (
    await prisma.categoryMapping.findMany({ where: { companyId } })
  ).map((m) => ({ keyword: m.keyword, category: m.category }));

  try {
    const [customers, invoices, bills, purchases, times] = await Promise.all([
      client.query<QboCustomer>("Customer", where),
      client.query<QboInvoice>("Invoice", where),
      client.query<QboBill>("Bill", where),
      client.query<QboPurchase>("Purchase", where),
      client.query<QboTimeActivity>("TimeActivity", where),
    ]);

    // 1. Jobs -> projects. Resolve a qboJobId -> projectId map.
    const jobToProject = new Map<string, string>();
    for (const c of customers) {
      const mp = mapCustomer(c);
      if (!mp.isJob) continue;
      const existing = await prisma.project.findFirst({
        where: { companyId, qboJobId: mp.qboJobId },
      });
      const project = existing
        ? await prisma.project.update({
            where: { id: existing.id },
            data: { name: mp.name, client: mp.client },
          })
        : await prisma.project.create({
            data: {
              companyId,
              name: mp.name,
              client: mp.client,
              clientType: "GC",
              status: "ACTIVE",
              contractValue: BigInt(0),
              originalBidCost: BigInt(0),
              targetMarginPct: 0,
              startDate: new Date(),
              endDate: new Date(),
              qboJobId: mp.qboJobId,
            },
          });
      jobToProject.set(mp.qboJobId, project.id);
    }

    const resolveProject = (jobId?: string) =>
      jobId ? jobToProject.get(jobId) ?? null : null;

    // 2. Invoices -> inbound cash + billedToDate rollup.
    const billedByProject = new Map<string, bigint>();
    for (const inv of invoices) {
      const m = mapInvoice(inv);
      const projectId = resolveProject(m.qboJobId);
      await upsertCash(companyId, projectId, m);
      if (projectId)
        billedByProject.set(
          projectId,
          (billedByProject.get(projectId) ?? BigInt(0)) + BigInt(m.amountCents)
        );
    }
    for (const [projectId, billed] of billedByProject) {
      await prisma.project.update({
        where: { id: projectId },
        data: { billedToDate: billed },
      });
    }

    // 3. Bills + Purchases -> job cost + outbound cash.
    // Obligations that named a vendor keyword can be settled by a synced bill;
    // stamping the source key is what stops a real payment from landing on top
    // of its own projection in the forecast.
    const matchers = await loadObligationMatchers(companyId);
    for (const b of bills)
      await upsertBill(companyId, resolveProject, b, "BILL", overrides, matchers);
    for (const p of purchases)
      await upsertBill(companyId, resolveProject, p, "PURCHASE", overrides, matchers);

    // 4. Time -> labor cost.
    for (const t of times) {
      const m = mapTime(t);
      const projectId = resolveProject(m.qboJobId);
      if (!projectId) continue;
      await upsertCost(projectId, m);
    }

    const counts = {
      invoices: invoices.length,
      bills: bills.length,
      purchases: purchases.length,
      time: times.length,
      jobs: jobToProject.size,
    };
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "OK", finishedAt: new Date(), counts },
    });
    return counts;
  } catch (err) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

async function loadObligationMatchers(companyId: string): Promise<ObligationMatcher[]> {
  const [liabilities, expenses] = await Promise.all([
    prisma.liability.findMany({
      where: { companyId, active: true, matchKeyword: { not: null } },
      select: { id: true, paymentFrequency: true, matchKeyword: true },
    }),
    prisma.recurringExpense.findMany({
      where: { companyId, active: true, matchKeyword: { not: null } },
      select: { id: true, frequency: true, matchKeyword: true },
    }),
  ]);
  return [
    ...liabilities.map((l) => ({
      origin: "LIABILITY" as const,
      id: l.id,
      frequency: l.paymentFrequency,
      keyword: l.matchKeyword!,
    })),
    ...expenses.map((e) => ({
      origin: "OVERHEAD" as const,
      id: e.id,
      frequency: e.frequency,
      keyword: e.matchKeyword!,
    })),
  ];
}

async function upsertCash(
  companyId: string,
  projectId: string | null,
  m: ReturnType<typeof mapInvoice>,
  sourceKey: string | null = null
) {
  const existing = await prisma.cashEvent.findFirst({ where: { qboId: m.qboId } });
  const data = {
    companyId,
    projectId,
    direction: m.direction,
    amount: BigInt(m.amountCents),
    category: m.category,
    expectedDate: m.expectedDate,
    status: m.status,
    qboId: m.qboId,
    ...(sourceKey ? { sourceKey } : {}),
  };
  if (existing)
    await prisma.cashEvent.update({ where: { id: existing.id }, data });
  else await prisma.cashEvent.create({ data });
}

async function upsertCost(
  projectId: string,
  m: ReturnType<typeof mapTime>
) {
  const existing = await prisma.costEntry.findFirst({ where: { qboId: m.qboId } });
  const data = {
    projectId,
    category: m.category,
    amount: BigInt(m.amountCents),
    laborHours: m.laborHours ?? null,
    vendorName: m.vendorName ?? null,
    docType: m.docType,
    incurredDate: m.incurredDate,
    source: "QBO" as const,
    qboId: m.qboId,
  };
  if (existing)
    await prisma.costEntry.update({ where: { id: existing.id }, data });
  else await prisma.costEntry.create({ data });
}

async function upsertBill(
  companyId: string,
  resolveProject: (jobId?: string) => string | null,
  bill: QboBill,
  kind: "BILL" | "PURCHASE",
  overrides: Parameters<typeof mapBill>[2] = [],
  matchers: ObligationMatcher[] = []
) {
  const { cost, cash } = mapBill(bill, kind, overrides);
  const projectId = resolveProject(cost.qboJobId);
  if (projectId) await upsertCost(projectId, cost);
  const sourceKey = matchObligation(cost.vendorName, cash.expectedDate, matchers);
  await upsertCash(companyId, projectId, cash, sourceKey);
}
