import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { authorizeUrl, exchangeCode, syncCompany } from "@plumb/qbo";

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
}
