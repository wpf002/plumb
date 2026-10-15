import type { FastifyInstance } from "fastify";
import { buildDigest } from "@plumb/engine";
import { loadSnapshot } from "../snapshot.js";
import { getAnalyst } from "../ai.js";

export function registerAnalysisRoutes(app: FastifyInstance) {
  // Weeks where obligations land on money from late payers, without a model call.
  app.get<{ Params: { companyId: string } }>("/companies/:companyId/collisions", async (req) => {
    const snap = await loadSnapshot(req.params.companyId, { horizonDays: 90 });
    return { collisions: snap.collisions };
  });

  // The plain-English read on the business. The engine computed every number;
  // this decides which of them matter and says so in a sentence. Without an
  // ANTHROPIC_API_KEY it returns the deterministic narration instead of
  // failing — the owner never gets a blank page.
  app.get<{ Params: { companyId: string }; Querystring: { horizon?: number } }>(
    "/companies/:companyId/analysis",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { horizon: { type: "integer", minimum: 30, maximum: 365 } },
        },
      },
    },
    async (req) => {
      const snap = await loadSnapshot(req.params.companyId, {
        horizonDays: req.query.horizon ?? 90,
      });
      const digest = buildDigest({
        asOf: snap.asOf,
        companyName: snap.company.name,
        health: snap.health,
        cash: snap.cash,
        wip: snap.wip,
        projectNames: snap.projectNames,
        services: snap.services,
        obligations: snap.obligations,
        billing: snap.billing,
      });

      const analyst = getAnalyst();
      const analysis = await analyst.analyze(snap, digest);
      return {
        ...analysis,
        live: analyst.live,
        // Shown alongside the narration so the owner can check any claim.
        collisions: snap.collisions,
        score: snap.health.score,
      };
    }
  );
}
