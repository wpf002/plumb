import { prisma } from "@plumb/db";
import type { CanonicalBatch } from "./types.js";

/**
 * Write a canonical batch into the company's books. Every record is keyed by
 * `${source}:${externalId}`, so running the same sync twice changes nothing.
 * Returns how many records of each kind were written.
 */

const DAY = 86_400_000;
const ext = (source: string, id: string) => `${source}:${id}`;
const terms = (issue: Date, due?: Date | null) => (due ? Math.max(0, Math.round((due.getTime() - issue.getTime()) / DAY)) : 30);

export async function applyBatch(companyId: string, source: string, b: CanonicalBatch): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  const customerIds = new Map<string, string>();
  const customerByName = async (name: string) => {
    const existing = await prisma.customer.findFirst({ where: { companyId, name } });
    if (existing) return existing.id;
    const c = await prisma.customer.create({ data: { companyId, name, externalId: ext(source, `name:${name}`) } });
    bump("customers");
    return c.id;
  };
  for (const c of b.customers ?? []) {
    const row = await prisma.customer.upsert({
      where: { companyId_externalId: { companyId, externalId: ext(source, c.externalId) } },
      create: { companyId, externalId: ext(source, c.externalId), name: c.name, segment: c.segment ?? null },
      update: { name: c.name, ...(c.segment !== undefined && { segment: c.segment }) },
    });
    customerIds.set(c.externalId, row.id);
    bump("customers");
  }
  const customerFor = async (id?: string | null, name?: string | null) => {
    if (id) {
      if (customerIds.has(id)) return customerIds.get(id)!;
      const found = await prisma.customer.findUnique({ where: { companyId_externalId: { companyId, externalId: ext(source, id) } } });
      if (found) return found.id;
    }
    return name ? customerByName(name) : null;
  };

  const vendorIds = new Map<string, string>();
  for (const v of b.vendors ?? []) {
    const row = await prisma.vendor.upsert({
      where: { companyId_externalId: { companyId, externalId: ext(source, v.externalId) } },
      create: { companyId, externalId: ext(source, v.externalId), name: v.name, category: v.category ?? null },
      update: { name: v.name },
    });
    vendorIds.set(v.externalId, row.id);
    bump("vendors");
  }

  const jobIds = new Map<string, string>();
  for (const j of b.jobs ?? []) {
    const customerId = await customerFor(j.customerExternalId, j.customerName);
    const start = j.startDate ?? new Date();
    const data = {
      name: j.name,
      client: j.customerName ?? j.name,
      status: j.status,
      contractValue: BigInt(j.contractCents),
      ...(j.estimatedCostCents != null && { originalBidCost: BigInt(j.estimatedCostCents) }),
      ...(j.percentComplete != null && { percentComplete: j.percentComplete }),
      ...(j.category && { category: j.category }),
      customerId,
    };
    const row = await prisma.project.upsert({
      where: { companyId_externalId: { companyId, externalId: ext(source, j.externalId) } },
      create: {
        companyId,
        externalId: ext(source, j.externalId),
        clientType: "OWNER_DIRECT",
        originalBidCost: BigInt(j.estimatedCostCents ?? Math.round(j.contractCents * 0.75)),
        targetMarginPct: j.estimatedCostCents != null && j.contractCents > 0 ? Math.round((1 - j.estimatedCostCents / j.contractCents) * 1000) / 10 : 25,
        startDate: start,
        endDate: j.endDate ?? new Date(start.getTime() + 60 * DAY),
        ...data,
      },
      update: { ...data, ...(j.endDate && { endDate: j.endDate }) },
    });
    jobIds.set(j.externalId, row.id);
    bump("jobs");
  }
  const jobFor = async (id?: string | null) => {
    if (!id) return null;
    if (jobIds.has(id)) return jobIds.get(id)!;
    const p = await prisma.project.findUnique({ where: { companyId_externalId: { companyId, externalId: ext(source, id) } } });
    return p?.id ?? null;
  };

  for (const i of b.invoices ?? []) {
    const due = i.dueDate ?? new Date(i.issueDate.getTime() + 30 * DAY);
    const data = {
      customerId: await customerFor(i.customerExternalId, i.customerName),
      projectId: await jobFor(i.jobExternalId),
      issueDate: i.issueDate,
      dueDate: due,
      termsDays: terms(i.issueDate, due),
      amount: BigInt(i.amountCents),
      paidDate: i.paidDate ?? null,
      status: i.paidDate ? ("PAID" as const) : ("OPEN" as const),
      source,
    };
    await prisma.invoice.upsert({
      where: { companyId_externalId: { companyId, externalId: ext(source, i.externalId) } },
      create: { companyId, externalId: ext(source, i.externalId), ...data },
      update: data,
    });
    bump("invoices");
  }

  for (const x of b.bills ?? []) {
    let vendorId = x.vendorExternalId ? vendorIds.get(x.vendorExternalId) ?? null : null;
    if (!vendorId && x.vendorName) {
      const v = (await prisma.vendor.findFirst({ where: { companyId, name: x.vendorName } })) ?? (await prisma.vendor.create({ data: { companyId, name: x.vendorName, externalId: ext(source, `name:${x.vendorName}`) } }));
      vendorId = v.id;
    }
    const due = x.dueDate ?? new Date(x.billDate.getTime() + 30 * DAY);
    const data = { vendorId, billDate: x.billDate, dueDate: due, termsDays: terms(x.billDate, due), amount: BigInt(x.amountCents), paidDate: x.paidDate ?? null, status: x.paidDate ? ("PAID" as const) : ("OPEN" as const), category: x.category ?? null };
    await prisma.bill.upsert({
      where: { companyId_externalId: { companyId, externalId: ext(source, x.externalId) } },
      create: { companyId, externalId: ext(source, x.externalId), ...data },
      update: data,
    });
    bump("bills");
  }

  for (const p of b.payments ?? []) {
    const inv = await prisma.invoice.findUnique({ where: { companyId_externalId: { companyId, externalId: ext(source, p.invoiceExternalId) } } });
    if (!inv) continue;
    const dupe = await prisma.payment.findFirst({ where: { invoiceId: inv.id, receivedDate: p.date, amount: BigInt(p.amountCents) } });
    if (dupe) continue;
    await prisma.payment.create({ data: { invoiceId: inv.id, receivedDate: p.date, amount: BigInt(p.amountCents) } });
    bump("payments");
  }

  const accountIds = new Map<string, string>();
  let depository = 0;
  let asOf: Date | null = null;
  for (const a of b.accounts ?? []) {
    const row = await prisma.bankAccount.upsert({
      where: { companyId_source_externalId: { companyId, source, externalId: a.externalId } },
      create: { companyId, source, externalId: a.externalId, name: a.name, type: a.type, mask: a.mask ?? null, balance: BigInt(a.balanceCents), balanceAsOf: a.asOf },
      update: { name: a.name, balance: BigInt(a.balanceCents), balanceAsOf: a.asOf },
    });
    accountIds.set(a.externalId, row.id);
    if (a.type === "checking" || a.type === "savings") {
      depository += a.balanceCents;
      asOf = a.asOf;
    }
    bump("accounts");
  }
  // Bank balances become the opening cash the forecast starts from.
  if (asOf && (b.accounts ?? []).some((a) => a.type === "checking" || a.type === "savings")) {
    await prisma.cashSnapshot.create({ data: { companyId, asOf, balance: BigInt(depository), source: source.toUpperCase() } });
  }

  for (const t of b.transactions ?? []) {
    const accountId = t.accountExternalId ? accountIds.get(t.accountExternalId) ?? (await prisma.bankAccount.findFirst({ where: { companyId, source, externalId: t.accountExternalId } }))?.id ?? null : null;
    const data = { accountId, date: t.date, amount: BigInt(t.amountCents), description: t.description, merchant: t.merchant ?? null, category: t.category ?? null, kind: t.kind ?? null, pending: t.pending ?? false };
    await prisma.bankTransaction.upsert({
      where: { companyId_source_externalId: { companyId, source, externalId: t.externalId } },
      create: { companyId, source, externalId: t.externalId, ...data },
      update: data,
    });
    bump("transactions");
  }

  const employeeFor = async (id: string, name: string, position?: string | null) => {
    const e = await prisma.employee.upsert({
      where: { companyId_externalId: { companyId, externalId: ext(source, id) } },
      create: { companyId, externalId: ext(source, id), name, position: position ?? null, payType: "HOURLY", cogsAllocationPct: 1 },
      update: { name, ...(position && { position }) },
    });
    return e.id;
  };
  if (b.payroll?.length) {
    // Replace the source's rows for the periods it reports, then insert.
    const rows = [];
    for (const p of b.payroll) {
      const employeeId = await employeeFor(p.employeeExternalId, p.employeeName, p.position);
      await prisma.timeEntry.deleteMany({ where: { companyId, employeeId, period: p.period, projectId: null } });
      rows.push({ companyId, employeeId, period: p.period, regularHours: p.regularHours ?? 0, overtimeHours: p.overtimeHours ?? 0, grossPay: BigInt(p.grossPayCents) });
    }
    await prisma.timeEntry.createMany({ data: rows });
    bump("payroll", rows.length);
  }
  for (const t of b.timeEntries ?? []) {
    const employeeId = await employeeFor(t.employeeExternalId, t.employeeName);
    const projectId = await jobFor(t.jobExternalId);
    await prisma.timeEntry.create({
      data: { companyId, employeeId, projectId, period: t.date.toISOString().slice(0, 7), date: t.date, regularHours: t.hours, overtimeHours: t.overtimeHours ?? 0, grossPay: BigInt(t.costCents ?? 0) },
    });
    bump("timeEntries");
  }

  for (const o of b.opportunities ?? []) {
    const customerId = o.customerName ? await customerByName(o.customerName) : null;
    const data = {
      description: o.description,
      customerId,
      estimatedValue: BigInt(o.valueCents),
      probabilityPct: o.probabilityPct,
      expectedStart: o.expectedStart ?? null,
      expectedClose: o.expectedClose ?? null,
      status: o.status,
      lostReason: o.lostReason ?? null,
      lostYear: o.status === "LOST" ? (o.expectedClose ?? new Date()).getUTCFullYear() : null,
    };
    await prisma.opportunity.upsert({
      where: { companyId_externalId: { companyId, externalId: ext(source, o.externalId) } },
      create: { companyId, externalId: ext(source, o.externalId), ...data },
      update: data,
    });
    bump("opportunities");
  }

  for (const v of b.vehicles ?? []) {
    // Telematics enrich fleet assets already on the books; match by id, then name.
    const asset =
      (await prisma.asset.findFirst({ where: { companyId, externalId: ext(source, v.externalId) } })) ??
      (await prisma.asset.findFirst({ where: { companyId, name: { equals: v.name, mode: "insensitive" } } }));
    if (!asset) continue;
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        ...(v.utilizationPct != null && { utilizationPct: v.utilizationPct }),
        ...(v.fuelCostAnnualCents != null && { fuelCostAnnual: BigInt(v.fuelCostAnnualCents) }),
        ...(v.maintenanceCostAnnualCents != null && { maintenanceCostAnnual: BigInt(v.maintenanceCostAnnualCents) }),
        ...(v.downtimeDaysAnnual != null && { downtimeDaysAnnual: v.downtimeDaysAnnual }),
      },
    });
    bump("vehicles");
  }

  return counts;
}

/** Counts and a few rows of each kind, for a preview that writes nothing. */
export function summarizeBatch(b: CanonicalBatch) {
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(b)) if (Array.isArray(v) && v.length) counts[k] = v.length;
  return counts;
}
