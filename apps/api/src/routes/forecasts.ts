import type { FastifyInstance } from "fastify";
import { forecastAccuracy, revenueForecast, thirteenWeek, twelveMonth } from "../analytics/forecast.js";

export function registerForecastV2Routes(app: FastifyInstance) {
  // Flagship: weekly cash for the next 13 weeks with reserve, LOC, and shortfall.
  app.get<{ Params: { companyId: string }; Querystring: { case?: "base" | "upside" | "downside" } }>(
    "/companies/:companyId/forecast/13-week",
    { schema: { querystring: { type: "object", properties: { case: { type: "string", enum: ["base", "upside", "downside"] } } } } },
    async (req) => thirteenWeek(req.params.companyId, { case: req.query.case })
  );

  app.get<{ Params: { companyId: string } }>("/companies/:companyId/forecast/12-month", async (req) =>
    twelveMonth(req.params.companyId)
  );

  app.get<{ Params: { companyId: string } }>("/companies/:companyId/forecast/revenue", async (req) =>
    revenueForecast(req.params.companyId)
  );

  app.get<{ Params: { companyId: string } }>("/companies/:companyId/forecast/accuracy", async (req) =>
    forecastAccuracy(req.params.companyId)
  );
}
