import { prisma } from "@plumb/db";
import { computeMargin } from "@plumb/engine";
import { toEngineProject, toEngineCosts, toEngineChangeOrders } from "../map.js";

// Tax obligation timing: estimate quarterly tax from projected annual profit and
// feed it into the cash forecast, so the quarterly hit shows up as a future
// outflow. "Live" (TAX_PROVIDER set, e.g. a tax-pro export) writes the events;
// otherwise it's a non-mutating preview.

export interface TaxObligation {
  externalId: string;
  dueDate: string; // YYYY-MM-DD
  amountCents: number;
}

const DEFAULT_RATE_PCT = 25;

// The four US estimated-tax deadlines, as month-day. Jan belongs to next year.
const DEADLINES = [
  { m: 3, d: 15 }, // Apr 15 (0-indexed month)
  { m: 5, d: 15 }, // Jun 15
  { m: 8, d: 15 }, // Sep 15
  { m: 0, d: 15 }, // Jan 15
];

export function nextFourDeadlines(asOf: Date): Date[] {
  const out: Date[] = [];
  let year = asOf.getUTCFullYear();
  while (out.length < 4) {
    for (const dl of DEADLINES) {
      const yr = dl.m === 0 ? year + 1 : year;
      const date = new Date(Date.UTC(yr, dl.m, dl.d));
      if (date > asOf && out.length < 4) out.push(date);
    }
    year += 1;
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, 4);
}

export async function projectTax(
  companyId: string,
  opts: { ratePct?: number; asOf?: Date } = {}
): Promise<{
  live: boolean;
  ratePct: number;
  annualProfitCents: number;
  annualTaxCents: number;
  obligations: TaxObligation[];
  applied: boolean;
  note: string;
}> {
  await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const asOf = opts.asOf ?? new Date();
  const ratePct = opts.ratePct ?? (Number(process.env.TAX_RATE_PCT) || DEFAULT_RATE_PCT);

  const projects = await prisma.project.findMany({
    where: { companyId, status: { in: ["ACTIVE", "AWARDED"] } },
    include: { costs: true, changeOrders: true },
  });
  const annualProfitCents = projects.reduce((sum, p) => {
    const m = computeMargin(toEngineProject(p), toEngineCosts(p.costs), toEngineChangeOrders(p.changeOrders));
    return sum + (m.adjustedContractCents - m.projectedFinalCostCents);
  }, 0);

  const annualTaxCents = Math.max(0, Math.round((annualProfitCents * ratePct) / 100));
  const perQuarter = Math.round(annualTaxCents / 4);
  const obligations: TaxObligation[] = nextFourDeadlines(asOf).map((date) => {
    const iso = date.toISOString().slice(0, 10);
    return { externalId: `TAX-${iso}`, dueDate: iso, amountCents: perQuarter };
  });

  const live = Boolean(process.env.TAX_PROVIDER);
  if (!live) {
    return {
      live: false,
      ratePct,
      annualProfitCents,
      annualTaxCents,
      obligations,
      applied: false,
      note: `Preview: ${ratePct}% of projected annual profit, split across four quarters. Connect a tax source to add these to the forecast.`,
    };
  }

  for (const o of obligations) {
    const existing = await prisma.cashEvent.findFirst({ where: { qboId: o.externalId } });
    const data = {
      companyId,
      projectId: null,
      direction: "OUT" as const,
      amount: BigInt(o.amountCents),
      category: "TAX" as const,
      expectedDate: new Date(o.dueDate),
      status: "EXPECTED" as const,
      qboId: o.externalId,
    };
    if (existing) await prisma.cashEvent.update({ where: { id: existing.id }, data });
    else await prisma.cashEvent.create({ data });
  }

  return {
    live: true,
    ratePct,
    annualProfitCents,
    annualTaxCents,
    obligations,
    applied: true,
    note: `Added ${obligations.length} quarterly tax obligations to the cash forecast.`,
  };
}
