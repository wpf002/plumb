import type { FastifyInstance } from "fastify";
import { importPayroll } from "../integrations/payroll.js";
import { syncFreshbooks } from "../integrations/freshbooks.js";
import { projectTax } from "../integrations/tax.js";

const taxQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: { rate: { type: "number", minimum: 0, maximum: 100 } },
} as const;

export function registerIntegrationRoutes(app: FastifyInstance) {
  // Payroll (Gusto/ADP) → per-job labor cost + hours. Dry-run previews.
  app.post<{ Params: { companyId: string } }>(
    "/companies/:companyId/integrations/payroll/import",
    async (req) => importPayroll(req.params.companyId)
  );

  // FreshBooks → invoices + expenses as cash events. Dry-run previews.
  app.post<{ Params: { companyId: string } }>(
    "/companies/:companyId/integrations/freshbooks/sync",
    async (req) => syncFreshbooks(req.params.companyId)
  );

  // Tax → estimated quarterly obligations into the forecast. Dry-run previews.
  app.get<{ Params: { companyId: string }; Querystring: { rate?: number } }>(
    "/companies/:companyId/integrations/tax",
    { schema: { querystring: taxQuerySchema } },
    async (req) => projectTax(req.params.companyId, { ratePct: req.query.rate })
  );
}
