import { prisma } from "@plumb/db";
import { addDays } from "@plumb/shared";
import { QboClient } from "./client.js";
import type { QboTokens } from "./oauth.js";

export interface InvoiceRequest {
  projectId: string;
  amountCents: number;
  memo?: string;
}

export interface InvoiceResult {
  live: boolean;
  qboInvoiceId: string | null;
  /** The exact document that was (or would be) sent to QuickBooks. */
  payload: unknown;
  /** Set only on a live create: the recorded inbound cash event. */
  cashEventId: string | null;
  newBilledToDateCents: number | null;
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
  const conn = await prisma.qboConnection.findUnique({ where: { companyId } });
  const payload = buildInvoicePayload(project.qboJobId ?? "", req.amountCents, req.memo);

  // Dry run: no connection, or the project was never synced from a QBO job.
  if (!conn || !project.qboJobId) {
    return {
      live: false,
      qboInvoiceId: null,
      payload,
      cashEventId: null,
      newBilledToDateCents: null,
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

  const cash = await prisma.cashEvent.create({
    data: {
      companyId,
      projectId: project.id,
      direction: "IN",
      amount: BigInt(req.amountCents),
      category: "PROGRESS_BILLING",
      expectedDate: addDays(asOf, project.netDays),
      status: "EXPECTED",
      qboId: id ? `INV-${id}` : null,
    },
  });

  const newBilled = project.billedToDate + BigInt(req.amountCents);
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
    note: `Invoice ${id} created in QuickBooks; billed-to-date updated.`,
  };
}
