import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeMargin } from "@plumb/engine";
import { n } from "../map.js";

export function registerProjectRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/projects",
    async (req) => {
      const projects = await prisma.project.findMany({
        where: { companyId: req.params.companyId, status: { not: "CLOSED" } },
        include: { costs: true, changeOrders: true },
      });

      return projects.map((p) => {
        const margin = computeMargin(
          {
            id: p.id,
            name: p.name,
            client: p.client,
            clientType: p.clientType,
            status: p.status,
            contractValueCents: n(p.contractValue),
            originalBidCostCents: n(p.originalBidCost),
            targetMarginPct: p.targetMarginPct,
            retainagePct: p.retainagePct,
            startDate: p.startDate,
            endDate: p.endDate,
            percentComplete: p.percentComplete ?? undefined,
          },
          p.costs.map((c) => ({
            id: c.id,
            projectId: c.projectId,
            category: c.category,
            amountCents: n(c.amount),
            incurredDate: c.incurredDate,
          })),
          p.changeOrders.map((c) => ({
            id: c.id,
            projectId: c.projectId,
            contractDeltaCents: n(c.contractDelta),
            costDeltaCents: n(c.costDelta),
            status: c.status,
            date: c.date,
          }))
        );
        return { project: { id: p.id, name: p.name, client: p.client }, margin };
      });
    }
  );
}
