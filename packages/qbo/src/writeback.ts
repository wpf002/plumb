import { prisma } from "@plumb/db";
import { addDays, milestoneSourceKey } from "@plumb/shared";
import { QboClient } from "./client.js";
import type { QboTokens } from "./oauth.js";

export interface InvoiceRequest {
  projectId: string;
  /** Omitted when billing a milestone — its amount is used. */
  amountCents?: number;
  memo?: string;
  /** Bill a specific contract milestone rather than a free-text amount. */
  milestoneId?: string;
}

export interface InvoiceResult {
  live: boolean;
  qboInvoiceId: string | null;
  /** The exact document that was (or would be) sent to QuickBooks. */
  payload: unknown;
  /** Set only on a live create: the recorded inbound cash event. */
  cashEventId: string | null;
  newBilledToDateCents: number | null;
  /** Set when the invoice billed a milestone. */
  milestoneId: string | null;
  /** Cash actually expected from this invoice, after retainage is withheld. */
  netOfRetainageCents: number | null;
  note: string;
}

// QBO invoice shape. Amounts are dollars (QBO's unit). Line item references a
// QBO service item; "1" is the default sandbox Services item — a real setup maps
// this per company. The customer is the QBO job the project was synced from.
function buildInvoicePayload(qboJobId: string, amountCents: number, memo?: string) {
  return {
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: amountCents / 100,
        Description: memo ?? "Progress billing",
        SalesItemLineDetail: { ItemRef: { value: "1" } },
      },
    ],
    CustomerRef: { value: qboJobId },
    ...(memo ? { PrivateNote: memo } : {}),
  };
}

/**
 * Write an invoice back to QuickBooks. Without a QBO connection this is a
 * non-mutating dry run: it returns the exact payload that would be sent and
 * changes nothing. With a live connection it creates the invoice in QBO, records
 * the inbound progress-billing cash event, and rolls the project's billed-to-date
 * forward — closing the two-way sync loop.
 */
export async function createInvoice(
  companyId: string,
  req: InvoiceRequest,
  asOf: Date = new Date()
): Promise<InvoiceResult> {
  const project = await prisma.project.findFirstOrThrow({
    where: { id: req.projectId, companyId },
  });

  // Billing a milestone bills the contract's own schedule: its amount and name,
  // with retainage withheld from what actually lands in the bank.
  const milestone = req.milestoneId
    ? await prisma.milestone.findFirstOrThrow({
        where: { id: req.milestoneId, projectId: project.id },
      })
    : null;

  const grossCents = milestone ? Number(milestone.amount) : req.amountCents ?? 0;
  const retainageCents = milestone
    ? Math.round((grossCents * milestone.retainagePct) / 100)
    : 0;
  const netCents = grossCents - retainageCents;
  const memo = req.memo ?? milestone?.name;

  const conn = await prisma.qboConnection.findUnique({ where: { companyId } });
  const payload = buildInvoicePayload(project.qboJobId ?? "", grossCents, memo);

  // Dry run: no connection, or the project was never synced from a QBO job.
  if (!conn || !project.qboJobId) {
    return {
      live: false,
      qboInvoiceId: null,
      payload,
      cashEventId: null,
      newBilledToDateCents: null,
      milestoneId: milestone?.id ?? null,
      netOfRetainageCents: milestone ? netCents : null,
      note: !conn
        ? "No QuickBooks connection — this is the invoice that would be created."
        : "Project has no linked QBO job — connect and sync first.",
    };
  }

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

  const { id } = await client.createInvoice(payload);

  // The ledger event carries the milestone's source key, which supersedes its
  // projection instead of stacking a second inbound on top of it. The retainage
  // slice keeps its own key and stays projected until release.
  const cash = await prisma.cashEvent.create({
    data: {
      companyId,
      projectId: project.id,
      direction: "IN",
      amount: BigInt(milestone ? netCents : grossCents),
      category: "PROGRESS_BILLING",
      expectedDate: addDays(asOf, project.netDays),
      status: "EXPECTED",
      qboId: id ? `INV-${id}` : null,
      ...(milestone ? { sourceKey: milestoneSourceKey(milestone.id) } : {}),
    },
  });

  if (milestone) {
    await prisma.milestone.update({
      where: { id: milestone.id },
      data: { status: "BILLED", billedAt: asOf, qboInvoiceId: id ?? null },
    });
  }

  const newBilled = project.billedToDate + BigInt(grossCents);
  await prisma.project.update({
    where: { id: project.id },
    data: { billedToDate: newBilled },
  });

  return {
    live: true,
    qboInvoiceId: id,
    payload,
    cashEventId: cash.id,
    newBilledToDateCents: Number(newBilled),
    milestoneId: milestone?.id ?? null,
    netOfRetainageCents: milestone ? netCents : null,
    note: milestone
      ? `Invoice ${id} created in QuickBooks for "${milestone.name}". ${
          retainageCents > 0 ? `${(retainageCents / 100).toFixed(0)} held as retainage.` : ""
        }`.trim()
      : `Invoice ${id} created in QuickBooks; billed-to-date updated.`,
  };
}
