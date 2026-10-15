import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { expandSchedules, summarizeObligations } from "@plumb/engine";
import { addDays, sourceKeyFor } from "@plumb/shared";
import { n, toEngineLiability, toEngineRecurring } from "../map.js";
import { FREQUENCIES } from "./liabilities.js";
import { companyAsOf } from "../snapshot.js";

// Overhead is deliberately narrow: the ordinary costs of opening the doors.
// Anything with a balance and an interest rate belongs in Liability instead.
export const OVERHEAD_CATEGORIES = [
  "OVERHEAD",
  "PAYROLL",
  "INSURANCE",
  "TAX",
  "VENDOR_BILL",
] as const;

interface RecurringBody {
  name?: string;
  category?: (typeof OVERHEAD_CATEGORIES)[number];
  amountCents?: number;
  frequency?: (typeof FREQUENCIES)[number];
  startDate?: string;
  endDate?: string | null;
  matchKeyword?: string | null;
  active?: boolean;
}

const recurringBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    category: { type: "string", enum: [...OVERHEAD_CATEGORIES] },
    amountCents: { type: "integer", minimum: 0 },
    frequency: { type: "string", enum: [...FREQUENCIES] },
    startDate: { type: "string", format: "date-time" },
    endDate: { type: "string", format: "date-time", nullable: true },
    matchKeyword: { type: "string", maxLength: 120, nullable: true },
    active: { type: "boolean" },
  },
} as const;

const createBody = {
  ...recurringBody,
  required: ["name", "amountCents", "startDate"],
} as const;

const shape = (r: any) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  amountCents: n(r.amount),
  frequency: r.frequency,
  startDate: r.startDate,
  endDate: r.endDate,
  matchKeyword: r.matchKeyword,
  active: r.active,
});

function writeData(b: RecurringBody) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.category !== undefined && { category: b.category }),
    ...(b.amountCents !== undefined && { amount: BigInt(b.amountCents) }),
    ...(b.frequency !== undefined && { frequency: b.frequency }),
    ...(b.startDate !== undefined && { startDate: new Date(b.startDate) }),
    ...(b.endDate !== undefined && { endDate: b.endDate === null ? null : new Date(b.endDate) }),
    ...(b.matchKeyword !== undefined && { matchKeyword: b.matchKeyword }),
    ...(b.active !== undefined && { active: b.active }),
  };
}

export function registerRecurringRoutes(app: FastifyInstance) {
  // Recurring overhead plus the obligation rollup — "what does it cost to open
  // the doors each month", a number most owners in this segment can't state.
  app.get<{ Params: { companyId: string }; Querystring: { horizonDays?: number } }>(
    "/companies/:companyId/recurring-expenses",
    async (req) => {
      const companyId = req.params.companyId;
      const asOf = await companyAsOf(companyId);
      const horizonDays = req.query.horizonDays ?? 365;

      const [rows, liabilityRows, settled] = await Promise.all([
        prisma.recurringExpense.findMany({
          where: { companyId },
          orderBy: [{ active: "desc" }, { name: "asc" }],
        }),
        prisma.liability.findMany({ where: { companyId, active: true } }),
        prisma.cashEvent.findMany({
          where: { companyId, sourceKey: { not: null } },
          select: { sourceKey: true },
        }),
      ]);

      const overheads = rows.map(toEngineRecurring);
      const liabilities = liabilityRows.map(toEngineLiability);
      const projected = expandSchedules({
        asOf,
        horizonEnd: addDays(asOf, horizonDays),
        liabilities,
        overheads,
        supersededKeys: settled.map((s) => s.sourceKey!).filter(Boolean),
      });

      return {
        asOf,
        expenses: rows.map(shape),
        obligations: summarizeObligations(overheads, liabilities),
        // The next month of scheduled outflows, so the page shows the effect
        // rather than just the entries.
        upcoming: projected
          .filter((p) => p.expectedDate <= addDays(asOf, 30))
          .sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime())
          .map((p) => ({
            label: p.label,
            origin: p.origin,
            originId: p.originId,
            category: p.category,
            amountCents: p.amountCents,
            expectedDate: p.expectedDate,
            sourceKey: p.sourceKey,
          })),
      };
    }
  );

  app.post<{ Params: { companyId: string }; Body: RecurringBody & { name: string } }>(
    "/companies/:companyId/recurring-expenses",
    { schema: { body: createBody } },
    async (req, reply) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const row = await prisma.recurringExpense.create({
        data: {
          companyId: req.params.companyId,
          name: req.body.name,
          amount: BigInt(req.body.amountCents ?? 0),
          startDate: new Date(req.body.startDate!),
          ...writeData(req.body),
        },
      });
      return reply.code(201).send(shape(row));
    }
  );

  app.put<{ Params: { companyId: string; expenseId: string }; Body: RecurringBody }>(
    "/companies/:companyId/recurring-expenses/:expenseId",
    { schema: { body: recurringBody } },
    async (req) => {
      const row = await prisma.recurringExpense.update({
        where: { id: req.params.expenseId, companyId: req.params.companyId },
        data: writeData(req.body),
      });
      return shape(row);
    }
  );

  app.delete<{ Params: { companyId: string; expenseId: string } }>(
    "/companies/:companyId/recurring-expenses/:expenseId",
    async (req) => {
      await prisma.recurringExpense.delete({
        where: { id: req.params.expenseId, companyId: req.params.companyId },
      });
      return { ok: true };
    }
  );

  // Record that a scheduled obligation was actually paid. This writes a real
  // ledger event carrying the projection's source key, which is what makes the
  // projection disappear instead of being counted twice.
  app.post<{
    Params: { companyId: string };
    Body: {
      origin: "LIABILITY" | "OVERHEAD";
      originId: string;
      paidOn: string;
      amountCents?: number;
    };
  }>(
    "/companies/:companyId/obligations/record-payment",
    {
      schema: {
        body: {
          type: "object",
          required: ["origin", "originId", "paidOn"],
          additionalProperties: false,
          properties: {
            origin: { type: "string", enum: ["LIABILITY", "OVERHEAD"] },
            originId: { type: "string", minLength: 1 },
            paidOn: { type: "string", format: "date-time" },
            amountCents: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const companyId = req.params.companyId;
      const paidOn = new Date(req.body.paidOn);

      if (req.body.origin === "LIABILITY") {
        const l = await prisma.liability.findFirstOrThrow({
          where: { id: req.body.originId, companyId },
        });
        const amount = BigInt(req.body.amountCents ?? n(l.paymentAmount));
        const sourceKey = sourceKeyFor("LIABILITY", l.id, l.paymentFrequency, paidOn);
        const event = await prisma.cashEvent.upsert({
          where: { companyId_sourceKey: { companyId, sourceKey } },
          create: {
            companyId,
            direction: "OUT",
            amount,
            category:
              l.kind === "EQUIPMENT_LEASE" || l.kind === "BUILDING_LEASE" ? "OVERHEAD" : "LOAN",
            expectedDate: paidOn,
            actualDate: paidOn,
            status: "PAID",
            sourceKey,
          },
          update: { amount, actualDate: paidOn, status: "PAID" },
        });
        // Paying a loan reduces what's owed; a lease payment doesn't.
        const isLease = l.kind === "EQUIPMENT_LEASE" || l.kind === "BUILDING_LEASE";
        if (!isLease) {
          const periodRate =
            l.interestRatePct /
            100 /
            { WEEKLY: 52, BIWEEKLY: 26, MONTHLY: 12, QUARTERLY: 4, ANNUAL: 1 }[l.paymentFrequency];
          const interest = BigInt(Math.round(n(l.currentBalance) * periodRate));
          const principal = amount > interest ? amount - interest : 0n;
          const next = l.currentBalance > principal ? l.currentBalance - principal : 0n;
          await prisma.liability.update({
            where: { id: l.id },
            data: { currentBalance: next },
          });
        }
        return reply.code(201).send({ ok: true, sourceKey, eventId: event.id });
      }

      const e = await prisma.recurringExpense.findFirstOrThrow({
        where: { id: req.body.originId, companyId },
      });
      const sourceKey = sourceKeyFor("OVERHEAD", e.id, e.frequency, paidOn);
      const event = await prisma.cashEvent.upsert({
        where: { companyId_sourceKey: { companyId, sourceKey } },
        create: {
          companyId,
          direction: "OUT",
          amount: BigInt(req.body.amountCents ?? n(e.amount)),
          category: e.category,
          expectedDate: paidOn,
          actualDate: paidOn,
          status: "PAID",
          sourceKey,
        },
        update: {
          amount: BigInt(req.body.amountCents ?? n(e.amount)),
          actualDate: paidOn,
          status: "PAID",
        },
      });
      return reply.code(201).send({ ok: true, sourceKey, eventId: event.id });
    }
  );
}
