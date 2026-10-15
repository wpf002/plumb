import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@plumb/db";
import { incomeTotals } from "@plumb/engine";
import { loadLedger } from "../analytics/ledger.js";
import { completeYears } from "../analytics/operations.js";
import { totalDebtCents, workingCapital } from "../analytics/workingcapital.js";
import { companyAsOf } from "../snapshot.js";
import type { AuthedRequest } from "./tools.js";
import { requireFeature } from "../plan.js";

/**
 * Business-tier features: company groups with consolidated reporting,
 * per-user dashboard layouts, and full data exports for a warehouse.
 */

const n = (b: bigint | null | undefined) => Number(b ?? 0n);
const REPORTING_ROLES = ["OWNER", "ACCOUNTANT"];

/** Companies this user may consolidate: ones they own or keep the books for. */
async function reportableCompanyIds(userId: string) {
  const m = await prisma.membership.findMany({ where: { userId, role: { in: REPORTING_ROLES as any } }, select: { companyId: true } });
  return new Set(m.map((x) => x.companyId));
}

async function groupFor(userId: string, groupId: string) {
  const g = await prisma.companyGroup.findUnique({ where: { id: groupId }, include: { members: { include: { company: { select: { id: true, name: true } } } }, eliminations: true } });
  if (!g) return null;
  const allowed = await reportableCompanyIds(userId);
  // Only the creator, and only while they still report on every member.
  if (g.ownerId !== userId || g.members.some((m) => !allowed.has(m.companyId))) return null;
  return g;
}

const forbidden = (reply: FastifyReply) => reply.code(404).send({ error: "Not Found", message: "No such group." });

export const WIDGETS = ["brief", "denny", "health", "attention", "cash", "collisions", "obligations"] as const;

const EXPORT_TABLES = {
  gl: async (companyId: string) =>
    (await prisma.glAmount.findMany({ where: { glAccount: { companyId } }, include: { glAccount: true }, orderBy: [{ period: "asc" }] })).map((a) => ({
      statement: a.glAccount.statement,
      account_key: a.glAccount.key,
      account_name: a.glAccount.name,
      type: a.glAccount.type,
      subtype: a.glAccount.subtype,
      service_line: a.glAccount.serviceLine,
      period: a.period,
      amount: n(a.amount) / 100,
    })),
  customers: async (companyId: string) => (await prisma.customer.findMany({ where: { companyId } })).map((c) => ({ id: c.externalId ?? c.id, name: c.name, segment: c.segment, active: c.active })),
  vendors: async (companyId: string) => (await prisma.vendor.findMany({ where: { companyId } })).map((v) => ({ id: v.externalId ?? v.id, name: v.name, category: v.category })),
  invoices: async (companyId: string) =>
    (await prisma.invoice.findMany({ where: { companyId }, include: { customer: true }, orderBy: { issueDate: "asc" } })).map((i) => ({ id: i.externalId ?? i.id, customer: i.customer?.name ?? null, issue_date: i.issueDate.toISOString().slice(0, 10), due_date: i.dueDate.toISOString().slice(0, 10), amount: n(i.amount) / 100, paid_date: i.paidDate?.toISOString().slice(0, 10) ?? null, status: i.status })),
  bills: async (companyId: string) =>
    (await prisma.bill.findMany({ where: { companyId }, include: { vendor: true }, orderBy: { billDate: "asc" } })).map((b) => ({ id: b.externalId ?? b.id, vendor: b.vendor?.name ?? null, bill_date: b.billDate.toISOString().slice(0, 10), due_date: b.dueDate.toISOString().slice(0, 10), amount: n(b.amount) / 100, paid_date: b.paidDate?.toISOString().slice(0, 10) ?? null, category: b.category })),
  projects: async (companyId: string) =>
    (await prisma.project.findMany({ where: { companyId } })).map((p) => ({ id: p.externalId ?? p.id, name: p.name, client: p.client, status: p.status, category: p.category, contract: n(p.contractValue) / 100, bid_cost: n(p.originalBidCost) / 100, start: p.startDate.toISOString().slice(0, 10), end: p.endDate.toISOString().slice(0, 10) })),
  transactions: async (companyId: string) =>
    (await prisma.bankTransaction.findMany({ where: { companyId }, orderBy: { date: "asc" } })).map((t) => ({ id: t.externalId, source: t.source, date: t.date.toISOString().slice(0, 10), amount: n(t.amount) / 100, description: t.description, merchant: t.merchant, category: t.category, kind: t.kind })),
  payroll: async (companyId: string) =>
    (await prisma.timeEntry.findMany({ where: { companyId }, include: { employee: true }, orderBy: { period: "asc" } })).map((t) => ({ employee: t.employee.name, period: t.period, regular_hours: t.regularHours, overtime_hours: t.overtimeHours, gross_pay: n(t.grossPay) / 100 })),
} as const;

type Table = keyof typeof EXPORT_TABLES;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export function registerBusinessRoutes(app: FastifyInstance) {
  // ---- groups ----
  app.get("/groups", async (req) => {
    const userId = (req as AuthedRequest).userId!;
    const allowed = await reportableCompanyIds(userId);
    const groups = await prisma.companyGroup.findMany({ where: { ownerId: userId }, include: { members: { include: { company: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "asc" } });
    const companies = await prisma.company.findMany({ where: { id: { in: [...allowed] } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    return { companies, groups: groups.map((g) => ({ id: g.id, name: g.name, companies: g.members.map((m) => m.company) })) };
  });

  app.post<{ Body: { name: string; companyIds: string[] } }>(
    "/groups",
    { schema: { body: { type: "object", required: ["name", "companyIds"], additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 120 }, companyIds: { type: "array", minItems: 2, maxItems: 50, uniqueItems: true, items: { type: "string" } } } } } },
    async (req, reply) => {
      const userId = (req as AuthedRequest).userId!;
      const allowed = await reportableCompanyIds(userId);
      if (req.body.companyIds.some((id) => !allowed.has(id))) return reply.code(403).send({ error: "Forbidden", message: "You can group only companies you own or keep the books for." });
      for (const id of req.body.companyIds) {
        const blocked = await requireFeature(id, "groups");
        if (blocked) return reply.code(403).send(blocked);
      }
      const g = await prisma.companyGroup.create({ data: { name: req.body.name, ownerId: userId, members: { create: req.body.companyIds.map((companyId) => ({ companyId })) } } });
      return reply.code(201).send({ id: g.id });
    }
  );

  app.delete<{ Params: { groupId: string } }>("/groups/:groupId", async (req, reply) => {
    const g = await groupFor((req as AuthedRequest).userId!, req.params.groupId);
    if (!g) return forbidden(reply);
    await prisma.companyGroup.delete({ where: { id: g.id } });
    return { ok: true };
  });

  app.post<{ Params: { groupId: string }; Body: { year: number; label: string; amountCents: number } }>(
    "/groups/:groupId/eliminations",
    { schema: { body: { type: "object", required: ["year", "label", "amountCents"], additionalProperties: false, properties: { year: { type: "integer", minimum: 2000, maximum: 2100 }, label: { type: "string", minLength: 1, maxLength: 160 }, amountCents: { type: "integer", minimum: 0 } } } } },
    async (req, reply) => {
      const g = await groupFor((req as AuthedRequest).userId!, req.params.groupId);
      if (!g) return forbidden(reply);
      await prisma.groupElimination.create({ data: { groupId: g.id, year: req.body.year, label: req.body.label, amountCents: BigInt(req.body.amountCents) } });
      return reply.code(201).send({ ok: true });
    }
  );

  // Consolidated results for one year: each company's column, eliminations, total.
  app.get<{ Params: { groupId: string }; Querystring: { year?: number } }>("/groups/:groupId/consolidated", async (req, reply) => {
    const g = await groupFor((req as AuthedRequest).userId!, req.params.groupId);
    if (!g) return forbidden(reply);
    const rows = [];
    const yearsAll = new Set<number>();
    for (const m of g.members) {
      const ledger = await loadLedger(m.companyId);
      for (const y of completeYears(ledger, await companyAsOf(m.companyId))) yearsAll.add(y);
      rows.push({ m, ledger });
    }
    const years = [...yearsAll].sort();
    const year = req.query.year ?? years.at(-1);
    if (!year) return { group: g.name, years, year: null, companies: [], eliminations: [], total: null };
    type Column = { id: string; name: string; revenueCents: number; cogsCents: number; grossProfitCents: number; opexCents: number; ebitdaCents: number; netIncomeCents: number; cashCents: number; receivablesCents: number; debtCents: number };
    const companies: Column[] = [];
    for (const { m, ledger } of rows) {
      const t = incomeTotals(ledger.accounts, ledger.periods.filter((p) => p.startsWith(String(year))));
      const [wc, debt] = await Promise.all([workingCapital(m.companyId, ledger), totalDebtCents(m.companyId, ledger)]);
      companies.push({ id: m.companyId, name: m.company.name, revenueCents: t.revenue, cogsCents: t.cogs, grossProfitCents: t.grossProfit, opexCents: t.opex, ebitdaCents: t.ebitda, netIncomeCents: t.netIncome, cashCents: wc.cashCents, receivablesCents: wc.receivablesCents, debtCents: debt });
    }
    const elims = g.eliminations.filter((e) => e.year === year).map((e) => ({ id: e.id, label: e.label, amountCents: n(e.amountCents) }));
    const elim = elims.reduce((s, e) => s + e.amountCents, 0);
    const sum = (k: Exclude<keyof Column, "id" | "name">) => companies.reduce((s, c) => s + c[k], 0);
    // An intercompany sale is revenue to one company and cost to another; both come out.
    const total = {
      revenueCents: sum("revenueCents") - elim,
      cogsCents: sum("cogsCents") - elim,
      grossProfitCents: sum("grossProfitCents"),
      opexCents: sum("opexCents"),
      ebitdaCents: sum("ebitdaCents"),
      netIncomeCents: sum("netIncomeCents"),
      cashCents: sum("cashCents"),
      receivablesCents: sum("receivablesCents"),
      debtCents: sum("debtCents"),
    };
    return { group: g.name, years, year, companies, eliminations: elims, total };
  });

  // ---- dashboard layout ----
  app.get<{ Params: { companyId: string } }>("/companies/:companyId/dashboard-layout", async (req) => {
    const userId = (req as AuthedRequest).userId!;
    const l = await prisma.dashboardLayout.findUnique({ where: { userId_companyId: { userId, companyId: req.params.companyId } } });
    return { widgets: l?.widgets ?? [...WIDGETS], available: WIDGETS };
  });
  app.put<{ Params: { companyId: string }; Body: { widgets: string[] } }>(
    "/companies/:companyId/dashboard-layout",
    { schema: { body: { type: "object", required: ["widgets"], additionalProperties: false, properties: { widgets: { type: "array", uniqueItems: true, maxItems: 20, items: { type: "string", enum: [...WIDGETS] } } } } } },
    async (req) => {
      const userId = (req as AuthedRequest).userId!;
      const l = await prisma.dashboardLayout.upsert({
        where: { userId_companyId: { userId, companyId: req.params.companyId } },
        create: { userId, companyId: req.params.companyId, widgets: req.body.widgets },
        update: { widgets: req.body.widgets },
      });
      return { widgets: l.widgets };
    }
  );

  // ---- warehouse export ----
  app.get<{ Params: { companyId: string } }>("/companies/:companyId/export", async () => ({ tables: Object.keys(EXPORT_TABLES) }));
  app.get<{ Params: { companyId: string; table: string } }>("/companies/:companyId/export/:table", async (req, reply) => {
    const role = (req as AuthedRequest).memberRole;
    if (!REPORTING_ROLES.includes(role ?? "")) return reply.code(403).send({ error: "Forbidden", message: "Exports are for owners and accountants." });
    const id = req.params.companyId;
    const company = await prisma.company.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const slug = company.name.replace(/[^A-Za-z0-9]+/g, "-");
    if (req.params.table === "all") {
      // One JSON object per line, tagged with its table: loads straight into a warehouse.
      const lines: string[] = [];
      for (const [table, fn] of Object.entries(EXPORT_TABLES)) for (const row of await fn(id)) lines.push(JSON.stringify({ table, ...row }));
      return reply.header("Content-Type", "application/x-ndjson").header("Content-Disposition", `attachment; filename="${slug}-export.ndjson"`).send(lines.join("\n") + "\n");
    }
    const fn = EXPORT_TABLES[req.params.table as Table];
    if (!fn) return reply.code(404).send({ error: "Not Found", message: "No such table." });
    return reply.header("Content-Type", "text/csv").header("Content-Disposition", `attachment; filename="${slug}-${req.params.table}.csv"`).send(toCsv(await fn(id)));
  });
}
