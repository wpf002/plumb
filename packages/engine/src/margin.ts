import {
  type Cents,
  type CostCategory,
  type CostEntry,
  type ChangeOrder,
  type Project,
  marginPct,
  round2,
  sumCents,
} from "@plumb/shared";

export interface MarginResult {
  projectId: string;
  adjustedContractCents: Cents;
  budgetCostCents: Cents;
  costToDateCents: Cents;
  projectedFinalCostCents: Cents;
  percentComplete: number;
  originalMarginPct: number;
  projectedFinalMarginPct: number;
  /** Positive = margin eroded since bid. */
  marginErosionPct: number;
  /** Positive = projected to spend more than budget. */
  costOverrunCents: Cents;
  byCategoryCents: Record<CostCategory, Cents>;
  atRisk: boolean;
}

const CATEGORIES: CostCategory[] = [
  "LABOR",
  "MATERIAL",
  "EQUIPMENT",
  "TRAVEL",
  "SUBCONTRACT",
  "OTHER",
];

/** How many margin points below target before a project is flagged at risk. */
const AT_RISK_MARGIN_TOLERANCE = 2;

export function computeMargin(
  project: Project,
  costs: CostEntry[],
  changeOrders: ChangeOrder[]
): MarginResult {
  const approved = changeOrders.filter((c) => c.status === "APPROVED");
  const contractDelta = sumCents(approved.map((c) => c.contractDeltaCents));
  const costDelta = sumCents(approved.map((c) => c.costDeltaCents));

  const adjustedContractCents = project.contractValueCents + contractDelta;
  const budgetCostCents = project.originalBidCostCents + costDelta;
  const costToDateCents = sumCents(costs.map((c) => c.amountCents));

  // Earned completion. Prefer PM input; else infer from cost burn against budget.
  const percentComplete =
    project.percentComplete ??
    (budgetCostCents > 0
      ? Math.min(1, costToDateCents / budgetCostCents)
      : 0);

  // Project final cost by burn rate. If nothing earned yet, assume budget holds.
  const projectedFinalCostCents =
    percentComplete > 0
      ? Math.round(costToDateCents / percentComplete)
      : budgetCostCents;

  const byCategoryCents = CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = sumCents(
        costs.filter((c) => c.category === cat).map((c) => c.amountCents)
      );
      return acc;
    },
    {} as Record<CostCategory, Cents>
  );

  const originalMarginPct = marginPct(
    project.contractValueCents,
    project.originalBidCostCents
  );
  const projectedFinalMarginPct = marginPct(
    adjustedContractCents,
    projectedFinalCostCents
  );

  return {
    projectId: project.id,
    adjustedContractCents,
    budgetCostCents,
    costToDateCents,
    projectedFinalCostCents,
    percentComplete: round2(percentComplete),
    originalMarginPct,
    projectedFinalMarginPct,
    marginErosionPct: round2(originalMarginPct - projectedFinalMarginPct),
    costOverrunCents: projectedFinalCostCents - budgetCostCents,
    byCategoryCents,
    atRisk:
      projectedFinalMarginPct < project.targetMarginPct - AT_RISK_MARGIN_TOLERANCE,
  };
}
