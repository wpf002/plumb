import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { authorizeUrl, exchangeCode, syncCompany, createInvoice } from "@plumb/qbo";

const invoiceBodySchema = {
  type: "object",
  required: ["projectId", "amountCents"],
  additionalProperties: false,
  properties: {
    projectId: { type: "string", minLength: 1 },
    amountCents: { type: "integer", minimum: 1 },
    memo: { type: "string", maxLength: 500 },
  },
} as const;

export function registerQboRoutes(app: FastifyInstance) {
  // Step 1: owner clicks this to grant access. state carries the companyId.
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/qbo/connect",
    async (req) => {
      const url = authorizeUrl(req.params.companyId);
      return { authorizeUrl: url };
    }
  );

  // Step 2: Intuit redirects here with ?code=&realmId=&state=companyId
  app.get<{ Querystring: { code: string; realmId: string; state: string } }>(
    "/qbo/callback",
    async (req) => {
      const { code, realmId, state: companyId } = req.query;
      const tokens = await exchangeCode(code);
      await prisma.qboConnection.upsert({
        where: { companyId },
        update: {
          realmId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        },
        create: {
          companyId,
          realmId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        },
      });
      const counts = await syncCompany(companyId, { full: true });
      return { connected: true, realmId, firstSync: counts };
    }
  );

  // Manual re-sync (also run on a schedule in production).
  app.post<{
    Params: { companyId: string };
    Body: { since?: string; full?: boolean };
  }>("/companies/:companyId/qbo/sync", async (req) => {
    const since = req.body?.since ? new Date(req.body.since) : undefined;
    return syncCompany(req.params.companyId, { since, full: req.body?.full });
  });

  // Write-back: create an invoice in QuickBooks (closes the two-way loop).
  // Dry-run and non-mutating when no QBO connection exists.
  app.post<{
    Params: { companyId: string };
    Body: { projectId: string; amountCents: number; memo?: string };
  }>(
    "/companies/:companyId/qbo/invoice",
    { schema: { body: invoiceBodySchema } },
    async (req) => createInvoice(req.params.companyId, req.body)
  );
}
