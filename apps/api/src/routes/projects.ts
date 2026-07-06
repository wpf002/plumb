import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeMargin } from "@plumb/engine";
import {
  toEngineProject,
  toEngineCosts,
  toEngineChangeOrders,
  toEngineBudgets,
} from "../map.js";

export function registerProjectRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/projects",
    async (req) => {
      const projects = await prisma.project.findMany({
        where: { companyId: req.params.companyId, status: { not: "CLOSED" } },
        include: { costs: true, changeOrders: true, budgetLines: true },
      });

      return projects.map((p) => {
        const margin = computeMargin(
          toEngineProject(p),
          toEngineCosts(p.costs),
          toEngineChangeOrders(p.changeOrders),
          toEngineBudgets(p.budgetLines)
        );
        return { project: { id: p.id, name: p.name, client: p.client }, margin };
      });
    }
  );
}
