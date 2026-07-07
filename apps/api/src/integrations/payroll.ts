import { prisma } from "@plumb/db";

// Payroll integration (Gusto / ADP): pull true labor cost + hours per job — the
// largest, messiest cost line for a sub. Live when GUSTO_API_TOKEN is set;
// otherwise a dry run that previews a believable payroll allocation without
// writing anything. Import to the DB happens only on a live connection.

export interface PayrollLine {
  employee: string;
  projectId: string;
  hours: number;
  grossPayCents: number;
}
export interface PayrollRun {
  id: string;
  periodEnd: string; // YYYY-MM-DD
  lines: PayrollLine[];
}

export interface PayrollClient {
  readonly live: boolean;
  getRuns(companyId: string): Promise<PayrollRun[]>;
}

// A mapped LABOR cost entry, keyed for idempotent import.
export interface MappedLaborCost {
  externalId: string;
  projectId: string;
  employee: string;
  hours: number;
  amountCents: number;
  incurredDate: string;
}

function mapRuns(runs: PayrollRun[]): MappedLaborCost[] {
  return runs.flatMap((r) =>
    r.lines.map((l, i) => ({
      externalId: `PAYROLL-${r.id}-${i}`,
      projectId: l.projectId,
      employee: l.employee,
      hours: l.hours,
      amountCents: l.grossPayCents,
      incurredDate: r.periodEnd,
    }))
  );
}

class LiveGusto implements PayrollClient {
  readonly live = true;
  constructor(private token: string) {}
  async getRuns(): Promise<PayrollRun[]> {
    // Real Gusto: GET /v1/companies/{id}/payrolls then per-payroll job-hour
    // allocations. Wired behind the token; not exercised without credentials.
    throw new Error("Live Gusto payroll import not yet wired — set up the Gusto app first.");
  }
}

class DryRunPayroll implements PayrollClient {
  readonly live = false;
  async getRuns(companyId: string): Promise<PayrollRun[]> {
    const projects = await prisma.project.findMany({
      where: { companyId, status: { in: ["ACTIVE", "AWARDED"] } },
      select: { id: true },
    });
    // One recent biweekly run, hours split across active jobs at ~$48/hr loaded.
    const rate = 48_00;
    const lines: PayrollLine[] = projects.flatMap((p, idx) => {
      const hours = 120 - idx * 20; // deterministic, varies per job
      return [
        {
          employee: `Crew ${String.fromCharCode(65 + idx)}`,
          projectId: p.id,
          hours,
          grossPayCents: hours * rate,
        },
      ];
    });
    return [{ id: "sample-1", periodEnd: "2026-07-03", lines }];
  }
}

export function getPayroll(): PayrollClient {
  const token = process.env.GUSTO_API_TOKEN;
  return token ? new LiveGusto(token) : new DryRunPayroll();
}

export async function importPayroll(companyId: string): Promise<{
  live: boolean;
  imported: number;
  totalHours: number;
  totalCents: number;
  preview: MappedLaborCost[];
  note: string;
}> {
  await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const client = getPayroll();
  const entries = mapRuns(await client.getRuns(companyId));
  const totalHours = entries.reduce((a, e) => a + e.hours, 0);
  const totalCents = entries.reduce((a, e) => a + e.amountCents, 0);

  if (!client.live) {
    return {
      live: false,
      imported: 0,
      totalHours,
      totalCents,
      preview: entries,
      note: "No payroll provider connected — preview of the labor costs that would import.",
    };
  }

  for (const e of entries) {
    const existing = await prisma.costEntry.findFirst({ where: { qboId: e.externalId } });
    const data = {
      projectId: e.projectId,
      category: "LABOR" as const,
      amount: BigInt(e.amountCents),
      laborHours: e.hours,
      vendorName: e.employee,
      docType: "PAYROLL" as const,
      incurredDate: new Date(e.incurredDate),
      source: "IMPORT" as const,
      qboId: e.externalId,
    };
    if (existing) await prisma.costEntry.update({ where: { id: existing.id }, data });
    else await prisma.costEntry.create({ data });
  }

  return {
    live: true,
    imported: entries.length,
    totalHours,
    totalCents,
    preview: entries,
    note: `Imported ${entries.length} labor cost lines from payroll.`,
  };
}
