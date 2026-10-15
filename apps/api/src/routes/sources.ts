import type { FastifyInstance } from "fastify";
import { connectSource, disconnectSource, listSources, previewSource, recurringTransactions, sourceFor, syncSource } from "../integrations/sources/index.js";
import { requireFeature } from "../plan.js";
import { cents, date, toRecords } from "../import/csv.js";
import { applyBatch } from "../integrations/sources/apply.js";

type P = { Params: { companyId: string } };
type PK = { Params: { companyId: string; key: string } };

const fail = (reply: any, e: any) =>
  reply.code(e?.status ?? 422).send({ error: e?.status === 404 ? "Not Found" : e?.status === 409 ? "Conflict" : "Unprocessable", message: e instanceof Error ? e.message : String(e) });

export function registerSourceRoutes(app: FastifyInstance) {
  app.get<P>("/companies/:companyId/sources", async (req) => listSources(req.params.companyId));

  app.post<PK>("/companies/:companyId/sources/:key/preview", async (req, reply) => {
    try {
      return await previewSource(req.params.companyId, req.params.key);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Owner only (OWNER_ONLY in server.ts): sync writes to the books; connect stores credentials.
  app.post<PK>("/companies/:companyId/sources/:key/sync", async (req, reply) => {
    try {
      // Accounting, banking, payments, and payroll are in every plan; vertical systems are Pro.
      if (sourceFor(req.params.key).phase > 1) {
        const blocked = await requireFeature(req.params.companyId, "premiumIntegrations");
        if (blocked) return reply.code(403).send(blocked);
      }
      return await syncSource(req.params.companyId, req.params.key);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.put<PK & { Body: { credentials: Record<string, string> } }>(
    "/companies/:companyId/sources/:key/connection",
    {
      schema: {
        body: {
          type: "object",
          required: ["credentials"],
          additionalProperties: false,
          properties: { credentials: { type: "object", maxProperties: 8, additionalProperties: { type: "string", maxLength: 500 } } },
        },
      },
    },
    async (req, reply) => {
      try {
        return await connectSource(req.params.companyId, req.params.key, req.body.credentials);
      } catch (e) {
        return fail(reply, e);
      }
    }
  );

  app.delete<PK>("/companies/:companyId/sources/:key/connection", async (req) => disconnectSource(req.params.companyId, req.params.key));

  app.get<P>("/companies/:companyId/recurring-transactions", async (req) => recurringTransactions(req.params.companyId));

  // Manual transaction import: a bank or card CSV export, for accounts no feed covers.
  // Columns are matched by name: date, description (or memo/payee), and amount, or debit and credit.
  app.post<P & { Body: { csv: string; account?: string } }>(
    "/companies/:companyId/transactions/import",
    { bodyLimit: 10 * 1024 * 1024, schema: { body: { type: "object", required: ["csv"], additionalProperties: false, properties: { csv: { type: "string", minLength: 1 }, account: { type: "string", maxLength: 80 } } } } },
    async (req, reply) => {
      const { records } = toRecords(req.body.csv);
      const pick = (r: Record<string, string>, ...names: string[]) => {
        const k = Object.keys(r).find((h) => names.some((n) => h.toLowerCase().replace(/[^a-z]/g, "").includes(n)));
        return k ? r[k] : undefined;
      };
      const account = req.body.account?.trim() || "Manual import";
      const transactions = [];
      let skipped = 0;
      for (const [i, r] of records.entries()) {
        const d = date(pick(r, "date", "posted"));
        const amount = cents(pick(r, "amount")) ?? ((cents(pick(r, "credit", "deposit")) ?? 0) - (cents(pick(r, "debit", "withdrawal")) ?? 0));
        const description = pick(r, "description", "memo", "payee", "name") ?? "";
        if (!d || !amount) {
          skipped++;
          continue;
        }
        transactions.push({ externalId: `${d.toISOString().slice(0, 10)}:${amount}:${description}:${i}`, accountExternalId: account, date: d, amountCents: amount, description: description || "Transaction" });
      }
      if (!transactions.length) return reply.code(422).send({ error: "Unprocessable", message: "No rows with a date and amount." });
      // No account record: a CSV carries no balance, and a zero balance would overwrite opening cash.
      const counts = await applyBatch(req.params.companyId, "manual", { transactions: transactions.map((t) => ({ ...t, accountExternalId: null, category: account })) });
      return { imported: counts.transactions ?? 0, skipped };
    }
  );
}
