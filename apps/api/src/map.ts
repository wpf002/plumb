import type {
  Project as EProject,
  CostEntry as ECost,
  ChangeOrder as ECO,
  BudgetLine as EBudget,
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
