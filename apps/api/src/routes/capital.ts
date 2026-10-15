import type { FastifyInstance } from "fastify";
import { purchaseAnalysis, repairVsReplace, type PurchaseInput, type RepairReplaceInput } from "@plumb/engine";
import { capitalDefaults, crewExpansionFor, fleet, hireFor, type CrewExpansionScenario, type HireScenario } from "../analytics/capital.js";
import { loadLedger } from "../analytics/ledger.js";

type P = { Params: { companyId: string } };

const money = { type: "integer", minimum: 0 } as const;
const rate = { type: "number", minimum: 0, maximum: 100 } as const;

const purchaseBody = {
  type: "object",
  additionalProperties: false,
  required: ["priceCents", "downPct", "ratePct", "termMonths", "monthlyRevenueCents", "monthlyOperatingCents", "usefulLifeMonths"],
  properties: {
    priceCents: money,
    downPct: rate,
    ratePct: rate,
    termMonths: { type: "integer", minimum: 1, maximum: 360 },
    monthlyRevenueCents: money,
    grossMarginPct: rate,
    monthlyOperatingCents: money,
    usefulLifeMonths: { type: "integer", minimum: 1, maximum: 600 },
  },
} as const;

const repairBody = {
  type: "object",
  additionalProperties: false,
  required: ["annualRepairCents", "annualMaintenanceCents", "downtimeDaysAnnual", "downtimeCostPerDayCents", "marketValueCents", "replacementCostCents", "newUsefulLifeMonths", "newSalvagePct", "financeRatePct"],
  properties: {
    annualRepairCents: money,
    annualMaintenanceCents: money,
    downtimeDaysAnnual: { type: "integer", minimum: 0, maximum: 366 },
    downtimeCostPerDayCents: money,
    marketValueCents: money,
    replacementCostCents: money,
    newUsefulLifeMonths: { type: "integer", minimum: 12, maximum: 600 },
    newSalvagePct: rate,
    financeRatePct: rate,
  },
} as const;

const hireBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    count: { type: "integer", minimum: 1, maximum: 50 },
    annualWageCents: money,
    payrollTaxPct: rate,
    workersCompPct: rate,
    benefitsMonthlyCents: money,
    equipmentMonthlyCents: money,
    vehicleMonthlyCents: money,
    toolsMonthlyCents: money,
    grossMarginPct: rate,
  },
} as const;

const crewBody = {
  type: "object",
  additionalProperties: false,
  required: ["equipmentCents", "downPct", "ratePct", "termMonths", "insuranceAnnualCents", "fuelMaintenanceAnnualCents", "ramp"],
  properties: {
    equipmentCents: money,
    downPct: rate,
    ratePct: rate,
    termMonths: { type: "integer", minimum: 1, maximum: 360 },
    insuranceAnnualCents: money,
    fuelMaintenanceAnnualCents: money,
    ramp: { type: "array", minItems: 1, maxItems: 5, items: { type: "number", minimum: 0, maximum: 2 } },
    matureCapacityCents: money,
    grossMarginPct: rate,
    burdenedPayrollAnnualCents: money,
    billingLagMonths: { type: "number", minimum: 0, maximum: 12 },
  },
} as const;

export function registerCapitalRoutes(app: FastifyInstance) {
  app.get<P>("/companies/:companyId/capital/fleet", async (req) => fleet(req.params.companyId));
  app.get<P>("/companies/:companyId/capital/defaults", async (req) => capitalDefaults(req.params.companyId, await loadLedger(req.params.companyId)));

  app.post<P & { Body: Omit<PurchaseInput, "grossMarginPct"> & { grossMarginPct?: number } }>(
    "/companies/:companyId/capital/purchase",
    { schema: { body: purchaseBody } },
    async (req) => {
      const d = await capitalDefaults(req.params.companyId, await loadLedger(req.params.companyId));
      return purchaseAnalysis({ ...req.body, grossMarginPct: req.body.grossMarginPct ?? d.grossMarginPct ?? 0, cashCents: d.cashCents });
    }
  );
  app.post<P & { Body: RepairReplaceInput }>("/companies/:companyId/capital/repair-replace", { schema: { body: repairBody } }, async (req) => repairVsReplace(req.body));
  app.post<P & { Body: HireScenario }>("/companies/:companyId/capital/hire", { schema: { body: hireBody } }, async (req) =>
    hireFor(req.params.companyId, await loadLedger(req.params.companyId), req.body)
  );
  app.post<P & { Body: CrewExpansionScenario }>("/companies/:companyId/capital/crew", { schema: { body: crewBody } }, async (req) =>
    crewExpansionFor(req.params.companyId, await loadLedger(req.params.companyId), req.body)
  );
}
