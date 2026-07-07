import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeCashFlow, computeMargin, evaluateBid, type ProspectiveBid } from "@plumb/engine";
import { n, toEngineProject, toEngineCosts, toEngineChangeOrders } from "../map.js";

interface BidBody {
  contractValueCents: number;
  estCostCents: number;
  targetMarginPct: number;
  laborHoursByMonth: Record<string, number>;
  openingCashCents?: number;
}

const bidBodySchema = {
  type: "object",
  required: ["contractValueCents", "estCostCents", "targetMarginPct", "laborHoursByMonth"],
  additionalProperties: false,
  properties: {
    contractValueCents: { type: "integer", minimum: 1 },
    estCostCents: { type: "integer", minimum: 0 },
    targetMarginPct: { type: "number", minimum: -100, maximum: 100 },
    laborHoursByMonth: {
      type: "object",
      // keys are YYYY-MM month buckets; values are committed hours
      patternProperties: { "^\\d{4}-\\d{2}$": { type: "number", minimum: 0 } },
      additionalProperties: false,
    },
    openingCashCents: { type: "integer", minimum: 0 },
  },
} as const;

export function registerBidRoutes(app: FastifyInstance) {
  app.post<{ Params: { companyId: string }; Body: BidBody }>(
    "/companies/:companyId/bid",
    { schema: { body: bidBodySchema } },
    async (req) => {
      const { companyId } = req.params;
      const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

      const commitments = await prisma.laborCommitment.findMany({
        where: { project: { companyId, status: { in: ["ACTIVE", "AWARDED"] } } },
      });
      const committedHoursByMonth: Record<string, number> = {};
      for (const c of commitments)
        committedHoursByMonth[c.month] = (committedHoursByMonth[c.month] ?? 0) + c.hours;

      const snap = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: { asOf: "desc" },
      });
      const events = await prisma.cashEvent.findMany({ where: { companyId } });
      const cash = computeCashFlow({
        openingCashCents: snap ? n(snap.balance) : req.body.openingCashCents ?? 250_000_00,
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

      const projects = await prisma.project.findMany({
        where: { companyId, status: "ACTIVE" },
        include: { costs: true, changeOrders: true },
      });
      const recentMarginDeltas = projects.map((p) => {
        const m = computeMargin(
          toEngineProject(p),
          toEngineCosts(p.costs),
          toEngineChangeOrders(p.changeOrders)
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
