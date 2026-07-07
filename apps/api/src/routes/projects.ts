import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeMargin, computeRetainage } from "@plumb/engine";
import {
  n,
  toEngineProject,
  toEngineCosts,
  toEngineChangeOrders,
  toEngineBudgets,
} from "../map.js";

const CATEGORIES = ["LABOR", "MATERIAL", "EQUIPMENT", "TRAVEL", "SUBCONTRACT", "OTHER"] as const;

const budgetsBodySchema = {
  type: "object",
  required: ["budgets"],
  additionalProperties: false,
  properties: {
    budgets: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        required: ["category", "budgetedCostCents"],
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: CATEGORIES },
          budgetedCostCents: { type: "integer", minimum: 0 },
          budgetedHours: { type: "number", minimum: 0 },
        },
      },
    },
  },
} as const;

interface BudgetsBody {
  budgets: { category: string; budgetedCostCents: number; budgetedHours?: number }[];
}

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

  // Retainage held across active jobs and when it's projected to release —
  // how much earned cash is tied up by hold-backs.
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/retainage",
    async (req) => {
      const projects = await prisma.project.findMany({
        where: { companyId: req.params.companyId, status: { in: ["ACTIVE", "AWARDED"] } },
      });
      return computeRetainage(
        projects.map((p) => ({
          projectId: p.id,
          projectName: p.name,
          retainagePct: p.retainagePct,
          billedToDateCents: n(p.billedToDate),
          endDate: p.endDate,
          netDays: p.netDays,
        })),
        new Date()
      );
    }
  );

  // Single-project detail: full record + margin (with variances) + budget lines.
  app.get<{ Params: { companyId: string; projectId: string } }>(
    "/companies/:companyId/projects/:projectId",
    async (req) => {
      const p = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, companyId: req.params.companyId },
        include: { costs: true, changeOrders: true, budgetLines: true },
      });
      const margin = computeMargin(
        toEngineProject(p),
        toEngineCosts(p.costs),
        toEngineChangeOrders(p.changeOrders),
        toEngineBudgets(p.budgetLines)
      );
      return {
        project: {
          id: p.id,
          name: p.name,
          client: p.client,
          clientType: p.clientType,
          status: p.status,
          billingType: p.billingType,
          contractValueCents: n(p.contractValue),
          originalBidCostCents: n(p.originalBidCost),
          billedToDateCents: n(p.billedToDate),
          targetMarginPct: p.targetMarginPct,
          retainagePct: p.retainagePct,
          netDays: p.netDays,
          percentComplete: p.percentComplete,
          startDate: p.startDate,
          endDate: p.endDate,
        },
        margin,
        budgets: p.budgetLines.map((b) => ({
          category: b.category,
          budgetedCostCents: n(b.budgetedCost),
          budgetedHours: b.budgetedHours,
        })),
      };
    }
  );

  // Replace a project's (company-level) budget lines so overruns are attributed
  // per category. Idempotent: swaps the whole set in one transaction.
  app.put<{ Params: { companyId: string; projectId: string }; Body: BudgetsBody }>(
    "/companies/:companyId/projects/:projectId/budgets",
    { schema: { body: budgetsBodySchema } },
    async (req) => {
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, companyId: req.params.companyId },
        select: { id: true },
      });

      await prisma.$transaction([
        prisma.budgetLine.deleteMany({ where: { projectId: project.id, phaseId: null } }),
        prisma.budgetLine.createMany({
          data: req.body.budgets.map((b) => ({
            projectId: project.id,
            category: b.category as (typeof CATEGORIES)[number],
            budgetedCost: BigInt(b.budgetedCostCents),
            budgetedHours: b.budgetedHours ?? undefined,
          })),
        }),
      ]);

      return { ok: true, count: req.body.budgets.length };
    }
  );
}
