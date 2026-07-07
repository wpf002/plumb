import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "@plumb/db";
import { buildDigest } from "@plumb/engine";
import { loadSnapshot } from "./snapshot.js";
import { getNotifier, renderDigestText, renderDigestHtml } from "./notify.js";

// Weekly digest scheduler. Off unless ENABLE_SCHEDULER=true so it never fires in
// dev or CI. Sending still routes through the notifier, which dry-runs unless an
// email provider is configured — so enabling the schedule alone sends nothing.
export function startScheduler(log: FastifyBaseLogger): void {
  if (process.env.ENABLE_SCHEDULER !== "true") {
    log.info("scheduler off (set ENABLE_SCHEDULER=true for the weekly digest)");
    return;
  }

  const schedule = process.env.DIGEST_CRON ?? "0 7 * * 1"; // Mondays 07:00
  const to = process.env.DIGEST_TEST_TO; // demo recipient (real: per-company owner email)

  cron.schedule(schedule, async () => {
    const companies = await prisma.company.findMany();
    for (const c of companies) {
      try {
        const snap = await loadSnapshot(c.id);
        const digest = buildDigest({
          asOf: new Date(),
          companyName: snap.company.name,
          health: snap.health,
          cash: snap.cash,
          wip: snap.wip,
          projectNames: snap.projectNames,
        });
        if (!to) {
          log.info({ company: c.name, headline: digest.headline }, "digest ready (no DIGEST_TEST_TO; not sending)");
          continue;
        }
        const res = await getNotifier().send({
          to,
          subject: `Plumb weekly — ${digest.headline}`,
          text: renderDigestText(digest),
          html: renderDigestHtml(digest),
        });
        log.info({ company: c.name, ...res }, "weekly digest processed");
      } catch (err) {
        log.error({ err, company: c.name }, "weekly digest failed");
      }
    }
  });

  log.info({ schedule }, "scheduler on: weekly digest");
}
