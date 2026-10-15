import type { FastifyInstance } from "fastify";
import { agingReport } from "@plumb/engine";
import { loadLedger } from "../analytics/ledger.js";
import { healthDashboard } from "../analytics/health.js";
import { arAging, billList, collections, debtDashboard, invoiceList, openPayables, workingCapital } from "../analytics/workingcapital.js";
import { companyAsOf } from "../snapshot.js";

export function registerWorkingCapitalRoutes(app: FastifyInstance) {
  // The primary dashboard: every health metric with its reading, plus concerns.
  app.get<{ Params: { companyId: string } }>("/companies/:companyId/health-dashboard", async (req) =>
    healthDashboard(req.params.companyId, await loadLedger(req.params.companyId))
  );

  // AR aging, collections priority, AP aging, and the working-capital ratios.
  app.get<{ Params: { companyId: string } }>("/companies/:companyId/working-capital", async (req) => {
    const companyId = req.params.companyId;
    const ledger = await loadLedger(companyId);
    const asOf = await companyAsOf(companyId);
    const [wc, ar, priority, payables, invoices, bills] = await Promise.all([
      workingCapital(companyId, ledger),
      arAging(companyId),
      collections(companyId),
      openPayables(companyId, asOf),
      invoiceList(companyId, asOf),
      billList(companyId, asOf),
    ]);
    return { workingCapital: wc, receivables: ar.aging, collections: priority, payables: agingReport(payables, asOf), invoices, bills };
  });

  app.get<{ Params: { companyId: string } }>("/companies/:companyId/debt", async (req) =>
    debtDashboard(req.params.companyId, await loadLedger(req.params.companyId))
  );
}
