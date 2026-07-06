import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import {
  computeCashFlow,
  computeMargin,
  evaluateBid,
  type ProspectiveBid,
} from "@plumb/engine";
import { n } from "../map.js";

interface BidBody {
  contractValueCents: number;
  estCostCents: number;
  targetMarginPct: number;
  laborHoursByMonth: Record<string, number>;
  openingCashCents?: number;
}

export function registerBidRoutes(app: FastifyInstance) {
  app.post<{ Params: { companyId: string }; Body: BidBody }>(
    "/companies/:companyId/bid",
    async (req) => {
      const { companyId } = req.params;
      const company = await prisma.company.findUniqueOrThrow({
        where: { id: companyId },
      });

      // Committed remaining labor by month across active jobs.
      const commitments = await prisma.laborCommitment.findMany({
        where: { project: { companyId, status: { in: ["ACTIVE", "AWARDED"] } } },
      });
      const committedHoursByMonth: Record<string, number> = {};
      for (const c of commitments) {
        committedHoursByMonth[c.month] =
          (committedHoursByMonth[c.month] ?? 0) + c.hours;
      }

      // Worst-case cash over 90 days.
      const events = await prisma.cashEvent.findMany({ where: { companyId } });
      const cash = computeCashFlow({
        openingCashCents: req.body.openingCashCents ?? 250_000_00,
        asOf: new Date(),
        horizonDays: 90,
        stressDelayDays: 30,
        safetyThresholdCents: n(company.cashSafetyThreshold),
        events: events.map((e) => ({
          id: e.id,
          projectId: e.projectId,
          direction: e.direction,
          amountCents: n(e.amount),
          category: e.category,
          expectedDate: e.expectedDate,
          actualDate: e.actualDate,
          status: e.status,
        })),
      });

      // Recent margin trend across active jobs.
      const projects = await prisma.project.findMany({
        where: { companyId, status: "ACTIVE" },
        include: { costs: true, changeOrders: true },
      });
      const recentMarginDeltas = projects.map((p) => {
        const m = computeMargin(
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
        return m.projectedFinalMarginPct - p.targetMarginPct;
      });

      const bid: ProspectiveBid = {
        contractValueCents: req.body.contractValueCents,
        estCostCents: req.body.estCostCents,
        targetMarginPct: req.body.targetMarginPct,
        laborHoursByMonth: req.body.laborHoursByMonth,
      };

      return evaluateBid(bid, {
        capacity: { monthlyLaborHours: company.monthlyLaborHours },
        committedHoursByMonth,
        projectedMinCashCents: cash.stress.minBalanceCents,
        safetyThresholdCents: n(company.cashSafetyThreshold),
        recentMarginDeltas,
      });
    }
  );
}
