import type { FastifyInstance } from "fastify";
import { connectSource, disconnectSource, listSources, previewSource, recurringTransactions, syncSource } from "../integrations/sources/index.js";

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
}
