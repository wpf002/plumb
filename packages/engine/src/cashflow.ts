import { type Cents, type CashEvent, addDays } from "@plumb/shared";

export interface CashPoint {
  date: string; // YYYY-MM-DD
  balanceCents: Cents;
}

export interface CashScenario {
  series: CashPoint[];
  endingBalanceCents: Cents;
  minBalanceCents: Cents;
  minBalanceDate: string;
  /** First date balance drops below the safety threshold, or null. */
  firstBreachDate: string | null;
}

export interface CashFlowResult {
  base: CashScenario;
  /** Same events, receivables delayed by `stressDelayDays`. */
  stress: CashScenario;
  safetyThresholdCents: Cents;
}

export interface CashFlowInput {
  openingCashCents: Cents;
  events: CashEvent[];
  asOf: Date;
  horizonDays: number; // 30 / 60 / 90 / 120
  safetyThresholdCents: Cents;
  stressDelayDays: number; // e.g. 30 = GC pays a month late
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function signed(e: CashEvent): Cents {
  return e.direction === "IN" ? e.amountCents : -e.amountCents;
}

function buildScenario(
  openingCashCents: Cents,
  events: { date: Date; deltaCents: Cents }[],
  asOf: Date,
  horizonDays: number,
  safetyThresholdCents: Cents
): CashScenario {
  // Bucket deltas by ISO day.
  const byDay = new Map<string, Cents>();
  for (const e of events) {
    const key = isoDay(e.date);
    byDay.set(key, (byDay.get(key) ?? 0) + e.deltaCents);
  }

  const series: CashPoint[] = [];
  let balance = openingCashCents;
  let minBalance = balance;
  let minDate = isoDay(asOf);
  let firstBreach: string | null = null;

  for (let i = 0; i <= horizonDays; i++) {
    const day = isoDay(addDays(asOf, i));
    balance += byDay.get(day) ?? 0;
    series.push({ date: day, balanceCents: balance });
    if (balance < minBalance) {
      minBalance = balance;
      minDate = day;
    }
    if (firstBreach === null && balance < safetyThresholdCents) {
      firstBreach = day;
    }
  }

  return {
    series,
    endingBalanceCents: balance,
    minBalanceCents: minBalance,
    minBalanceDate: minDate,
    firstBreachDate: firstBreach,
  };
}

export function computeCashFlow(input: CashFlowInput): CashFlowResult {
  const {
    openingCashCents,
    events,
    asOf,
    horizonDays,
    safetyThresholdCents,
    stressDelayDays,
  } = input;

  const baseEvents = events.map((e) => ({
    date: e.actualDate ?? e.expectedDate,
    deltaCents: signed(e),
  }));

  // Stress: push every inbound (receivable) later; outbound obligations unchanged.
  const stressEvents = events.map((e) => ({
    date:
      e.direction === "IN"
        ? addDays(e.actualDate ?? e.expectedDate, stressDelayDays)
        : e.actualDate ?? e.expectedDate,
    deltaCents: signed(e),
  }));

  return {
    base: buildScenario(
      openingCashCents,
      baseEvents,
      asOf,
      horizonDays,
      safetyThresholdCents
    ),
    stress: buildScenario(
      openingCashCents,
      stressEvents,
      asOf,
      horizonDays,
      safetyThresholdCents
    ),
    safetyThresholdCents,
  };
}
