import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { n } from "../map.js";

const createSchema = {
  type: "object",
  required: ["contractDeltaCents", "costDeltaCents"],
  additionalProperties: false,
  properties: {
    contractDeltaCents: { type: "integer" },
    costDeltaCents: { type: "integer" },
    reason: { type: "string", maxLength: 300 },
  },
} as const;

function shape(co: {
  id: string;
  reason: string | null;
  contractDelta: bigint;
  costDelta: bigint;
  status: string;
  date: Date;
  approvedAt: Date | null;
}) {
  return {
    id: co.id,
    reason: co.reason,
    contractDeltaCents: n(co.contractDelta),
    costDeltaCents: n(co.costDelta),
    marginImpactCents: n(co.contractDelta) - n(co.costDelta),
    status: co.status,
    date: co.date,
    approvedAt: co.approvedAt,
  };
}

async function assertOwned(companyId: string, coId: string) {
  const co = await prisma.changeOrder.findFirst({
    where: { id: coId, project: { companyId } },
  });
  if (!co) {
    const err = new Error("Change order not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return co;
}

export function registerChangeOrderRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string; projectId: string } }>(
    "/companies/:companyId/projects/:projectId/change-orders",
    async (req) => {
      const cos = await prisma.changeOrder.findMany({
        where: { projectId: req.params.projectId, project: { companyId: req.params.companyId } },
        orderBy: { date: "desc" },
      });
      return { changeOrders: cos.map(shape) };
    }
  );

  app.post<{
    Params: { companyId: string; projectId: string };
    Body: { contractDeltaCents: number; costDeltaCents: number; reason?: string };
  }>(
    "/companies/:companyId/projects/:projectId/change-orders",
    { schema: { body: createSchema } },
    async (req) => {
      await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, companyId: req.params.companyId },
        select: { id: true },
      });
      const co = await prisma.changeOrder.create({
        data: {
          projectId: req.params.projectId,
          reason: req.body.reason ?? null,
          contractDelta: BigInt(req.body.contractDeltaCents),
          costDelta: BigInt(req.body.costDeltaCents),
          status: "PENDING",
          date: new Date(),
        },
      });
      return shape(co);
    }
  );

  app.post<{ Params: { companyId: string; coId: string } }>(
    "/companies/:companyId/change-orders/:coId/approve",
    async (req) => {
      await assertOwned(req.params.companyId, req.params.coId);
      const co = await prisma.changeOrder.update({
        where: { id: req.params.coId },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      return shape(co);
    }
  );

  app.post<{ Params: { companyId: string; coId: string } }>(
    "/companies/:companyId/change-orders/:coId/reject",
    async (req) => {
      await assertOwned(req.params.companyId, req.params.coId);
      const co = await prisma.changeOrder.update({
        where: { id: req.params.coId },
        data: { status: "REJECTED", approvedAt: null },
      });
      return shape(co);
    }
  );
}
