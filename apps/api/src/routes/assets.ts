import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { valueAssets } from "@plumb/engine";
import { n, toEngineAsset } from "../map.js";
import { companyAsOf } from "../snapshot.js";

export const ASSET_CATEGORIES = [
  "VEHICLE",
  "EQUIPMENT",
  "REAL_ESTATE",
  "TECHNOLOGY",
  "OTHER",
] as const;

const assetBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    description: { type: "string", maxLength: 500, nullable: true },
    category: { type: "string", enum: [...ASSET_CATEGORIES] },
    purchaseDate: { type: "string", format: "date-time" },
    purchaseCostCents: { type: "integer", minimum: 0 },
    currentValueCents: { type: "integer", minimum: 0, nullable: true },
    usefulLifeMonths: { type: "integer", minimum: 1, maximum: 1200, nullable: true },
    salvageValueCents: { type: "integer", minimum: 0 },
    disposedAt: { type: "string", format: "date-time", nullable: true },
    assetType: { type: "string", maxLength: 80, nullable: true },
    unitCount: { type: "integer", minimum: 1, maximum: 500 },
    replacementCostCents: { type: "integer", minimum: 0, nullable: true },
    maintenanceCostAnnualCents: { type: "integer", minimum: 0, nullable: true },
    repairCostAnnualCents: { type: "integer", minimum: 0, nullable: true },
    fuelCostAnnualCents: { type: "integer", minimum: 0, nullable: true },
    insuranceCostAnnualCents: { type: "integer", minimum: 0, nullable: true },
    utilizationPct: { type: "number", minimum: 0, maximum: 100, nullable: true },
    downtimeDaysAnnual: { type: "integer", minimum: 0, maximum: 366, nullable: true },
  },
} as const;

const createBody = {
  ...assetBody,
  required: ["name", "category", "purchaseDate", "purchaseCostCents"],
} as const;

interface AssetBody {
  name?: string;
  description?: string | null;
  category?: (typeof ASSET_CATEGORIES)[number];
  purchaseDate?: string;
  purchaseCostCents?: number;
  currentValueCents?: number | null;
  usefulLifeMonths?: number | null;
  salvageValueCents?: number;
  disposedAt?: string | null;
  assetType?: string | null;
  unitCount?: number;
  replacementCostCents?: number | null;
  maintenanceCostAnnualCents?: number | null;
  repairCostAnnualCents?: number | null;
  fuelCostAnnualCents?: number | null;
  insuranceCostAnnualCents?: number | null;
  utilizationPct?: number | null;
  downtimeDaysAnnual?: number | null;
}

const big = (v: number | null) => (v === null ? null : BigInt(v));

const shape = (a: any) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  category: a.category,
  purchaseDate: a.purchaseDate,
  purchaseCostCents: n(a.purchaseCost),
  currentValueCents: a.currentValue === null ? null : n(a.currentValue),
  valueAsOf: a.valueAsOf,
  usefulLifeMonths: a.usefulLifeMonths,
  salvageValueCents: n(a.salvageValue),
  disposedAt: a.disposedAt,
  assetType: a.assetType,
  unitCount: a.unitCount,
  replacementCostCents: a.replacementCost === null ? null : n(a.replacementCost),
  maintenanceCostAnnualCents: a.maintenanceCostAnnual === null ? null : n(a.maintenanceCostAnnual),
  repairCostAnnualCents: a.repairCostAnnual === null ? null : n(a.repairCostAnnual),
  fuelCostAnnualCents: a.fuelCostAnnual === null ? null : n(a.fuelCostAnnual),
  insuranceCostAnnualCents: a.insuranceCostAnnual === null ? null : n(a.insuranceCostAnnual),
  utilizationPct: a.utilizationPct,
  downtimeDaysAnnual: a.downtimeDaysAnnual,
});

// Entering a manual current value re-anchors depreciation, so valueAsOf is
// stamped here rather than accepted from the client — the anchor date must be
// when the owner actually said it, not whatever the browser sends.
function writeData(b: AssetBody, isCreate: boolean) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.description !== undefined && { description: b.description }),
    ...(b.category !== undefined && { category: b.category }),
    ...(b.purchaseDate !== undefined && { purchaseDate: new Date(b.purchaseDate) }),
    ...(b.purchaseCostCents !== undefined && { purchaseCost: BigInt(b.purchaseCostCents) }),
    ...(b.currentValueCents !== undefined && {
      currentValue: b.currentValueCents === null ? null : BigInt(b.currentValueCents),
      valueAsOf: b.currentValueCents === null ? null : new Date(),
    }),
    ...(b.usefulLifeMonths !== undefined && { usefulLifeMonths: b.usefulLifeMonths }),
    ...(b.salvageValueCents !== undefined && { salvageValue: BigInt(b.salvageValueCents) }),
    ...(b.disposedAt !== undefined && {
      disposedAt: b.disposedAt === null ? null : new Date(b.disposedAt),
    }),
    ...(b.assetType !== undefined && { assetType: b.assetType }),
    ...(b.unitCount !== undefined && { unitCount: b.unitCount }),
    ...(b.replacementCostCents !== undefined && { replacementCost: big(b.replacementCostCents) }),
    ...(b.maintenanceCostAnnualCents !== undefined && { maintenanceCostAnnual: big(b.maintenanceCostAnnualCents) }),
    ...(b.repairCostAnnualCents !== undefined && { repairCostAnnual: big(b.repairCostAnnualCents) }),
    ...(b.fuelCostAnnualCents !== undefined && { fuelCostAnnual: big(b.fuelCostAnnualCents) }),
    ...(b.insuranceCostAnnualCents !== undefined && { insuranceCostAnnual: big(b.insuranceCostAnnualCents) }),
    ...(b.utilizationPct !== undefined && { utilizationPct: b.utilizationPct }),
    ...(b.downtimeDaysAnnual !== undefined && { downtimeDaysAnnual: b.downtimeDaysAnnual }),
    ...(isCreate && b.salvageValueCents === undefined && { salvageValue: 0n }),
  };
}

export function registerAssetRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string }; Querystring: { asOf?: string } }>(
    "/companies/:companyId/assets",
    async (req) => {
      const asOf = req.query.asOf ? new Date(req.query.asOf) : await companyAsOf(req.params.companyId);
      const assets = await prisma.asset.findMany({
        where: { companyId: req.params.companyId },
        orderBy: [{ category: "asc" }, { purchaseDate: "desc" }],
        include: { liabilities: { select: { id: true, name: true, currentBalance: true } } },
      });
      const values = valueAssets(assets.map(toEngineAsset), asOf);
      const byId = new Map(values.map((v) => [v.assetId, v]));
      return {
        asOf,
        assets: assets.map((a) => ({
          ...shape(a),
          financedBy: a.liabilities.map((l) => ({
            id: l.id,
            name: l.name,
            balanceCents: n(l.currentBalance),
          })),
          valuation: byId.get(a.id),
        })),
        totalPurchaseCostCents: assets.reduce((s, a) => s + n(a.purchaseCost), 0),
        totalCurrentValueCents: values.reduce((s, v) => s + v.currentValueCents, 0),
      };
    }
  );

  app.post<{ Params: { companyId: string }; Body: Required<Pick<AssetBody, "name" | "category" | "purchaseDate" | "purchaseCostCents">> & AssetBody }>(
    "/companies/:companyId/assets",
    { schema: { body: createBody } },
    async (req, reply) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const asset = await prisma.asset.create({
        data: {
          companyId: req.params.companyId,
          name: req.body.name,
          category: req.body.category,
          purchaseDate: new Date(req.body.purchaseDate),
          purchaseCost: BigInt(req.body.purchaseCostCents),
          ...writeData(req.body, true),
        },
      });
      return reply.code(201).send(shape(asset));
    }
  );

  app.put<{ Params: { companyId: string; assetId: string }; Body: AssetBody }>(
    "/companies/:companyId/assets/:assetId",
    { schema: { body: assetBody } },
    async (req) => {
      const asset = await prisma.asset.update({
        where: { id: req.params.assetId, companyId: req.params.companyId },
        data: writeData(req.body, false),
      });
      return shape(asset);
    }
  );

  app.delete<{ Params: { companyId: string; assetId: string } }>(
    "/companies/:companyId/assets/:assetId",
    async (req) => {
      await prisma.asset.delete({
        where: { id: req.params.assetId, companyId: req.params.companyId },
      });
      return { ok: true };
    }
  );
}
