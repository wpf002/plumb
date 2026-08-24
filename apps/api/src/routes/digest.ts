import type { FastifyInstance } from "fastify";
import { buildDigest } from "@plumb/engine";
import { loadSnapshot } from "../snapshot.js";
import { getNotifier, renderDigestText, renderDigestHtml } from "../notify.js";

const sendBodySchema = {
  type: "object",
  required: ["to"],
  additionalProperties: false,
  properties: {
    to: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
  },
} as const;

async function digestFor(companyId: string) {
  const snap = await loadSnapshot(companyId);
  return buildDigest({
    asOf: new Date(),
    companyName: snap.company.name,
    health: snap.health,
    cash: snap.cash,
    wip: snap.wip,
    projectNames: snap.projectNames,
    services: snap.services,
    obligations: snap.obligations,
    billing: snap.billing,
  });
}

export function registerDigestRoutes(app: FastifyInstance) {
  // Preview: the exact weekly digest a subcontractor would receive — structured
  // plus rendered text/html. No send; safe to hit anytime.
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/digest",
    async (req) => {
      const digest = await digestFor(req.params.companyId);
      return {
        digest,
        rendered: {
          subject: `Plumb weekly — ${digest.headline}`,
          text: renderDigestText(digest),
          html: renderDigestHtml(digest),
        },
      };
    }
  );

  // Send the weekly digest. Uses the configured notifier; with no email provider
  // set this is a dry run that reports what *would* have been sent.
  app.post<{ Params: { companyId: string }; Body: { to: string } }>(
    "/companies/:companyId/digest/send",
    { schema: { body: sendBodySchema } },
    async (req) => {
      const digest = await digestFor(req.params.companyId);
      const result = await getNotifier().send({
        to: req.body.to,
        subject: `Plumb weekly — ${digest.headline}`,
        text: renderDigestText(digest),
        html: renderDigestHtml(digest),
      });
      return { digest, delivery: result };
    }
  );
}
