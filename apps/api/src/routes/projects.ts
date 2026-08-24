import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeMargin, computeRetainage, summarizeMilestones } from "@plumb/engine";
import {
  n,
  toEngineProject,
  toEngineCosts,
  toEngineChangeOrders,
  toEngineBudgets,
  toEngineMilestone,
} from "../map.js";

const CATEGORIES = ["LABOR", "MATERIAL", "EQUIPMENT", "TRAVEL", "SUBCONTRACT", "OTHER"] as const;

const phaseBodySchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    code: { type: "string", maxLength: 40 },
  },
} as const;

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
      const asOf = new Date();
      const projects = await prisma.project.findMany({
        where: { companyId: req.params.companyId, status: { not: "CLOSED" } },
        include: { costs: true, changeOrders: true, budgetLines: true, milestones: true, payer: true },
      });

      return projects.map((p) => {
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
            payerId: p.payerId,
            payerName: p.payer?.name ?? null,
            payerDaysLate: p.payer?.typicalDaysLate ?? 0,
            status: p.status,
            contractValueCents: n(p.contractValue),
            startDate: p.startDate,
            endDate: p.endDate,
            expectedEndDate: p.expectedEndDate,
          },
          margin,
          billing: summarizeMilestones(
            p.id,
            n(p.contractValue),
            p.milestones.map(toEngineMilestone),
            asOf
          ),
        };
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
        include: { costs: true, changeOrders: true, budgetLines: true, phases: true, milestones: true },
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
        changeOrders: p.changeOrders
          .slice()
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .map((co) => ({
            id: co.id,
            reason: co.reason,
            contractDeltaCents: n(co.contractDelta),
            costDeltaCents: n(co.costDelta),
            marginImpactCents: n(co.contractDelta) - n(co.costDelta),
            status: co.status,
            date: co.date,
            approvedAt: co.approvedAt,
          })),
        phases: p.phases
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((ph) => {
            const bl = p.budgetLines.filter((b) => b.phaseId === ph.id);
            const cs = p.costs.filter((c) => c.phaseId === ph.id);
            const budgetedCostCents = bl.reduce((a, b) => a + n(b.budgetedCost), 0);
            const actualCostCents = cs.reduce((a, c) => a + n(c.amount), 0);
            const laborHours = cs.reduce((a, c) => a + (c.laborHours ?? 0), 0);
            return {
              id: ph.id,
              name: ph.name,
              code: ph.code,
              budgetedCostCents,
              actualCostCents,
              laborHours,
              varianceCents: actualCostCents - budgetedCostCents,
            };
          }),
        unphasedCostCents: p.costs.filter((c) => !c.phaseId).reduce((a, c) => a + n(c.amount), 0),
      };
    }
  );

  // Add a phase (cost code) to a project.
  app.post<{ Params: { companyId: string; projectId: string }; Body: { name: string; code?: string } }>(
    "/companies/:companyId/projects/:projectId/phases",
    { schema: { body: phaseBodySchema } },
    async (req) => {
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, companyId: req.params.companyId },
        select: { id: true },
      });
      const max = await prisma.phase.aggregate({ where: { projectId: project.id }, _max: { sortOrder: true } });
      const phase = await prisma.phase.create({
        data: { projectId: project.id, name: req.body.name, code: req.body.code ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1 },
      });
      return { id: phase.id, name: phase.name, code: phase.code };
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
