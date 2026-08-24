import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { computeNetWorth } from "@plumb/engine";
import { addDays } from "@plumb/shared";
import { n, toEngineAsset, toEngineLiability } from "../map.js";
import { openingCashCents } from "../snapshot.js";

export function registerBalanceSheetRoutes(app: FastifyInstance) {
  // What the business owns, what it owes, what it's worth. Cash comes from the
  // same opening-cash source the forecast uses, so the two views agree.
  app.get<{ Params: { companyId: string }; Querystring: { asOf?: string } }>(
    "/companies/:companyId/balance-sheet",
    async (req) => {
      const companyId = req.params.companyId;
      await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();

      const [assets, liabilities, cashCents] = await Promise.all([
        prisma.asset.findMany({ where: { companyId } }),
        prisma.liability.findMany({ where: { companyId } }),
        openingCashCents(companyId),
      ]);

      const result = computeNetWorth({
        asOf,
        cashCents,
        assets: assets.map(toEngineAsset),
        liabilities: liabilities.map(toEngineLiability),
        horizonEnd: addDays(asOf, 365 * 10),
      });

      // Names for the liability rows so the UI never has to join client-side.
      const liabilityNames = Object.fromEntries(liabilities.map((l) => [l.id, l.name]));
      return {
        ...result,
        liabilityNames,
        assetCount: assets.length,
        liabilityCount: liabilities.filter((l) => l.active).length,
        totalPurchaseCostCents: assets.reduce((s, a) => s + n(a.purchaseCost), 0),
      };
    }
  );
}
