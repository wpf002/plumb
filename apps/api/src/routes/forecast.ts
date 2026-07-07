import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeCashFlow } from "@plumb/engine";
import { n } from "../map.js";

const forecastQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    horizon: { type: "integer", enum: [30, 60, 90, 120] },
    stress: { type: "integer", minimum: 0, maximum: 365 },
    opening: { type: "integer", minimum: 0 },
  },
} as const;

export function registerForecastRoutes(app: FastifyInstance) {
  app.get<{
    Params: { companyId: string };
    Querystring: { horizon?: string; stress?: string; opening?: string };
  }>(
    "/companies/:companyId/forecast",
    { schema: { querystring: forecastQuerySchema } },
    async (req) => {
    const { companyId } = req.params;
    const horizonDays = Number(req.query.horizon ?? 90);
    const stressDelayDays = Number(req.query.stress ?? 30);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    const events = await prisma.cashEvent.findMany({ where: { companyId } });

    // Opening balance is entered by the owner (bank feed later). Default via query.
    const openingCashCents = Number(req.query.opening ?? 250_000_00);

    const result = computeCashFlow({
      openingCashCents,
      asOf: new Date(),
      horizonDays,
      stressDelayDays,
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

    return result;
  });
}
