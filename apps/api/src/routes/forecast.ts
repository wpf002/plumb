import type { FastifyInstance } from "fastify";
import { rollupMonthly } from "@plumb/engine";
import { loadSnapshot } from "../snapshot.js";

// 30/60/90/120 stay the headline horizons. 180 and 365 exist because multi-year
// liabilities and leases can't be seen in a 120-day window — a loan payoff or a
// lease expiry is invisible until the view is long enough to contain it.
const HORIZONS = [30, 60, 90, 120, 180, 365] as const;

const forecastQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    horizon: { type: "integer", enum: [...HORIZONS] },
    stress: { type: "integer", minimum: 0, maximum: 365 },
    opening: { type: "integer", minimum: 0 },
  },
} as const;

export function registerForecastRoutes(app: FastifyInstance) {
  app.get<{
    Params: { companyId: string };
    Querystring: { horizon?: number; stress?: number; opening?: number };
  }>(
    "/companies/:companyId/forecast",
    { schema: { querystring: forecastQuerySchema } },
    async (req) => {
      const horizonDays = Number(req.query.horizon ?? 90);
      // Built from the same snapshot the dashboard and digest use, so the
      // forecast, the health score, and the weekly email can never disagree.
      const snap = await loadSnapshot(req.params.companyId, {
        horizonDays,
        stressDelayDays: req.query.stress === undefined ? undefined : Number(req.query.stress),
        openingCents: req.query.opening === undefined ? undefined : Number(req.query.opening),
      });

      return {
        ...snap.cash,
        horizonDays,
        openingCashCents: snap.openingCashCents,
        obligations: snap.obligations,
        // Daily points are unreadable past a quarter; roll up beyond that.
        monthly: horizonDays > 120 ? rollupMonthly(snap.cash.base.series) : null,
        monthlyStress: horizonDays > 120 ? rollupMonthly(snap.cash.stress.series) : null,
        projected: snap.projected.map((p) => ({
          origin: p.origin,
          originId: p.originId,
          label: p.label,
          category: p.category,
          direction: p.direction,
          amountCents: p.amountCents,
          expectedDate: p.expectedDate,
          sourceKey: p.sourceKey,
        })),
      };
    }
  );
}
