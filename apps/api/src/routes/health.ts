import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeCashFlow, computeHealth, computeMargin } from "@plumb/engine";
import { monthKey } from "@plumb/shared";
import { n, toEngineProject, toEngineCosts, toEngineChangeOrders } from "../map.js";

const healthQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: { opening: { type: "integer", minimum: 0 } },
} as const;

export function registerHealthRoutes(app: FastifyInstance) {
  app.get<{
    Params: { companyId: string };
    Querystring: { opening?: string };
  }>(
    "/companies/:companyId/health",
    { schema: { querystring: healthQuerySchema } },
    async (req) => {
    const { companyId } = req.params;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    // Opening cash: latest bank snapshot, else query param, else default.
    const snap = await prisma.cashSnapshot.findFirst({
      where: { companyId },
      orderBy: { asOf: "desc" },
    });
    const openingCashCents = snap
      ? n(snap.balance)
      : Number(req.query.opening ?? 250_000_00);

    const events = await prisma.cashEvent.findMany({ where: { companyId } });
    const cash = computeCashFlow({
      openingCashCents,
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
      where: { companyId, status: { in: ["ACTIVE", "AWARDED"] } },
      include: { costs: true, changeOrders: true },
    });
    const margins = projects.map((p) =>
      computeMargin(toEngineProject(p), toEngineCosts(p.costs), toEngineChangeOrders(p.changeOrders))
    );

    const commitments = await prisma.laborCommitment.findMany({
      where: { project: { companyId, status: { in: ["ACTIVE", "AWARDED"] } } },
    });
    const byMonth: Record<string, number> = {};
    for (const c of commitments) byMonth[c.month] = (byMonth[c.month] ?? 0) + c.hours;
    const now = new Date();
    const next3 = [0, 1, 2].map((m) =>
      monthKey(new Date(now.getUTCFullYear(), now.getUTCMonth() + m, 1))
    );
    const cap = company.monthlyLaborHours || 1;
    const peakUtilization90d = Math.max(0, ...next3.map((m) => (byMonth[m] ?? 0) / cap));

    const inbound = events.filter((e) => e.direction === "IN" && e.status !== "RECEIVED");
    const arOutstandingCents = inbound.reduce((a, e) => a + n(e.amount), 0);
    const arPastDueCents = inbound
      .filter((e) => e.expectedDate < now)
      .reduce((a, e) => a + n(e.amount), 0);

    return computeHealth({
      cash,
      margins,
      portfolioTargetMarginPct: company.portfolioTargetMargin,
      peakUtilization90d,
      arPastDueCents,
      arOutstandingCents,
    });
  });
}
