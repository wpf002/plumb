import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { planSummary } from "../plan.js";

export function registerPlanRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>("/companies/:companyId/plan", async (req) => planSummary(req.params.companyId));

  // Owner only (OWNER_ONLY). Switches feature flags; no payment is taken.
  app.put<{ Params: { companyId: string }; Body: { plan: "ESSENTIALS" | "PRO" | "BUSINESS" } }>(
    "/companies/:companyId/plan",
    { schema: { body: { type: "object", required: ["plan"], additionalProperties: false, properties: { plan: { type: "string", enum: ["ESSENTIALS", "PRO", "BUSINESS"] } } } } },
    async (req) => {
      await prisma.company.update({ where: { id: req.params.companyId }, data: { plan: req.body.plan } });
      return planSummary(req.params.companyId);
    }
  );
}
