import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { observePayerBehavior, type SettledInvoice } from "@plumb/engine";
import { n } from "../map.js";

const PAYER_TYPES = ["GC", "OWNER_DIRECT", "PUBLIC_ENTITY"] as const;

interface PayerBody {
  name?: string;
  type?: (typeof PAYER_TYPES)[number];
  typicalDaysLate?: number;
  notes?: string | null;
}

const payerBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    type: { type: "string", enum: [...PAYER_TYPES] },
    typicalDaysLate: { type: "integer", minimum: 0, maximum: 365 },
    notes: { type: "string", maxLength: 500, nullable: true },
  },
} as const;

const shape = (p: any) => ({
  id: p.id,
  name: p.name,
  type: p.type,
  typicalDaysLate: p.typicalDaysLate,
  source: p.source,
  sampleSize: p.sampleSize,
  notes: p.notes,
});

/**
 * Settled invoices for a payer, from the cash ledger.
 *
 * "Due" is the date the money was expected under terms and "paid" is when it
 * actually landed, so the lag measured is genuinely days past terms.
 */
async function settledInvoices(companyId: string, payerId: string): Promise<SettledInvoice[]> {
  const events = await prisma.cashEvent.findMany({
    where: {
      companyId,
      direction: "IN",
      actualDate: { not: null },
      project: { payerId },
    },
  });
  return events.map((e) => ({
    dueDate: e.expectedDate,
    paidDate: e.actualDate!,
    amountCents: n(e.amount),
  }));
}

export function registerPayerRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/payers",
    async (req) => {
      const payers = await prisma.payer.findMany({
        where: { companyId: req.params.companyId },
        orderBy: [{ typicalDaysLate: "desc" }, { name: "asc" }],
        include: {
          projects: {
            where: { status: { not: "CLOSED" } },
            select: { id: true, name: true, contractValue: true },
          },
        },
      });
      return {
        payers: payers.map((p) => ({
          ...shape(p),
          projects: p.projects.map((j) => ({
            id: j.id,
            name: j.name,
            contractValueCents: n(j.contractValue),
          })),
          exposureCents: p.projects.reduce((s, j) => s + n(j.contractValue), 0),
        })),
      };
    }
  );

  app.post<{ Params: { companyId: string }; Body: PayerBody & { name: string } }>(
    "/companies/:companyId/payers",
    { schema: { body: { ...payerBody, required: ["name"] } } },
    async (req, reply) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const p = await prisma.payer.create({
        data: {
          companyId: req.params.companyId,
          name: req.body.name,
          type: req.body.type ?? "GC",
          typicalDaysLate: req.body.typicalDaysLate ?? 0,
          notes: req.body.notes ?? null,
        },
      });
      return reply.code(201).send(shape(p));
    }
  );

  app.put<{ Params: { companyId: string; payerId: string }; Body: PayerBody }>(
    "/companies/:companyId/payers/:payerId",
    { schema: { body: payerBody } },
    async (req) => {
      const b = req.body;
      const p = await prisma.payer.update({
        where: { id: req.params.payerId, companyId: req.params.companyId },
        data: {
          ...(b.name !== undefined && { name: b.name }),
          ...(b.type !== undefined && { type: b.type }),
          // Typing a number by hand makes it a manual figure again.
          ...(b.typicalDaysLate !== undefined && {
            typicalDaysLate: b.typicalDaysLate,
            source: "MANUAL" as const,
          }),
          ...(b.notes !== undefined && { notes: b.notes }),
        },
      });
      return shape(p);
    }
  );

  // Recompute how late this payer runs from the invoices they've actually
  // settled. Replaces a guess with their own history.
  app.post<{ Params: { companyId: string; payerId: string } }>(
    "/companies/:companyId/payers/:payerId/observe",
    async (req) => {
      const { companyId, payerId } = req.params;
      await prisma.payer.findFirstOrThrow({ where: { id: payerId, companyId } });
      const observation = observePayerBehavior(await settledInvoices(companyId, payerId));

      if (observation.sampleSize === 0) {
        return {
          updated: false,
          observation,
          note: "No settled invoices for this payer yet — keeping the entered figure.",
        };
      }

      const p = await prisma.payer.update({
        where: { id: payerId },
        data: {
          typicalDaysLate: observation.typicalDaysLate,
          source: "OBSERVED",
          sampleSize: observation.sampleSize,
        },
      });
      return {
        updated: true,
        payer: shape(p),
        observation,
        note: `${observation.sampleSize} settled invoice(s): typically ${observation.typicalDaysLate} days past terms, worst ${observation.worstDaysLate}.`,
      };
    }
  );

  app.delete<{ Params: { companyId: string; payerId: string } }>(
    "/companies/:companyId/payers/:payerId",
    async (req) => {
      await prisma.payer.delete({
        where: { id: req.params.payerId, companyId: req.params.companyId },
      });
      return { ok: true };
    }
  );

  // Assign a payer to a job (and adjust the few project fields the UI edits).
  app.put<{
    Params: { companyId: string; projectId: string };
    Body: { payerId?: string | null; percentComplete?: number | null; expectedEndDate?: string | null };
  }>(
    "/companies/:companyId/projects/:projectId",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            payerId: { type: "string", nullable: true },
            percentComplete: { type: "number", minimum: 0, maximum: 1, nullable: true },
            expectedEndDate: { type: "string", format: "date-time", nullable: true },
          },
        },
      },
    },
    async (req) => {
      const b = req.body;
      await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, companyId: req.params.companyId },
      });
      const p = await prisma.project.update({
        where: { id: req.params.projectId },
        data: {
          ...(b.payerId !== undefined && { payerId: b.payerId || null }),
          ...(b.percentComplete !== undefined && { percentComplete: b.percentComplete }),
          ...(b.expectedEndDate !== undefined && {
            expectedEndDate: b.expectedEndDate ? new Date(b.expectedEndDate) : null,
          }),
        },
      });
      return { id: p.id, payerId: p.payerId, percentComplete: p.percentComplete, expectedEndDate: p.expectedEndDate };
    }
  );
}
