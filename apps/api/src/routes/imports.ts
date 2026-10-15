import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { getSessionUser, SESSION_COOKIE } from "../auth.js";
import { importAccount } from "../import/importer.js";
import { reconcile } from "../import/reconcile.js";

// A full account export is ~2MB of CSV; leave room for a large company.
const BODY_LIMIT = 40 * 1024 * 1024;

const filesBody = {
  type: "object",
  required: ["files"],
  additionalProperties: false,
  properties: {
    files: {
      type: "object",
      minProperties: 1,
      maxProperties: 200,
      additionalProperties: { type: "string" },
    },
  },
} as const;

export function registerImportRoutes(app: FastifyInstance) {
  // Import a file set as a brand-new company owned by the caller.
  app.post<{ Body: { files: Record<string, string> } }>(
    "/imports",
    { bodyLimit: BODY_LIMIT, schema: { body: filesBody } },
    async (req, reply) => {
      const user = await getSessionUser(req.cookies[SESSION_COOKIE]);
      if (!user) return reply.code(401).send({ error: "Unauthorized", message: "Sign in required." });
      const report = await importAccount({ files: req.body.files, ownerUserId: user.id });
      return reply.code(201).send({ report, reconciliation: await reconcile(report.companyId) });
    }
  );

  // Replace this company's data with a fresh import. Owner only (see OWNER_ONLY).
  app.post<{ Params: { companyId: string }; Body: { files: Record<string, string> } }>(
    "/companies/:companyId/import",
    { bodyLimit: BODY_LIMIT, schema: { body: filesBody } },
    async (req) => {
      await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const report = await importAccount({ files: req.body.files, companyId: req.params.companyId });
      return { report, reconciliation: await reconcile(report.companyId) };
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/import/reconciliation",
    async (req) => reconcile(req.params.companyId)
  );

  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/import/runs",
    async (req) => {
      const runs = await prisma.importRun.findMany({
        where: { companyId: req.params.companyId },
        orderBy: { startedAt: "desc" },
        take: 10,
      });
      return { runs };
    }
  );
}
