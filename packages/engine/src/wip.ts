import {
  type Cents,
  type Project,
  type CostEntry,
  type ChangeOrder,
  sumCents,
  round2,
} from "@plumb/shared";
import { computeMargin } from "./margin.js";

export interface WipRow {
  projectId: string;
  contractCents: Cents;
  percentComplete: number;
  /** contract * percentComplete — revenue you've earned. */
  earnedRevenueCents: Cents;
  billedToDateCents: Cents;
  /** billed - earned. Positive = overbilled (client financing you = good). */
  overUnderBillingCents: Cents;
  state: "OVERBILLED" | "UNDERBILLED" | "ON_TRACK";
  costToDateCents: Cents;
  projectedFinalCostCents: Cents;
  projectedProfitCents: Cents;
}

export interface WipReport {
  rows: WipRow[];
  totalOverbilledCents: Cents;
  totalUnderbilledCents: Cents;
  /** Net working-capital position from billing timing. */
  netOverUnderCents: Cents;
}

const ON_TRACK_BAND = 0.02; // within 2% of earned = "on track"

export function computeWip(
  projects: {
    project: Project;
    costs: CostEntry[];
    changeOrders: ChangeOrder[];
  }[]
): WipReport {
  const rows: WipRow[] = projects.map(({ project, costs, changeOrders }) => {
    const m = computeMargin(project, costs, changeOrders);
    const contract = m.adjustedContractCents;
    const earned = Math.round(contract * m.percentComplete);
    const overUnder = project.billedToDateCents - earned;
    const band = Math.round(contract * ON_TRACK_BAND);

    let state: WipRow["state"] = "ON_TRACK";
    if (overUnder > band) state = "OVERBILLED";
    else if (overUnder < -band) state = "UNDERBILLED";

    return {
      projectId: project.id,
      contractCents: contract,
      percentComplete: m.percentComplete,
      earnedRevenueCents: earned,
      billedToDateCents: project.billedToDateCents,
      overUnderBillingCents: overUnder,
      state,
      costToDateCents: m.costToDateCents,
      projectedFinalCostCents: m.projectedFinalCostCents,
      projectedProfitCents: contract - m.projectedFinalCostCents,
    };
  });

  const totalOverbilledCents = sumCents(
    rows.filter((r) => r.overUnderBillingCents > 0).map((r) => r.overUnderBillingCents)
  );
  const totalUnderbilledCents = sumCents(
    rows.filter((r) => r.overUnderBillingCents < 0).map((r) => r.overUnderBillingCents)
  );

  return {
    rows,
    totalOverbilledCents,
    totalUnderbilledCents,
    netOverUnderCents: totalOverbilledCents + totalUnderbilledCents,
  };
}

/** Convenience: round a ratio the same way the engine does elsewhere. */
export const wipRound = round2;
