import type {
  Project as EProject,
  CostEntry as ECost,
  ChangeOrder as ECO,
  BudgetLine as EBudget,
  Asset as EAsset,
  Liability as ELiability,
  RecurringExpense as ERecurring,
  Milestone as EMilestone,
  ServiceContract as EService,
} from "@plumb/shared";

// Prisma stores cents as BigInt. The engine works in `number` cents.
// Cents stay well within Number.MAX_SAFE_INTEGER, so this is lossless.
export const n = (b: bigint): number => Number(b);

export function toEngineProject(p: any): EProject {
  return {
    id: p.id,
    name: p.name,
    client: p.client,
    clientType: p.clientType,
    status: p.status,
    contractValueCents: n(p.contractValue),
    originalBidCostCents: n(p.originalBidCost),
    billedToDateCents: n(p.billedToDate),
    billingType: p.billingType,
    netDays: p.netDays,
    targetMarginPct: p.targetMarginPct,
    retainagePct: p.retainagePct,
    startDate: p.startDate,
    endDate: p.endDate,
    percentComplete: p.percentComplete ?? undefined,
  };
}

export function toEngineCosts(costs: any[]): ECost[] {
  return costs.map((c) => ({
    id: c.id,
    projectId: c.projectId,
    category: c.category,
    amountCents: n(c.amount),
    incurredDate: c.incurredDate,
  }));
}

export function toEngineChangeOrders(cos: any[]): ECO[] {
  return cos.map((c) => ({
    id: c.id,
    projectId: c.projectId,
    contractDeltaCents: n(c.contractDelta),
    costDeltaCents: n(c.costDelta),
    status: c.status,
    date: c.date,
  }));
}

export function toEngineBudgets(lines: any[]): EBudget[] {
  return lines.map((b) => ({
    category: b.category,
    budgetedCostCents: n(b.budgetedCost),
    budgetedHours: b.budgetedHours,
    phaseId: b.phaseId ?? undefined,
  }));
}

export function toEngineAsset(a: any): EAsset {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    purchaseDate: a.purchaseDate,
    purchaseCostCents: n(a.purchaseCost),
    currentValueCents: a.currentValue === null ? undefined : n(a.currentValue),
    valueAsOf: a.valueAsOf ?? undefined,
    usefulLifeMonths: a.usefulLifeMonths ?? undefined,
    salvageValueCents: n(a.salvageValue),
    disposedAt: a.disposedAt ?? undefined,
  };
}

export function toEngineLiability(l: any): ELiability {
  return {
    id: l.id,
    name: l.name,
    kind: l.kind,
    currentBalanceCents: n(l.currentBalance),
    creditLimitCents: l.creditLimit === null ? undefined : n(l.creditLimit),
    interestRatePct: l.interestRatePct,
    paymentAmountCents: n(l.paymentAmount),
    paymentFrequency: l.paymentFrequency,
    nextPaymentDate: l.nextPaymentDate ?? undefined,
    payoffDate: l.payoffDate ?? undefined,
    endDate: l.endDate ?? undefined,
    assetId: l.assetId ?? undefined,
    active: l.active,
  };
}

export function toEngineRecurring(r: any): ERecurring {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    amountCents: n(r.amount),
    frequency: r.frequency,
    startDate: r.startDate,
    endDate: r.endDate ?? undefined,
    active: r.active,
  };
}

export function toEngineMilestone(m: any): EMilestone {
  return {
    id: m.id,
    projectId: m.projectId,
    name: m.name,
    sequence: m.sequence,
    trigger: m.trigger,
    triggerValue: m.triggerValue ?? undefined,
    phaseId: m.phaseId ?? undefined,
    expectedDate: m.expectedDate,
    originalExpectedDate: m.originalExpectedDate,
    amountCents: n(m.amount),
    retainagePct: m.retainagePct,
    status: m.status,
    billedAt: m.billedAt ?? undefined,
    paidAt: m.paidAt ?? undefined,
  };
}

export function toEngineService(c: any): EService {
  return {
    id: c.id,
    name: c.name,
    client: c.client,
    amountCents: n(c.amount),
    billingFrequency: c.billingFrequency,
    netDays: c.netDays,
    startDate: c.startDate,
    endDate: c.endDate ?? undefined,
    renewalDate: c.renewalDate ?? undefined,
    autoRenew: c.autoRenew,
    status: c.status,
    payerDaysLate: c.payer?.typicalDaysLate ?? 0,
  };
}
