import {
  type Cents,
  type CostCategory,
  type CostEntry,
  type ChangeOrder,
  type BudgetLine,
  type Project,
  marginPct,
  round2,
  sumCents,
} from "@plumb/shared";

export interface CategoryVariance {
  category: CostCategory;
  budgetedCents: Cents;
  actualCents: Cents;
  /** Positive = over budget in this category (e.g. material price increase). */
  varianceCents: Cents;
  variancePct: number;
}

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
  /** Per-category over/under vs budget (empty if no budget lines supplied). */
  variances: CategoryVariance[];
  /** Cost categories currently over budget — the "over-budget areas". */
  overBudgetCategories: CostCategory[];
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
  changeOrders: ChangeOrder[],
  budgets: BudgetLine[] = []
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

  // Per-category variance vs budget (drives "over-budget areas" + material/
  // labor cost-increase impact). Only produced when budget lines are supplied.
  const budgetByCategory = CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = sumCents(
        budgets.filter((b) => b.category === cat).map((b) => b.budgetedCostCents)
      );
      return acc;
    },
    {} as Record<CostCategory, Cents>
  );
  const variances: CategoryVariance[] =
    budgets.length === 0
      ? []
      : CATEGORIES.map((cat) => {
          const budgeted = budgetByCategory[cat];
          const actual = byCategoryCents[cat];
          return {
            category: cat,
            budgetedCents: budgeted,
            actualCents: actual,
            varianceCents: actual - budgeted,
            variancePct: budgeted > 0 ? round2(((actual - budgeted) / budgeted) * 100) : 0,
          };
        });
  const overBudgetCategories = variances
    .filter((v) => v.varianceCents > 0)
    .map((v) => v.category);

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
    variances,
    overBudgetCategories,
    atRisk:
      projectedFinalMarginPct < project.targetMarginPct - AT_RISK_MARGIN_TOLERANCE,
  };
}
