import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { generateMilestones, slipDays, summarizeMilestones } from "@plumb/engine";
import { n, toEngineMilestone } from "../map.js";
import { loadSnapshot, companyAsOf } from "../snapshot.js";

const TRIGGERS = ["DATE", "PERCENT_COMPLETE", "PHASE_COMPLETE"] as const;
const STATUSES = ["PLANNED", "READY", "BILLED", "PAID"] as const;

interface MilestoneBody {
  name?: string;
  sequence?: number;
  trigger?: (typeof TRIGGERS)[number];
  triggerValue?: number | null;
  phaseId?: string | null;
  expectedDate?: string;
  amountCents?: number;
  retainagePct?: number;
  status?: (typeof STATUSES)[number];
}

const milestoneBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    sequence: { type: "integer", minimum: 0, maximum: 999 },
    trigger: { type: "string", enum: [...TRIGGERS] },
    triggerValue: { type: "number", minimum: 0, maximum: 1, nullable: true },
    phaseId: { type: "string", nullable: true },
    expectedDate: { type: "string", format: "date-time" },
    amountCents: { type: "integer", minimum: 0 },
    retainagePct: { type: "number", minimum: 0, maximum: 100 },
    status: { type: "string", enum: [...STATUSES] },
  },
} as const;

const shape = (m: any) => ({
  id: m.id,
  projectId: m.projectId,
  name: m.name,
  sequence: m.sequence,
  trigger: m.trigger,
  triggerValue: m.triggerValue,
  phaseId: m.phaseId,
  expectedDate: m.expectedDate,
  originalExpectedDate: m.originalExpectedDate,
  amountCents: n(m.amount),
  retainagePct: m.retainagePct,
  status: m.status,
  billedAt: m.billedAt,
  paidAt: m.paidAt,
  qboInvoiceId: m.qboInvoiceId,
  slipDays: slipDays(toEngineMilestone(m)),
});

async function requireProject(companyId: string, projectId: string) {
  return prisma.project.findFirstOrThrow({ where: { id: projectId, companyId } });
}

/** The three numbers a date change actually moves. */
function cashShape(snap: Awaited<ReturnType<typeof loadSnapshot>>) {
  return {
    minBalanceCents: snap.cash.base.minBalanceCents,
    minBalanceDate: snap.cash.base.minBalanceDate,
    endingBalanceCents: snap.cash.base.endingBalanceCents,
    firstBreachDate: snap.cash.base.firstBreachDate,
    stressFirstBreachDate: snap.cash.stress.firstBreachDate,
  };
}

export function registerMilestoneRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string; projectId: string } }>(
    "/companies/:companyId/projects/:projectId/milestones",
    async (req) => {
      const p = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, companyId: req.params.companyId },
        include: { milestones: { orderBy: [{ sequence: "asc" }, { expectedDate: "asc" }] } },
      });
      return {
        milestones: p.milestones.map(shape),
        summary: summarizeMilestones(
          p.id,
          n(p.contractValue),
          p.milestones.map(toEngineMilestone),
          await companyAsOf(req.params.companyId)
        ),
      };
    }
  );

  app.post<{
    Params: { companyId: string; projectId: string };
    Body: MilestoneBody & { name: string; expectedDate: string; amountCents: number };
  }>(
    "/companies/:companyId/projects/:projectId/milestones",
    { schema: { body: { ...milestoneBody, required: ["name", "expectedDate", "amountCents"] } } },
    async (req, reply) => {
      const project = await requireProject(req.params.companyId, req.params.projectId);
      const max = await prisma.milestone.aggregate({
        where: { projectId: project.id },
        _max: { sequence: true },
      });
      const expectedDate = new Date(req.body.expectedDate);
      const m = await prisma.milestone.create({
        data: {
          projectId: project.id,
          name: req.body.name,
          sequence: req.body.sequence ?? (max._max.sequence ?? 0) + 1,
          trigger: req.body.trigger ?? "DATE",
          triggerValue: req.body.triggerValue ?? null,
          phaseId: req.body.phaseId ?? null,
          expectedDate,
          originalExpectedDate: expectedDate,
          amount: BigInt(req.body.amountCents),
          retainagePct: req.body.retainagePct ?? project.retainagePct,
        },
      });
      return reply.code(201).send(shape(m));
    }
  );

  // Draft a whole schedule at once. Entering a twelve-milestone contract by
  // hand is the reason billing schedules don't get entered at all.
  app.post<{
    Params: { companyId: string; projectId: string };
    Body: { count: number; replace?: boolean };
  }>(
    "/companies/:companyId/projects/:projectId/milestones/generate",
    {
      schema: {
        body: {
          type: "object",
          required: ["count"],
          additionalProperties: false,
          properties: {
            count: { type: "integer", minimum: 1, maximum: 60 },
            replace: { type: "boolean" },
          },
        },
      },
    },
    async (req) => {
      const project = await requireProject(req.params.companyId, req.params.projectId);
      const drafted = generateMilestones(
        n(project.contractValue),
        project.startDate,
        project.expectedEndDate ?? project.endDate,
        req.body.count
      );

      if (req.body.replace) {
        // Only unbilled milestones are safe to discard — anything invoiced is
        // a real event with a QBO invoice behind it.
        await prisma.milestone.deleteMany({
          where: { projectId: project.id, status: { in: ["PLANNED", "READY"] } },
        });
      }

      await prisma.milestone.createMany({
        data: drafted.map((d) => ({
          projectId: project.id,
          name: d.name,
          sequence: d.sequence,
          expectedDate: d.expectedDate,
          originalExpectedDate: d.expectedDate,
          amount: BigInt(d.amountCents),
          retainagePct: project.retainagePct,
        })),
      });
      return { ok: true, created: drafted.length };
    }
  );

  app.put<{
    Params: { companyId: string; projectId: string; milestoneId: string };
    Body: MilestoneBody;
  }>(
    "/companies/:companyId/projects/:projectId/milestones/:milestoneId",
    { schema: { body: milestoneBody } },
    async (req) => {
      await requireProject(req.params.companyId, req.params.projectId);
      const b = req.body;
      const m = await prisma.milestone.update({
        where: { id: req.params.milestoneId, projectId: req.params.projectId },
        data: {
          ...(b.name !== undefined && { name: b.name }),
          ...(b.sequence !== undefined && { sequence: b.sequence }),
          ...(b.trigger !== undefined && { trigger: b.trigger }),
          ...(b.triggerValue !== undefined && { triggerValue: b.triggerValue }),
          ...(b.phaseId !== undefined && { phaseId: b.phaseId }),
          ...(b.expectedDate !== undefined && { expectedDate: new Date(b.expectedDate) }),
          ...(b.amountCents !== undefined && { amount: BigInt(b.amountCents) }),
          ...(b.retainagePct !== undefined && { retainagePct: b.retainagePct }),
          ...(b.status !== undefined && { status: b.status }),
        },
      });
      return shape(m);
    }
  );

  /**
   * Push a milestone's date and report what it did to cash.
   *
   * This is the whole point of modelling milestones: a weather delay is not a
   * note field. The forecast is computed before and after the move so the owner
   * sees the ripple instead of redoing the math by hand.
   */
  app.patch<{
    Params: { companyId: string; projectId: string; milestoneId: string };
    Body: { expectedDate?: string; shiftDays?: number; reason?: string };
  }>(
    "/companies/:companyId/projects/:projectId/milestones/:milestoneId/date",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            expectedDate: { type: "string", format: "date-time" },
            shiftDays: { type: "integer", minimum: -3650, maximum: 3650 },
            reason: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const { companyId, projectId, milestoneId } = req.params;
      await requireProject(companyId, projectId);
      const current = await prisma.milestone.findFirstOrThrow({
        where: { id: milestoneId, projectId },
      });

      let next: Date;
      if (req.body.expectedDate) {
        next = new Date(req.body.expectedDate);
      } else if (req.body.shiftDays !== undefined) {
        next = new Date(current.expectedDate.getTime());
        next.setUTCDate(next.getUTCDate() + req.body.shiftDays);
      } else {
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "Provide expectedDate or shiftDays." });
      }

      const before = cashShape(await loadSnapshot(companyId));
      const updated = await prisma.milestone.update({
        where: { id: milestoneId },
        data: { expectedDate: next },
      });
      const after = cashShape(await loadSnapshot(companyId));

      return {
        milestone: shape(updated),
        before,
        after,
        delta: {
          minBalanceCents: after.minBalanceCents - before.minBalanceCents,
          endingBalanceCents: after.endingBalanceCents - before.endingBalanceCents,
          minBalanceDateMoved: before.minBalanceDate !== after.minBalanceDate,
          breachAppeared: !before.firstBreachDate && !!after.firstBreachDate,
          breachCleared: !!before.firstBreachDate && !after.firstBreachDate,
        },
      };
    }
  );

  app.delete<{ Params: { companyId: string; projectId: string; milestoneId: string } }>(
    "/companies/:companyId/projects/:projectId/milestones/:milestoneId",
    async (req) => {
      await requireProject(req.params.companyId, req.params.projectId);
      await prisma.milestone.delete({ where: { id: req.params.milestoneId } });
      return { ok: true };
    }
  );
}
