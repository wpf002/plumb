import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "@plumb/db";
import { buildDigest } from "@plumb/engine";
import { syncCompany } from "@plumb/qbo";
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
          services: snap.services,
          obligations: snap.obligations,
          billing: snap.billing,
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

  // Nightly QBO sync for every connected company. Incremental since 25h ago so a
  // missed night still overlaps. Companies without a connection are skipped.
  const syncSchedule = process.env.QBO_SYNC_CRON ?? "0 3 * * *"; // 03:00 daily
  cron.schedule(syncSchedule, async () => {
    const conns = await prisma.qboConnection.findMany({ select: { companyId: true } });
    const since = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const { companyId } of conns) {
      try {
        const counts = await syncCompany(companyId, { since });
        log.info({ companyId, ...counts }, "qbo sync complete");
      } catch (err) {
        log.error({ err, companyId }, "qbo sync failed");
      }
    }
  });

  log.info({ schedule, syncSchedule }, "scheduler on: weekly digest + nightly QBO sync");
}
