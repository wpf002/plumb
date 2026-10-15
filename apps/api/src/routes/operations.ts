import type { FastifyInstance } from "fastify";
import { loadLedger } from "../analytics/ledger.js";
import * as ops from "../analytics/operations.js";
import { companyAsOf } from "../snapshot.js";
import { benchmarks } from "../analytics/benchmarks.js";
import { lenderCsv, lenderPackage } from "../analytics/lender.js";

type P = { Params: { companyId: string } };

export function registerOperationsRoutes(app: FastifyInstance) {
  app.get<P>("/companies/:companyId/operations/service-lines", async (req) => {
    const id = req.params.companyId;
    const ledger = await loadLedger(id);
    const years = ops.completeYears(ledger, await companyAsOf(id));
    const sl = ops.serviceLines(ledger, years.slice(-4));
    const last = years.at(-1);
    const labor = last ? await ops.lineLabor(id, ledger.periods.filter((p) => p.startsWith(String(last)))) : new Map();
    return {
      ...sl,
      lines: sl.lines.map((l) => {
        const pay = labor.get(l.line.toLowerCase());
        const rev = last ? l.byYear[last].revenueCents : 0;
        return { ...l, laborPct: pay && rev ? Math.round((pay / rev) * 1000) / 10 : null };
      }),
    };
  });
  app.get<P>("/companies/:companyId/operations/customers", async (req) => ops.customers(req.params.companyId, await loadLedger(req.params.companyId)));
  app.get<P>("/companies/:companyId/operations/labor", async (req) => {
    const id = req.params.companyId;
    const ledger = await loadLedger(id);
    const [labor, crews, utilization] = await Promise.all([ops.labor(id, ledger), ops.crews(id, ledger), ops.crewUtilization(id)]);
    return { ...labor, crews, utilization };
  });
  app.get<P>("/companies/:companyId/operations/capacity", async (req) => ops.capacityPlan(req.params.companyId, await loadLedger(req.params.companyId)));
  app.get<P>("/companies/:companyId/operations/recurring", async (req) => ops.recurringDashboard(req.params.companyId, await loadLedger(req.params.companyId)));
  app.get<P>("/companies/:companyId/operations/service-calls", async (req) => ops.serviceCalls(req.params.companyId));
}

export function registerBenchmarkRoutes(app: FastifyInstance) {
  app.get<P>("/companies/:companyId/operations/benchmarks", async (req) => benchmarks(req.params.companyId));
  app.get<P & { Querystring: { format?: "csv" | "json" } }>("/companies/:companyId/lender-package", async (req, reply) => {
    const pkg = await lenderPackage(req.params.companyId, await loadLedger(req.params.companyId));
    if (req.query.format === "csv") {
      const file = `${pkg.company.replace(/[^A-Za-z0-9]+/g, "-")}-lender-package-${pkg.asOf}.csv`;
      return reply.header("Content-Type", "text/csv").header("Content-Disposition", `attachment; filename="${file}"`).send(lenderCsv(pkg));
    }
    return pkg;
  });
}
