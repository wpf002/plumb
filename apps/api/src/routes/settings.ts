import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { n } from "../map.js";
import { getPlaid } from "../plaid.js";

export const TRADES = [
  "ELECTRICAL",
  "HVAC",
  "PLUMBING",
  "ROOFING",
  "MASONRY",
  "DRYWALL",
  "CONCRETE",
  "MECHANICAL",
  "LANDSCAPING",
  "GENERAL",
  "OTHER",
] as const;

export const REVENUE_MODELS = ["PROJECT", "RECURRING", "BOTH"] as const;

const settingsBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    trade: { type: "string", enum: [...TRADES] },
    employeeCount: { type: "integer", minimum: 0, maximum: 100000 },
    revenueModel: { type: "string", enum: [...REVENUE_MODELS] },
    monthlyLaborHours: { type: "integer", minimum: 0, maximum: 100000 },
    cashSafetyThresholdCents: { type: "integer", minimum: 0 },
    portfolioTargetMarginPct: { type: "number", minimum: -100, maximum: 100 },
    defaultRetainagePct: { type: "number", minimum: 0, maximum: 100 },
    setupCompleted: { type: "boolean" },
  },
} as const;

const openingCashBodySchema = {
  type: "object",
  required: ["balanceCents"],
  additionalProperties: false,
  properties: { balanceCents: { type: "integer", minimum: 0 } },
} as const;

const plaidBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: { publicToken: { type: "string", minLength: 1, maxLength: 512 } },
} as const;

async function currentSettings(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const snap = await prisma.cashSnapshot.findFirst({
    where: { companyId },
    orderBy: { asOf: "desc" },
  });
  return {
    company: {
      id: c.id,
      name: c.name,
      trade: c.trade,
      employeeCount: c.employeeCount,
      revenueModel: c.revenueModel,
      setupCompletedAt: c.setupCompletedAt,
      monthlyLaborHours: c.monthlyLaborHours,
      cashSafetyThresholdCents: n(c.cashSafetyThreshold),
      portfolioTargetMarginPct: c.portfolioTargetMargin,
      defaultRetainagePct: c.defaultRetainagePct,
    },
    openingCash: snap
      ? { balanceCents: n(snap.balance), asOf: snap.asOf, source: snap.source }
      : null,
  };
}

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/settings",
    async (req) => currentSettings(req.params.companyId)
  );

  app.put<{
    Params: { companyId: string };
    Body: {
      name?: string;
      trade?: (typeof TRADES)[number];
      employeeCount?: number;
      revenueModel?: (typeof REVENUE_MODELS)[number];
      monthlyLaborHours?: number;
      cashSafetyThresholdCents?: number;
      portfolioTargetMarginPct?: number;
      defaultRetainagePct?: number;
      setupCompleted?: boolean;
    };
  }>(
    "/companies/:companyId/settings",
    { schema: { body: settingsBodySchema } },
    async (req) => {
      const b = req.body;
      await prisma.company.update({
        where: { id: req.params.companyId },
        data: {
          ...(b.name !== undefined && { name: b.name }),
          ...(b.trade !== undefined && { trade: b.trade }),
          ...(b.employeeCount !== undefined && { employeeCount: b.employeeCount }),
          ...(b.revenueModel !== undefined && { revenueModel: b.revenueModel }),
          ...(b.setupCompleted !== undefined && {
            setupCompletedAt: b.setupCompleted ? new Date() : null,
          }),
          ...(b.monthlyLaborHours !== undefined && { monthlyLaborHours: b.monthlyLaborHours }),
          ...(b.cashSafetyThresholdCents !== undefined && {
            cashSafetyThreshold: BigInt(b.cashSafetyThresholdCents),
          }),
          ...(b.portfolioTargetMarginPct !== undefined && {
            portfolioTargetMargin: b.portfolioTargetMarginPct,
          }),
          ...(b.defaultRetainagePct !== undefined && { defaultRetainagePct: b.defaultRetainagePct }),
        },
      });
      return currentSettings(req.params.companyId);
    }
  );

  // Manually set opening cash (bank balance the owner types in).
  app.post<{ Params: { companyId: string }; Body: { balanceCents: number } }>(
    "/companies/:companyId/opening-cash",
    { schema: { body: openingCashBodySchema } },
    async (req) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const snap = await prisma.cashSnapshot.create({
        data: {
          companyId: req.params.companyId,
          asOf: new Date(),
          balance: BigInt(req.body.balanceCents),
          source: "MANUAL",
        },
      });
      return { balanceCents: n(snap.balance), asOf: snap.asOf, source: snap.source };
    }
  );

  // Set opening cash from a bank feed (Plaid). Dry-run without credentials:
  // simulates a connected bank and records a sandbox balance so onboarding works
  // end-to-end. With a publicToken and live keys, exchanges and reads the real
  // depository balance.
  app.post<{ Params: { companyId: string }; Body: { publicToken?: string } }>(
    "/companies/:companyId/opening-cash/plaid",
    { schema: { body: plaidBodySchema } },
    async (req) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const plaid = getPlaid();

      let accessToken = "access-sandbox-dry-run";
      if (plaid.live && req.body.publicToken) {
        accessToken = (await plaid.exchangePublicToken(req.body.publicToken)).accessToken;
      }
      const balanceCents = await plaid.getBalanceCents(accessToken);
      const source = plaid.live ? "PLAID" : "PLAID_SANDBOX";

      const snap = await prisma.cashSnapshot.create({
        data: {
          companyId: req.params.companyId,
          asOf: new Date(),
          balance: BigInt(balanceCents),
          source,
        },
      });
      return {
        balanceCents: n(snap.balance),
        asOf: snap.asOf,
        source: snap.source,
        live: plaid.live,
      };
    }
  );
}
