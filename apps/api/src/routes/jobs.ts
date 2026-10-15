import type { FastifyInstance } from "fastify";
import * as jobs from "../analytics/projects.js";

type P = { Params: { companyId: string } };

export function registerJobRoutes(app: FastifyInstance) {
  // Job profitability: every job's margin vs target, plus rollups by type.
  app.get<P>("/companies/:companyId/jobs", async (req) => {
    const id = req.params.companyId;
    const [all, performance, byType, costMix, fade, standouts] = await Promise.all([
      jobs.loadJobs(id),
      jobs.marginPerformance(id),
      jobs.byType(id, "category"),
      jobs.costMix(id, "category"),
      jobs.marginFade(id),
      jobs.standouts(id),
    ]);
    const live = all.filter((j) => j.actual.total > 0 || j.status !== "CLOSED");
    return {
      performance,
      byType: byType.sort((a, b) => b.contractCents - a.contractCents),
      costMix,
      fade: fade.slice(0, 10),
      standouts: standouts.slice(0, 10),
      jobs: live
        .sort((a, b) => b.end.getTime() - a.end.getTime())
        .map((j) => ({
          id: j.id,
          externalId: j.externalId,
          name: j.name,
          customer: j.customer,
          type: j.type,
          status: j.status,
          end: j.end,
          revisedContractCents: j.revisedContractCents,
          costCents: j.actual.total,
          projectedGrossProfitCents: j.projectedGrossProfitCents,
          targetMarginPct: j.targetMarginPct,
          bidMarginPct: j.originalMarginPct,
          projectedMarginPct: j.projectedMarginPct,
          percentComplete: j.percentComplete,
          flag: j.flag,
        })),
    };
  });

  app.get<P>("/companies/:companyId/jobs/estimates", async (req) => {
    const id = req.params.companyId;
    const [eva, over] = await Promise.all([jobs.estimateVsActual(id), jobs.overruns(id, 4)]);
    return { ...eva, overruns: over };
  });
  app.get<P>("/companies/:companyId/jobs/wip", async (req) => jobs.wip(req.params.companyId));
  app.get<P>("/companies/:companyId/jobs/change-orders", async (req) => jobs.changeOrders(req.params.companyId));
  app.get<P>("/companies/:companyId/jobs/retainage", async (req) => jobs.retainage(req.params.companyId));
  app.get<P>("/companies/:companyId/jobs/backlog", async (req) => jobs.backlog(req.params.companyId));
  app.get<P>("/companies/:companyId/jobs/pipeline", async (req) => jobs.pipeline(req.params.companyId));
}
