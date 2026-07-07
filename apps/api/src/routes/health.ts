import type { FastifyInstance } from "fastify";
import { loadSnapshot } from "../snapshot.js";

const healthQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: { opening: { type: "integer", minimum: 0 } },
} as const;

export function registerHealthRoutes(app: FastifyInstance) {
  app.get<{
    Params: { companyId: string };
    Querystring: { opening?: number };
  }>(
    "/companies/:companyId/health",
    { schema: { querystring: healthQuerySchema } },
    async (req) => {
      const snap = await loadSnapshot(req.params.companyId, {
        openingCents: req.query.opening,
      });
      return snap.health;
    }
  );
}
