import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { amortizationSchedule, monthlyDebtServiceCents, summarizeLiability } from "@plumb/engine";
import { addDays } from "@plumb/shared";
import { n, toEngineLiability } from "../map.js";
import { companyAsOf } from "../snapshot.js";

export const LIABILITY_KINDS = [
  "CREDIT_CARD",
  "LINE_OF_CREDIT",
  "TERM_LOAN",
  "SBA_LOAN",
  "MORTGAGE",
  "EQUIPMENT_LEASE",
  "BUILDING_LEASE",
  "OTHER",
] as const;

export const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;

const liabilityBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    lender: { type: "string", maxLength: 160, nullable: true },
    kind: { type: "string", enum: [...LIABILITY_KINDS] },
    originalPrincipalCents: { type: "integer", minimum: 0 },
    currentBalanceCents: { type: "integer", minimum: 0 },
    creditLimitCents: { type: "integer", minimum: 0, nullable: true },
    interestRatePct: { type: "number", minimum: 0, maximum: 100 },
    paymentAmountCents: { type: "integer", minimum: 0 },
    paymentFrequency: { type: "string", enum: [...FREQUENCIES] },
    nextPaymentDate: { type: "string", format: "date-time", nullable: true },
    payoffDate: { type: "string", format: "date-time", nullable: true },
    termMonths: { type: "integer", minimum: 1, maximum: 1200, nullable: true },
    endDate: { type: "string", format: "date-time", nullable: true },
    renewalTerms: { type: "string", maxLength: 500, nullable: true },
    assetId: { type: "string", nullable: true },
    active: { type: "boolean" },
  },
} as const;

const createBody = {
  ...liabilityBody,
  required: ["name", "kind", "currentBalanceCents"],
} as const;

interface LiabilityBody {
  name?: string;
  lender?: string | null;
  kind?: (typeof LIABILITY_KINDS)[number];
  originalPrincipalCents?: number;
  currentBalanceCents?: number;
  creditLimitCents?: number | null;
  interestRatePct?: number;
  paymentAmountCents?: number;
  paymentFrequency?: (typeof FREQUENCIES)[number];
  nextPaymentDate?: string | null;
  payoffDate?: string | null;
  termMonths?: number | null;
  endDate?: string | null;
  renewalTerms?: string | null;
  assetId?: string | null;
  active?: boolean;
}

const shape = (l: any) => ({
  id: l.id,
  name: l.name,
  lender: l.lender,
  kind: l.kind,
  originalPrincipalCents: n(l.originalPrincipal),
  currentBalanceCents: n(l.currentBalance),
  creditLimitCents: l.creditLimit === null ? null : n(l.creditLimit),
  interestRatePct: l.interestRatePct,
  paymentAmountCents: n(l.paymentAmount),
  paymentFrequency: l.paymentFrequency,
  nextPaymentDate: l.nextPaymentDate,
  payoffDate: l.payoffDate,
  termMonths: l.termMonths,
  endDate: l.endDate,
  renewalTerms: l.renewalTerms,
  assetId: l.assetId,
  active: l.active,
});

const d = (v: any) => (v === null || v === undefined ? v : new Date(v));

function writeData(b: LiabilityBody) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.lender !== undefined && { lender: b.lender }),
    ...(b.kind !== undefined && { kind: b.kind }),
    ...(b.originalPrincipalCents !== undefined && {
      originalPrincipal: BigInt(b.originalPrincipalCents),
    }),
    ...(b.currentBalanceCents !== undefined && { currentBalance: BigInt(b.currentBalanceCents) }),
    ...(b.creditLimitCents !== undefined && {
      creditLimit: b.creditLimitCents === null ? null : BigInt(b.creditLimitCents),
    }),
    ...(b.interestRatePct !== undefined && { interestRatePct: b.interestRatePct }),
    ...(b.paymentAmountCents !== undefined && { paymentAmount: BigInt(b.paymentAmountCents) }),
    ...(b.paymentFrequency !== undefined && { paymentFrequency: b.paymentFrequency }),
    ...(b.nextPaymentDate !== undefined && { nextPaymentDate: d(b.nextPaymentDate) }),
    ...(b.payoffDate !== undefined && { payoffDate: d(b.payoffDate) }),
    ...(b.termMonths !== undefined && { termMonths: b.termMonths }),
    ...(b.endDate !== undefined && { endDate: d(b.endDate) }),
    ...(b.renewalTerms !== undefined && { renewalTerms: b.renewalTerms }),
    ...(b.assetId !== undefined && { assetId: b.assetId }),
    ...(b.active !== undefined && { active: b.active }),
  };
}

export function registerLiabilityRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string }; Querystring: { horizonDays?: number } }>(
    "/companies/:companyId/liabilities",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { horizonDays: { type: "integer", minimum: 30, maximum: 3650 } },
        },
      },
    },
    async (req) => {
      const asOf = await companyAsOf(req.params.companyId);
      const horizonEnd = addDays(asOf, req.query.horizonDays ?? 365 * 5);
      const rows = await prisma.liability.findMany({
        where: { companyId: req.params.companyId },
        orderBy: [{ active: "desc" }, { kind: "asc" }, { name: "asc" }],
        include: { asset: { select: { id: true, name: true } } },
      });
      const engineRows = rows.map(toEngineLiability);
      const summaries = new Map(
        engineRows.map((l) => [l.id, summarizeLiability(l, asOf, horizonEnd)])
      );
      return {
        asOf,
        liabilities: rows.map((l) => ({
          ...shape(l),
          asset: l.asset,
          summary: summaries.get(l.id),
        })),
        totalBalanceCents: rows
          .filter((l) => l.active)
          .reduce((s, l) => s + n(l.currentBalance), 0),
        monthlyDebtServiceCents: monthlyDebtServiceCents(engineRows),
      };
    }
  );

  // The individual payments a liability will generate — the same expansion the
  // cash forecast consumes, exposed so an owner can check the math.
  app.get<{
    Params: { companyId: string; liabilityId: string };
    Querystring: { horizonDays?: number };
  }>(
    "/companies/:companyId/liabilities/:liabilityId/schedule",
    async (req) => {
      const asOf = await companyAsOf(req.params.companyId);
      const row = await prisma.liability.findFirstOrThrow({
        where: { id: req.params.liabilityId, companyId: req.params.companyId },
      });
      const payments = amortizationSchedule(
        toEngineLiability(row),
        asOf,
        addDays(asOf, req.query.horizonDays ?? 365 * 5)
      );
      return { liabilityId: row.id, name: row.name, payments };
    }
  );

  app.post<{ Params: { companyId: string }; Body: Required<Pick<LiabilityBody, "name" | "kind" | "currentBalanceCents">> & LiabilityBody }>(
    "/companies/:companyId/liabilities",
    { schema: { body: createBody } },
    async (req, reply) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const row = await prisma.liability.create({
        data: {
          companyId: req.params.companyId,
          name: req.body.name,
          kind: req.body.kind,
          currentBalance: BigInt(req.body.currentBalanceCents),
          ...writeData(req.body),
        },
      });
      return reply.code(201).send(shape(row));
    }
  );

  app.put<{ Params: { companyId: string; liabilityId: string }; Body: LiabilityBody }>(
    "/companies/:companyId/liabilities/:liabilityId",
    { schema: { body: liabilityBody } },
    async (req) => {
      const row = await prisma.liability.update({
        where: { id: req.params.liabilityId, companyId: req.params.companyId },
        data: writeData(req.body),
      });
      return shape(row);
    }
  );

  app.delete<{ Params: { companyId: string; liabilityId: string } }>(
    "/companies/:companyId/liabilities/:liabilityId",
    async (req) => {
      await prisma.liability.delete({
        where: { id: req.params.liabilityId, companyId: req.params.companyId },
      });
      return { ok: true };
    }
  );
}
