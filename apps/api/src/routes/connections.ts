import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { authorizeUrl } from "@plumb/qbo";
import { n } from "../map.js";

const has = (k: string) => Boolean(process.env[k]);

// Connection status for every data source, with the next action. The QBO OAuth
// flow and the Plaid bank feed are fully wired; each source is "configured" once
// its credentials are present and otherwise runs in demo/preview mode.
export function registerConnectionRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/connections",
    async (req) => {
      const companyId = req.params.companyId;
      const [qbo, lastSync, snap] = await Promise.all([
        prisma.qboConnection.findUnique({ where: { companyId } }),
        prisma.syncLog.findFirst({ where: { companyId }, orderBy: { startedAt: "desc" } }),
        prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: { asOf: "desc" } }),
      ]);
      const bankConnected = snap?.source === "PLAID" || snap?.source === "PLAID_SANDBOX";
      const qboConfigured = has("QBO_CLIENT_ID") && has("QBO_CLIENT_SECRET") && has("QBO_REDIRECT_URI");

      return {
        connections: [
          {
            key: "qbo",
            name: "QuickBooks Online",
            status: qbo ? "connected" : qboConfigured ? "available" : "not_configured",
            detail: qbo
              ? `Realm ${qbo.realmId} · ${qbo.environment}`
              : qboConfigured
                ? "Ready to connect"
                : "Set QBO_CLIENT_ID + QBO_CLIENT_SECRET to enable",
            action: qbo ? "sync" : qboConfigured ? "connect" : "none",
            connectUrl: !qbo && qboConfigured ? authorizeUrl(companyId) : null,
            lastSync: lastSync
              ? { status: lastSync.status, at: lastSync.finishedAt ?? lastSync.startedAt, counts: lastSync.counts }
              : null,
          },
          {
            key: "bank",
            name: "Bank feed (Plaid)",
            status: bankConnected ? "connected" : has("PLAID_CLIENT_ID") ? "available" : "demo",
            detail: bankConnected
              ? `Opening cash ${snap && "$" + (n(snap.balance) / 100).toLocaleString()} · ${snap?.source === "PLAID" ? "Plaid" : "demo"}`
              : "Connect in Settings → Opening cash",
            action: "settings",
          },
          {
            key: "freshbooks",
            name: "FreshBooks",
            status: has("FRESHBOOKS_TOKEN") ? "configured" : "demo",
            detail: has("FRESHBOOKS_TOKEN") ? "Live sync enabled" : "Preview only — set FRESHBOOKS_TOKEN",
            action: "integrations",
          },
          {
            key: "tax",
            name: "Tax export",
            status: has("TAX_PROVIDER") ? "configured" : "demo",
            detail: has("TAX_PROVIDER") ? "Applies to the forecast" : "Preview only — set TAX_PROVIDER",
            action: "integrations",
          },
        ],
      };
    }
  );
}
