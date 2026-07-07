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

const CATEGORIES = ["LABOR", "MATERIAL", "EQUIPMENT", "TRAVEL", "SUBCONTRACT", "OTHER"] as const;

const mappingsBodySchema = {
  type: "object",
  required: ["mappings"],
  additionalProperties: false,
  properties: {
    mappings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        required: ["keyword", "category"],
        additionalProperties: false,
        properties: {
          keyword: { type: "string", minLength: 1, maxLength: 100 },
          category: { type: "string", enum: CATEGORIES },
        },
      },
    },
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

  // Per-company account/item -> category overrides used by the QBO sync.
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/category-mappings",
    async (req) => {
      const mappings = await prisma.categoryMapping.findMany({
        where: { companyId: req.params.companyId },
        orderBy: { keyword: "asc" },
        select: { keyword: true, category: true },
      });
      return { mappings };
    }
  );

  app.put<{
    Params: { companyId: string };
    Body: { mappings: { keyword: string; category: string }[] };
  }>(
    "/companies/:companyId/category-mappings",
    { schema: { body: mappingsBodySchema } },
    async (req) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      await prisma.$transaction([
        prisma.categoryMapping.deleteMany({ where: { companyId: req.params.companyId } }),
        prisma.categoryMapping.createMany({
          data: req.body.mappings.map((m) => ({
            companyId: req.params.companyId,
            keyword: m.keyword,
            category: m.category as (typeof CATEGORIES)[number],
          })),
        }),
      ]);
      return { ok: true, count: req.body.mappings.length };
    }
  );
}
