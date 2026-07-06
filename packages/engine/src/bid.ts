import {
  type Cents,
  type Capacity,
  marginPct,
  round2,
} from "@plumb/shared";

export type BidRecommendation =
  | "BID_AGGRESSIVE" // want this work; price to win
  | "BID_NORMAL"
  | "BID_SELECTIVE" // only at a premium price
  | "PASS";

export interface ProspectiveBid {
  contractValueCents: Cents;
  estCostCents: Cents;
  targetMarginPct: number;
  /** Estimated labor hours this job needs, per YYYY-MM month. */
  laborHoursByMonth: Record<string, number>;
}

export interface BidContext {
  capacity: Capacity;
  /** Already-committed remaining labor hours per YYYY-MM across active jobs. */
  committedHoursByMonth: Record<string, number>;
  /** Projected worst-case (stress) min cash over the horizon. */
  projectedMinCashCents: Cents;
  safetyThresholdCents: Cents;
  /**
   * Recent realized margin deltas (projectedFinal - target) per closed/active job.
   * Negative average = the shop has been bleeding margin lately.
   */
  recentMarginDeltas: number[];
}

export interface MonthLoad {
  month: string;
  capacityHours: number;
  committedHours: number;
  bidHours: number;
  utilizationIfWon: number; // 0..>1
  state: "UNDERBOOKED" | "HEALTHY" | "TIGHT" | "OVEREXTENDED";
}

export interface BidResult {
  bidMarginPct: number;
  marginVsTargetPct: number;
  monthLoads: MonthLoad[];
  fillsUnderbookedMonths: boolean;
  overextendsAnyMonth: boolean;
  cashHeadroomCents: Cents;
  recentMarginTrendPct: number;
  recommendation: BidRecommendation;
  reasons: string[];
}

const UNDERBOOKED = 0.6;
const TIGHT = 0.9;
const OVEREXTENDED = 1.0;
/** Hard staffing ceiling; above this the job can't physically be crewed. */
const INFEASIBLE = 1.2;

function classify(util: number): MonthLoad["state"] {
  if (util < UNDERBOOKED) return "UNDERBOOKED";
  if (util < TIGHT) return "HEALTHY";
  if (util <= OVEREXTENDED) return "TIGHT";
  return "OVEREXTENDED";
}

export function evaluateBid(bid: ProspectiveBid, ctx: BidContext): BidResult {
  const bidMarginPct = marginPct(bid.contractValueCents, bid.estCostCents);
  const marginVsTargetPct = round2(bidMarginPct - bid.targetMarginPct);

  const months = Object.keys(bid.laborHoursByMonth).sort();
  const monthLoads: MonthLoad[] = months.map((month) => {
    const committed = ctx.committedHoursByMonth[month] ?? 0;
    const bidHours = bid.laborHoursByMonth[month] ?? 0;
    const cap = ctx.capacity.monthlyLaborHours || 1;
    const util = round2((committed + bidHours) / cap);
    return {
      month,
      capacityHours: ctx.capacity.monthlyLaborHours,
      committedHours: committed,
      bidHours,
      utilizationIfWon: util,
      state: classify(util),
    };
  });

  const fillsUnderbookedMonths = monthLoads.some((m) => {
    const cap = ctx.capacity.monthlyLaborHours || 1;
    const currentUtil = m.committedHours / cap;
    return currentUtil < UNDERBOOKED && m.utilizationIfWon <= OVEREXTENDED;
  });
  const overextendsAnyMonth = monthLoads.some(
    (m) => m.utilizationIfWon > OVEREXTENDED
  );
  const infeasible = monthLoads.some((m) => m.utilizationIfWon > INFEASIBLE);

  const cashHeadroomCents =
    ctx.projectedMinCashCents - ctx.safetyThresholdCents;
  const cashTight = cashHeadroomCents < 0;

  const recentMarginTrendPct =
    ctx.recentMarginDeltas.length > 0
      ? round2(
          ctx.recentMarginDeltas.reduce((a, b) => a + b, 0) /
            ctx.recentMarginDeltas.length
        )
      : 0;
  const bleedingMargin = recentMarginTrendPct < -1;

  const reasons: string[] = [];
  let recommendation: BidRecommendation;

  if (infeasible) {
    recommendation = "PASS";
    reasons.push(
      "Cannot be staffed: at least one month exceeds 120% of crew capacity even before slippage."
    );
  } else if (marginVsTargetPct < -3) {
    recommendation = "PASS";
    reasons.push(
      `Bid margin ${bidMarginPct}% is ${Math.abs(marginVsTargetPct)} pts below your ${bid.targetMarginPct}% target — not worth the risk.`
    );
  } else {
    // Feasible. Weigh capacity, cash, and margin trend.
    let score = 0;
    if (fillsUnderbookedMonths) {
      score += 2;
      reasons.push("Fills otherwise under-booked months (keeps the crew busy).");
    }
    if (overextendsAnyMonth) {
      score -= 2;
      reasons.push(
        "Pushes at least one month over 100% capacity — expect overtime or subs."
      );
    }
    if (cashTight) {
      score -= 2;
      reasons.push(
        "Worst-case cash already dips below your safety threshold; fronting this job's costs adds strain."
      );
    } else {
      reasons.push("Cash trajectory has headroom to float this job's costs.");
    }
    if (bleedingMargin) {
      score -= 1;
      reasons.push(
        `Recent jobs are running ${Math.abs(recentMarginTrendPct)} pts under target — price this one with cushion.`
      );
    }
    if (marginVsTargetPct >= 0) {
      score += 1;
      reasons.push(`Bid margin meets or beats target (${bidMarginPct}%).`);
    } else {
      reasons.push(
        `Bid margin ${bidMarginPct}% is ${Math.abs(marginVsTargetPct)} pts under target — recoverable but thin.`
      );
    }

    if (score >= 2) recommendation = "BID_AGGRESSIVE";
    else if (score >= 0) recommendation = "BID_NORMAL";
    else recommendation = "BID_SELECTIVE";
  }

  return {
    bidMarginPct,
    marginVsTargetPct,
    monthLoads,
    fillsUnderbookedMonths,
    overextendsAnyMonth,
    cashHeadroomCents,
    recentMarginTrendPct,
    recommendation,
    reasons,
  };
}
