import type { FastifyInstance } from "fastify";
import { buildBrief } from "../brief.js";
import { askDenny, EXAMPLE_QUESTIONS } from "../denny.js";
import { SCOPES_BY_ROLE } from "../tools/index.js";
import { meterDenny } from "../plan.js";
import type { AuthedRequest } from "./tools.js";

type P = { Params: { companyId: string } };

export function registerDennyRoutes(app: FastifyInstance) {
  app.get<P & { Querystring: { period?: "week" | "month" } }>(
    "/companies/:companyId/brief",
    { schema: { querystring: { type: "object", properties: { period: { type: "string", enum: ["week", "month"] } } } } },
    async (req) => buildBrief(req.params.companyId, req.query.period ?? "week")
  );

  app.get<P>("/companies/:companyId/denny/examples", async () => ({ questions: EXAMPLE_QUESTIONS, live: !!process.env.ANTHROPIC_API_KEY }));

  app.post<P & { Body: { question: string } }>(
    "/companies/:companyId/denny",
    { schema: { body: { type: "object", required: ["question"], additionalProperties: false, properties: { question: { type: "string", minLength: 2, maxLength: 500 } } } } },
    async (req, reply) => {
      const over = await meterDenny(req.params.companyId);
      if (over) return reply.code(403).send(over);
      const r = req as AuthedRequest;
      return askDenny(req.params.companyId, req.body.question, SCOPES_BY_ROLE[r.memberRole ?? "MEMBER"] ?? ["read"], { caller: "denny", userId: r.userId });
    }
  );
}
