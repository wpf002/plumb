import { prisma } from "@plumb/db";
import type { AdapterContext, CanonicalBatch, SourceAdapter } from "./types.js";
import { cents, rng } from "./sample.js";

/**
 * Gusto payroll: gross pay and hours per employee per month. Live with a
 * per-company token and company id, or GUSTO_API_TOKEN + GUSTO_COMPANY_ID.
 */

const creds = (ctx: AdapterContext) => ({ token: ctx.credentials?.token ?? process.env.GUSTO_API_TOKEN, company: ctx.credentials?.companyId ?? process.env.GUSTO_COMPANY_ID });

async function get<T>(ctx: AdapterContext, path: string): Promise<T> {
  const res = await fetch(`https://api.gusto.com${path}`, { headers: { Authorization: `Bearer ${creds(ctx).token}`, "X-Gusto-API-Version": "2024-04-01" } });
  if (!res.ok) throw new Error(`Gusto ${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

interface GustoPayroll {
  pay_period: { end_date: string };
  employee_compensations: { employee_uuid: string; gross_pay: string; hourly_compensations?: { name: string; hours: string }[] }[];
}

export const gusto: SourceAdapter = {
  key: "gusto",
  name: "Gusto",
  category: "payroll",
  phase: 1,
  env: ["GUSTO_API_TOKEN", "GUSTO_COMPANY_ID"],
  provides: ["payroll"],
  live: (ctx) => !!(creds(ctx).token && creds(ctx).company),
  async fetch(ctx) {
    const c = creds(ctx);
    const employees = await get<{ uuid: string; first_name: string; last_name: string; jobs?: { title: string }[] }[]>(ctx, `/v1/companies/${c.company}/employees`);
    const names = new Map(employees.map((e) => [e.uuid, { name: `${e.first_name} ${e.last_name}`, title: e.jobs?.[0]?.title ?? null }]));
    const start = (ctx.since ?? new Date(Date.now() - 730 * 86_400_000)).toISOString().slice(0, 10);
    const payrolls = await get<GustoPayroll[]>(ctx, `/v1/companies/${c.company}/payrolls?processing_statuses=processed&include=employee_compensations&start_date=${start}`);
    const byKey = new Map<string, NonNullable<CanonicalBatch["payroll"]>[number]>();
    for (const p of payrolls) {
      const period = p.pay_period.end_date.slice(0, 7);
      for (const e of p.employee_compensations) {
        const k = `${e.employee_uuid}|${period}`;
        const row = byKey.get(k) ?? { employeeExternalId: e.employee_uuid, employeeName: names.get(e.employee_uuid)?.name ?? e.employee_uuid, position: names.get(e.employee_uuid)?.title ?? null, period, grossPayCents: 0, regularHours: 0, overtimeHours: 0 };
        row.grossPayCents += Math.round(Number(e.gross_pay) * 100);
        for (const h of e.hourly_compensations ?? []) {
          if (/overtime/i.test(h.name)) row.overtimeHours! += Number(h.hours);
          else row.regularHours! += Number(h.hours);
        }
        byKey.set(k, row);
      }
    }
    return { payroll: [...byKey.values()] };
  },
  sample(ctx) {
    const r = rng(`gusto:${ctx.companyId}`);
    const roster = ["Lead Tech", "Journeyman", "Journeyman", "Apprentice", "Apprentice", "Office Manager"];
    const now = new Date();
    const payroll: NonNullable<CanonicalBatch["payroll"]> = [];
    for (let m = 3; m >= 1; m--) {
      const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1)).toISOString().slice(0, 7);
      roster.forEach((title, i) => {
        const hours = 160 + Math.round(r() * 16);
        const ot = i < 5 ? Math.round(r() * 14) : 0;
        const rate = [42, 36, 34, 22, 21, 28][i];
        payroll.push({ employeeExternalId: `emp${i}`, employeeName: `${title} ${i + 1}`, position: title, period, grossPayCents: cents(hours * rate + ot * rate * 1.5), regularHours: hours, overtimeHours: ot });
      });
    }
    return { payroll };
  },
};

/** Employees on the books already, so a preview can show what would change. */
export async function knownEmployees(companyId: string) {
  return prisma.employee.count({ where: { companyId } });
}
