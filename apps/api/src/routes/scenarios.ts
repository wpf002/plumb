import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { applyScenario, compareBuyTiming, type Scenario } from "@plumb/engine";
import { addDays } from "@plumb/shared";
import { n } from "../map.js";
import { loadWorld } from "../snapshot.js";

const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;

// One schema per scenario kind, discriminated on `kind`, so a malformed
// "what if" is rejected at the edge rather than producing a plausible number.
const scenarioSchema = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: {
      type: "string",
      enum: [
        "DELAY_PROJECT",
        "DELAY_MILESTONE",
        "PAYER_LATE",
        "LOSE_INCOME",
        "NEW_LOAN",
        "BUY_ASSET",
        "HIRE",
        "REVENUE_CHANGE",
      ],
    },
    projectId: { type: "string" },
    milestoneId: { type: "string" },
    originId: { type: "string" },
    days: { type: "integer", minimum: -365, maximum: 365 },
    pct: { type: "number", minimum: -100, maximum: 200 },
    principalCents: { type: "integer", minimum: 0 },
    ratePct: { type: "number", minimum: 0, maximum: 100 },
    paymentCents: { type: "integer", minimum: 0 },
    frequency: { type: "string", enum: [...FREQUENCIES] },
    startDate: { type: "string", format: "date-time" },
    costCents: { type: "integer", minimum: 0 },
    downPaymentCents: { type: "integer", minimum: 0 },
    purchaseDate: { type: "string", format: "date-time" },
    monthlyCostCents: { type: "integer", minimum: 0 },
    count: { type: "integer", minimum: 1, maximum: 50 },
    financed: {
      type: "object",
      required: ["ratePct", "paymentCents", "frequency"],
      additionalProperties: false,
      properties: {
        ratePct: { type: "number", minimum: 0, maximum: 100 },
        paymentCents: { type: "integer", minimum: 0 },
        frequency: { type: "string", enum: [...FREQUENCIES] },
      },
    },
  },
} as const;

/** Dates arrive as ISO strings; the engine works in Dates. */
function hydrate(body: any): Scenario {
  return {
    ...body,
    ...(body.startDate ? { startDate: new Date(body.startDate) } : {}),
    ...(body.purchaseDate ? { purchaseDate: new Date(body.purchaseDate) } : {}),
  } as Scenario;
}

export function registerScenarioRoutes(app: FastifyInstance) {
  // Run a "what if" against the live picture. Nothing is written — the scenario
  // is a transform over the same world the dashboard is showing.
  app.post<{
    Params: { companyId: string };
    Querystring: { horizon?: number };
    Body: any;
  }>(
    "/companies/:companyId/scenarios",
    {
      schema: {
        body: scenarioSchema,
        querystring: {
          type: "object",
          properties: { horizon: { type: "integer", minimum: 30, maximum: 365 } },
        },
      },
    },
    async (req) => {
      const { world } = await loadWorld(req.params.companyId, {
        horizonDays: req.query.horizon ?? 180,
      });
      return applyScenario(world, hydrate(req.body));
    }
  );

  // Buy now or wait? The same purchase at several timings, compared on how
  // close each one takes the business to running out of cash.
  app.post<{
    Params: { companyId: string };
    Body: {
      costCents: number;
      downPaymentCents?: number;
      financed?: { ratePct: number; paymentCents: number; frequency: (typeof FREQUENCIES)[number] };
      waitMonths?: number[];
      assetId?: string;
    };
  }>(
    "/companies/:companyId/scenarios/buy-timing",
    {
      schema: {
        body: {
          type: "object",
          required: ["costCents"],
          additionalProperties: false,
          properties: {
            costCents: { type: "integer", minimum: 1 },
            downPaymentCents: { type: "integer", minimum: 0 },
            assetId: { type: "string" },
            waitMonths: {
              type: "array",
              maxItems: 4,
              items: { type: "integer", minimum: 0, maximum: 24 },
            },
            financed: scenarioSchema.properties.financed,
          },
        },
      },
    },
    async (req) => {
      const { world } = await loadWorld(req.params.companyId, { horizonDays: 365 });
      const waits = req.body.waitMonths?.length ? req.body.waitMonths : [0, 3, 6];

      const comparison = compareBuyTiming(
        world,
        {
          costCents: req.body.costCents,
          downPaymentCents: req.body.downPaymentCents,
          financed: req.body.financed,
        },
        waits.map((m) => ({
          label: m === 0 ? "Buy now" : `Wait ${m} month${m === 1 ? "" : "s"}`,
          purchaseDate: addDays(world.asOf, Math.round(m * 30.44)),
        }))
      );

      return {
        ...comparison,
        // Slim the payload: the caller needs the verdict, not two full series.
        options: comparison.options.map((o) => ({
          label: o.label,
          purchaseDate: o.purchaseDate,
          minBalanceCents: o.result.result.base.minBalanceCents,
          minBalanceDate: o.result.result.base.minBalanceDate,
          endingBalanceCents: o.result.result.base.endingBalanceCents,
          breachDate: o.result.result.base.firstBreachDate,
          stressBreachDate: o.result.result.stress.firstBreachDate,
        })),
      };
    }
  );

  // The things this company can ask "what if" about, so the UI never has to
  // guess at ids.
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/scenarios/options",
    async (req) => {
      const companyId = req.params.companyId;
      const [projects, expenses, assets] = await Promise.all([
        prisma.project.findMany({
          where: { companyId, status: { in: ["ACTIVE", "AWARDED"] } },
          select: { id: true, name: true, contractValue: true },
        }),
        prisma.recurringExpense.findMany({
          where: { companyId, active: true },
          select: { id: true, name: true },
        }),
        prisma.asset.findMany({
          where: { companyId },
          select: { id: true, name: true, purchaseCost: true },
        }),
      ]);
      return {
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          contractValueCents: n(p.contractValue),
        })),
        recurringExpenses: expenses,
        assets: assets.map((a) => ({
          id: a.id,
          name: a.name,
          purchaseCostCents: n(a.purchaseCost),
        })),
      };
    }
  );
}
