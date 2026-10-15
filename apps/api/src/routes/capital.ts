import type { FastifyInstance } from "fastify";
import { purchaseAnalysis, repairVsReplace, type PurchaseInput, type RepairReplaceInput } from "@plumb/engine";
import { capitalDefaults, crewExpansionFor, fleet, hireFor, type CrewExpansionScenario, type HireScenario } from "../analytics/capital.js";
import { loadLedger } from "../analytics/ledger.js";
import { completeYears, customerRevenue, serviceLines } from "../analytics/operations.js";
import * as scen from "../analytics/scenarios.js";
import { exitReadiness, valuation } from "../analytics/valuation.js";
import { companyAsOf } from "../snapshot.js";

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

const scenarioBody = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: ["lose_customer", "exit_line", "grow_line", "materials", "add_pm", "add_location", "payment_delay"] },
    customer: { type: "string", maxLength: 200 },
    line: { type: "string", maxLength: 200 },
    pct: { type: "number", minimum: 0, maximum: 500 },
    contributionMarginPct: rate,
    amountCents: money,
    days: { type: "integer", minimum: 1, maximum: 365 },
    annualSalaryCents: money,
    burdenPct: rate,
    revenueLiftPct: rate,
    annualFixedCostCents: money,
    startupCostCents: money,
    financedPct: rate,
    ratePct: rate,
    termMonths: { type: "integer", minimum: 1, maximum: 360 },
    year1RevenueCents: money,
    grossMarginPct: rate,
  },
} as const;

export function registerScenarioV2Routes(app: FastifyInstance) {
  app.get<P>("/companies/:companyId/valuation", async (req, reply) => {
    const ledger = await loadLedger(req.params.companyId);
    try {
      const [v, r] = await Promise.all([valuation(req.params.companyId, ledger), exitReadiness(req.params.companyId, ledger)]);
      return { valuation: v, readiness: r };
    } catch (e: any) {
      return reply.code(422).send({ error: "Unprocessable", message: e.message });
    }
  });

  // What the scenario pickers can choose from.
  app.get<P>("/companies/:companyId/what-if/options", async (req) => {
    const id = req.params.companyId;
    const ledger = await loadLedger(id);
    const asOf = await companyAsOf(id);
    const years = completeYears(ledger, asOf);
    const [customers, d] = await Promise.all([customerRevenue(id, ledger), capitalDefaults(id, ledger)]);
    const sl = serviceLines(ledger, years.slice(-1));
    return {
      year: years.at(-1) ?? null,
      customers: customers.slice(0, 15).map((c) => ({ name: c.name, sharePct: c.sharePct })),
      lines: sl.lines.map((l) => l.line),
      grossMarginPct: d.grossMarginPct,
    };
  });

  app.post<P & { Body: Record<string, any> }>("/companies/:companyId/what-if", { schema: { body: scenarioBody } }, async (req, reply) => {
    const id = req.params.companyId;
    const b = req.body;
    const ledger = await loadLedger(id);
    const cm = b.contributionMarginPct !== undefined ? { contributionMarginPct: b.contributionMarginPct } : {};
    try {
      switch (b.kind) {
        case "lose_customer":
          return await scen.loseCustomerShare(id, ledger, b.customer ?? "", b.pct ?? 100, cm);
        case "exit_line":
          return await scen.exitServiceLine(id, ledger, b.line ?? "", cm);
        case "grow_line":
          return await scen.growServiceLine(id, ledger, b.line ?? "", b.pct ?? 10, cm);
        case "materials":
          return await scen.materialsIncrease(id, ledger, b.pct ?? 10);
        case "add_pm":
          return await scen.addPM(id, ledger, { annualSalaryCents: b.annualSalaryCents ?? 0, burdenPct: b.burdenPct, revenueLiftPct: b.revenueLiftPct });
        case "add_location":
          return await scen.addLocation(id, ledger, {
            annualFixedCostCents: b.annualFixedCostCents ?? 0,
            startupCostCents: b.startupCostCents ?? 0,
            financedPct: b.financedPct ?? 0,
            ratePct: b.ratePct ?? 0,
            termMonths: b.termMonths ?? 60,
            year1RevenueCents: b.year1RevenueCents ?? 0,
            grossMarginPct: b.grossMarginPct,
          });
        case "payment_delay":
          return await scen.paymentDelay(id, b.amountCents ?? 0, b.days ?? 30);
      }
    } catch (e: any) {
      return reply.code(422).send({ error: "Unprocessable", message: e.message });
    }
  });
}
