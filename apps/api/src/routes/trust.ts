import type { FastifyInstance } from "fastify";
import { prisma } from "@plumb/db";
import { assessConfidence, summarizeMilestones } from "@plumb/engine";
import { n, toEngineMilestone } from "../map.js";
import { openingCashCents, companyAsOf } from "../snapshot.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ageDays = (d: Date | null | undefined, now: Date) =>
  d ? Math.floor((now.getTime() - d.getTime()) / DAY_MS) : null;

export function registerTrustRoutes(app: FastifyInstance) {
  /**
   * How much this forecast should be trusted, what feeds it, and whether the
   * cash number can be checked against the bank.
   *
   * A cash product is only as credible as its inputs — and a silent stale sync
   * showing the wrong position is the highest-stakes failure mode there is, so
   * this is surfaced rather than buried.
   */
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/data-health",
    async (req) => {
      const companyId = req.params.companyId;
      const now = await companyAsOf(companyId);
      await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

      const [snapshot, lastOk, lastAny, connection, projects, expenses, liabilities, payers, costs, codedCosts] =
        await Promise.all([
          prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: { asOf: "desc" } }),
          prisma.syncLog.findFirst({
            where: { companyId, status: "OK" },
            orderBy: { startedAt: "desc" },
          }),
          prisma.syncLog.findFirst({ where: { companyId }, orderBy: { startedAt: "desc" } }),
          prisma.qboConnection.findUnique({ where: { companyId } }),
          prisma.project.findMany({
            where: { companyId, status: { in: ["ACTIVE", "AWARDED"] } },
            include: { milestones: true, budgetLines: true },
          }),
          prisma.recurringExpense.count({ where: { companyId, active: true } }),
          prisma.liability.count({ where: { companyId, active: true } }),
          prisma.payer.findMany({ where: { companyId }, select: { sampleSize: true, source: true } }),
          prisma.costEntry.count({ where: { project: { companyId } } }),
          prisma.costEntry.count({ where: { project: { companyId }, phaseId: { not: null } } }),
        ]);

      const schedules = projects.map((p) =>
        summarizeMilestones(p.id, n(p.contractValue), p.milestones.map(toEngineMilestone), now)
      );

      const confidence = assessConfidence({
        openingCashAgeDays: ageDays(snapshot?.asOf, now),
        lastSyncAgeDays: connection ? ageDays(lastOk?.startedAt ?? null, now) : null,
        syncFailing: !!lastAny && lastAny.status !== "OK",
        activeProjectCount: projects.length,
        projectsWithBudget: projects.filter((p) => p.budgetLines.length > 0).length,
        projectsWithBillingSchedule: schedules.filter((s) => s.count > 0).length,
        // A schedule that doesn't add up to the contract leaves cash unaccounted for.
        projectsWithIncompleteSchedule: schedules.filter(
          (s) => s.count > 0 && Math.abs(s.unscheduledCents) > 100
        ).length,
        projectsWithPayer: projects.filter((p) => p.payerId).length,
        payersWithHistory: payers.filter((p) => p.source === "OBSERVED" && p.sampleSize > 0).length,
        payerCount: payers.length,
        recurringExpenseCount: expenses,
        liabilityCount: liabilities,
        costEntryCount: costs,
        costEntriesWithPhase: codedCosts,
        monthlyFixedCents: 0,
      });

      // Reconciliation: the bank balance the forecast plans from, plus everything
      // that has actually settled since, so the owner can check it by hand.
      const cashNow = await openingCashCents(companyId);
      const settledSince = snapshot
        ? await prisma.cashEvent.findMany({
            where: { companyId, actualDate: { gt: snapshot.asOf, lte: now } },
            orderBy: { actualDate: "asc" },
          })
        : [];
      const settledNetCents = settledSince.reduce(
        (s, e) => s + (e.direction === "IN" ? n(e.amount) : -n(e.amount)),
        0
      );

      return {
        asOf: now,
        confidence,
        sync: {
          connected: !!connection,
          lastSuccessAt: lastOk?.startedAt ?? null,
          lastAttemptAt: lastAny?.startedAt ?? null,
          lastStatus: lastAny?.status ?? null,
          lastError: lastAny?.error ?? null,
          ageDays: ageDays(lastOk?.startedAt ?? null, now),
        },
        reconciliation: {
          bankBalanceCents: cashNow,
          asOf: snapshot?.asOf ?? null,
          source: snapshot?.source ?? "DEFAULT",
          ageDays: ageDays(snapshot?.asOf, now),
          settledSinceCount: settledSince.length,
          settledNetCents,
          expectedNowCents: cashNow + settledNetCents,
          entries: settledSince.slice(-12).map((e) => ({
            date: e.actualDate,
            direction: e.direction,
            amountCents: n(e.amount),
            category: e.category,
          })),
        },
      };
    }
  );
}
