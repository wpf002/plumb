import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { expandServices, summarizeServices } from "@plumb/engine";
import { addDays } from "@plumb/shared";
import { n, toEngineService } from "../map.js";

const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;
const STATUSES = ["ACTIVE", "PAUSED", "ENDED"] as const;

interface ServiceBody {
  name?: string;
  client?: string;
  payerId?: string | null;
  amountCents?: number;
  billingFrequency?: (typeof FREQUENCIES)[number];
  netDays?: number;
  startDate?: string;
  endDate?: string | null;
  renewalDate?: string | null;
  autoRenew?: boolean;
  status?: (typeof STATUSES)[number];
}

const serviceBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    client: { type: "string", minLength: 1, maxLength: 160 },
    payerId: { type: "string", nullable: true },
    amountCents: { type: "integer", minimum: 0 },
    billingFrequency: { type: "string", enum: [...FREQUENCIES] },
    netDays: { type: "integer", minimum: 0, maximum: 180 },
    startDate: { type: "string", format: "date-time" },
    endDate: { type: "string", format: "date-time", nullable: true },
    renewalDate: { type: "string", format: "date-time", nullable: true },
    autoRenew: { type: "boolean" },
    status: { type: "string", enum: [...STATUSES] },
  },
} as const;

const shape = (c: any) => ({
  id: c.id,
  name: c.name,
  client: c.client,
  payerId: c.payerId,
  amountCents: n(c.amount),
  billingFrequency: c.billingFrequency,
  netDays: c.netDays,
  startDate: c.startDate,
  endDate: c.endDate,
  renewalDate: c.renewalDate,
  autoRenew: c.autoRenew,
  status: c.status,
});

const d = (v: any) => (v === null || v === undefined ? v : new Date(v));

function writeData(b: ServiceBody) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.client !== undefined && { client: b.client }),
    ...(b.payerId !== undefined && { payerId: b.payerId || null }),
    ...(b.amountCents !== undefined && { amount: BigInt(b.amountCents) }),
    ...(b.billingFrequency !== undefined && { billingFrequency: b.billingFrequency }),
    ...(b.netDays !== undefined && { netDays: b.netDays }),
    ...(b.startDate !== undefined && { startDate: new Date(b.startDate) }),
    ...(b.endDate !== undefined && { endDate: d(b.endDate) }),
    ...(b.renewalDate !== undefined && { renewalDate: d(b.renewalDate) }),
    ...(b.autoRenew !== undefined && { autoRenew: b.autoRenew }),
    ...(b.status !== undefined && { status: b.status }),
  };
}

export function registerServiceRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/service-contracts",
    async (req) => {
      const asOf = new Date();
      const rows = await prisma.serviceContract.findMany({
        where: { companyId: req.params.companyId },
        orderBy: [{ status: "asc" }, { amount: "desc" }],
        include: { payer: { select: { id: true, name: true, typicalDaysLate: true } } },
      });
      const engineRows = rows.map(toEngineService);
      return {
        asOf,
        contracts: rows.map((c) => ({ ...shape(c), payer: c.payer })),
        summary: summarizeServices(engineRows, asOf),
        // Next 60 days of recurring inflow, so the page shows the effect.
        upcoming: expandServices(engineRows, asOf, addDays(asOf, 60)).map((e) => ({
          label: e.label,
          amountCents: e.amountCents,
          expectedDate: e.expectedDate,
          originId: e.originId,
        })),
      };
    }
  );

  app.post<{ Params: { companyId: string }; Body: ServiceBody & { name: string; client: string } }>(
    "/companies/:companyId/service-contracts",
    { schema: { body: { ...serviceBody, required: ["name", "client", "amountCents", "startDate"] } } },
    async (req, reply) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const c = await prisma.serviceContract.create({
        data: {
          companyId: req.params.companyId,
          name: req.body.name,
          client: req.body.client,
          amount: BigInt(req.body.amountCents ?? 0),
          startDate: new Date(req.body.startDate!),
          ...writeData(req.body),
        },
      });
      return reply.code(201).send(shape(c));
    }
  );

  app.put<{ Params: { companyId: string; contractId: string }; Body: ServiceBody }>(
    "/companies/:companyId/service-contracts/:contractId",
    { schema: { body: serviceBody } },
    async (req) => {
      const c = await prisma.serviceContract.update({
        where: { id: req.params.contractId, companyId: req.params.companyId },
        data: writeData(req.body),
      });
      return shape(c);
    }
  );

  app.delete<{ Params: { companyId: string; contractId: string } }>(
    "/companies/:companyId/service-contracts/:contractId",
    async (req) => {
      await prisma.serviceContract.delete({
        where: { id: req.params.contractId, companyId: req.params.companyId },
      });
      return { ok: true };
    }
  );
}
