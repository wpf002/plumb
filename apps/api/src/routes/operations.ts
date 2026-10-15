import type { FastifyInstance } from "fastify";
import { loadLedger } from "../analytics/ledger.js";
import * as ops from "../analytics/operations.js";
import { companyAsOf } from "../snapshot.js";

type P = { Params: { companyId: string } };

export function registerOperationsRoutes(app: FastifyInstance) {
  app.get<P>("/companies/:companyId/operations/service-lines", async (req) => {
    const id = req.params.companyId;
    const ledger = await loadLedger(id);
    const years = ops.completeYears(ledger, await companyAsOf(id));
    return ops.serviceLines(ledger, years.slice(-4));
  });
  app.get<P>("/companies/:companyId/operations/customers", async (req) => ops.customers(req.params.companyId, await loadLedger(req.params.companyId)));
  app.get<P>("/companies/:companyId/operations/labor", async (req) => {
    const id = req.params.companyId;
    const ledger = await loadLedger(id);
    const [labor, crews, utilization] = await Promise.all([ops.labor(id, ledger), ops.crews(id), ops.crewUtilization(id)]);
    return { ...labor, crews, utilization };
  });
  app.get<P>("/companies/:companyId/operations/capacity", async (req) => ops.capacityPlan(req.params.companyId, await loadLedger(req.params.companyId)));
  app.get<P>("/companies/:companyId/operations/recurring", async (req) => ops.recurringDashboard(req.params.companyId, await loadLedger(req.params.companyId)));
  app.get<P>("/companies/:companyId/operations/service-calls", async (req) => ops.serviceCalls(req.params.companyId));
}
