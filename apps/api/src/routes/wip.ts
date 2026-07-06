import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeWip } from "@plumb/engine";
import { toEngineProject, toEngineCosts, toEngineChangeOrders } from "../map.js";

export function registerWipRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/wip",
    async (req) => {
      const projects = await prisma.project.findMany({
        where: {
          companyId: req.params.companyId,
          status: { in: ["ACTIVE", "AWARDED"] },
        },
        include: { costs: true, changeOrders: true },
      });

      const report = computeWip(
        projects.map((p) => ({
          project: toEngineProject(p),
          costs: toEngineCosts(p.costs),
          changeOrders: toEngineChangeOrders(p.changeOrders),
        }))
      );

      const names = new Map(projects.map((p) => [p.id, p.name]));
      return {
        ...report,
        rows: report.rows.map((r) => ({ ...r, name: names.get(r.projectId) })),
      };
    }
  );
}
