import { prisma } from "@plumb/db";
import { QboClient } from "./client.js";
import type { QboTokens } from "./oauth.js";
import {
  mapBill,
  mapCustomer,
  mapInvoice,
  mapTime,
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
    for (const b of bills) await upsertBill(companyId, resolveProject, b, "BILL");
    for (const p of purchases)
      await upsertBill(companyId, resolveProject, p, "PURCHASE");

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

async function upsertCash(
  companyId: string,
  projectId: string | null,
  m: ReturnType<typeof mapInvoice>
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
  kind: "BILL" | "PURCHASE"
) {
  const { cost, cash } = mapBill(bill, kind);
  const projectId = resolveProject(cost.qboJobId);
  if (projectId) await upsertCost(projectId, cost);
  await upsertCash(companyId, projectId, cash);
}
