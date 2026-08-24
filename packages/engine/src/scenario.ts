import type { CashEvent, Cents, Frequency, Liability } from "@plumb/shared";
import { addDays, addPeriod } from "@plumb/shared";
import { computeCashFlow, type CashFlowInput, type CashFlowResult } from "./cashflow.js";
import { expandSchedules, type ScheduleInput } from "./schedule.js";

/**
 * Everything a forecast is built from, in one value.
 *
 * Scenarios are transforms over this world rather than edits to the database:
 * "what if" must never leave a trace, and the base and the scenario have to be
 * computed from exactly the same inputs to be comparable.
 */
export interface ScenarioWorld {
  asOf: Date;
  horizonDays: number;
  openingCashCents: Cents;
  safetyThresholdCents: Cents;
  stressDelayDays: number;
  stressDelayByProjectId?: Record<string, number>;
  /** Observed events already in the books. */
  ledger: CashEvent[];
  /** Scheduled obligations and billings, expanded at compute time. */
  schedule: ScheduleInput;
}

export type Scenario =
  | { kind: "DELAY_PROJECT"; projectId: string; days: number }
  | { kind: "DELAY_MILESTONE"; milestoneId: string; days: number }
  | { kind: "PAYER_LATE"; days: number; projectId?: string }
  | { kind: "LOSE_INCOME"; originId: string }
  | {
      kind: "NEW_LOAN";
      principalCents: Cents;
      ratePct: number;
      paymentCents: Cents;
      frequency: Frequency;
      startDate: Date;
    }
  | {
      kind: "BUY_ASSET";
      costCents: Cents;
      purchaseDate: Date;
      /** Cash out of pocket at purchase. Defaults to the full cost. */
      downPaymentCents?: Cents;
      /** Present when the rest is financed. */
      financed?: { ratePct: number; paymentCents: Cents; frequency: Frequency };
    }
  | { kind: "HIRE"; monthlyCostCents: Cents; startDate: Date; count?: number }
  | { kind: "REVENUE_CHANGE"; pct: number };

export interface ScenarioDelta {
  minBalanceCents: Cents;
  endingBalanceCents: Cents;
  minBalanceDateBefore: string;
  minBalanceDateAfter: string;
  breachBefore: string | null;
  breachAfter: string | null;
  breachAppeared: boolean;
  breachCleared: boolean;
  /** Worst-case breach, which is usually the one that actually decides things. */
  stressBreachBefore: string | null;
  stressBreachAfter: string | null;
}

export interface ScenarioResult {
  scenario: Scenario;
  description: string;
  base: CashFlowResult;
  result: CashFlowResult;
  delta: ScenarioDelta;
}

const usd = (cents: Cents) =>
  `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;

function buildEvents(world: ScenarioWorld): CashEvent[] {
  return [...world.ledger, ...expandSchedules(world.schedule)];
}

function run(world: ScenarioWorld, events: CashEvent[]): CashFlowResult {
  const input: CashFlowInput = {
    openingCashCents: world.openingCashCents,
    asOf: world.asOf,
    horizonDays: world.horizonDays,
    safetyThresholdCents: world.safetyThresholdCents,
    stressDelayDays: world.stressDelayDays,
    stressDelayByProjectId: world.stressDelayByProjectId,
    events,
  };
  return computeCashFlow(input);
}

/** A synthetic liability, so a hypothetical loan amortizes like a real one. */
function hypotheticalLoan(
  id: string,
  name: string,
  principalCents: Cents,
  ratePct: number,
  paymentCents: Cents,
  frequency: Frequency,
  startDate: Date
): Liability {
  return {
    id,
    name,
    kind: "TERM_LOAN",
    currentBalanceCents: principalCents,
    interestRatePct: ratePct,
    paymentAmountCents: paymentCents,
    paymentFrequency: frequency,
    nextPaymentDate: startDate,
    active: true,
  };
}

function transform(world: ScenarioWorld, s: Scenario): { world: ScenarioWorld; description: string } {
  const schedule = { ...world.schedule };
  let ledger = world.ledger;
  let stressDelayByProjectId = world.stressDelayByProjectId;
  let description = "";

  switch (s.kind) {
    case "DELAY_PROJECT": {
      // Everything this job was going to bill moves out together.
      schedule.milestoneGroups = (schedule.milestoneGroups ?? []).map((g) =>
        g.context.projectId !== s.projectId
          ? g
          : {
              ...g,
              milestones: g.milestones.map((m) =>
                m.status === "PAID"
                  ? m
                  : { ...m, expectedDate: addDays(m.expectedDate, s.days) }
              ),
            }
      );
      description = `The whole job slips ${s.days} days.`;
      break;
    }
    case "DELAY_MILESTONE": {
      schedule.milestoneGroups = (schedule.milestoneGroups ?? []).map((g) => ({
        ...g,
        milestones: g.milestones.map((m) =>
          m.id === s.milestoneId ? { ...m, expectedDate: addDays(m.expectedDate, s.days) } : m
        ),
      }));
      description = `That billing milestone slips ${s.days} days.`;
      break;
    }
    case "PAYER_LATE": {
      // Push what this payer owes without touching anyone else's timing.
      const shift = (e: CashEvent) =>
        e.direction === "IN" && !e.actualDate && (!s.projectId || e.projectId === s.projectId)
          ? { ...e, expectedDate: addDays(e.expectedDate, s.days) }
          : e;
      ledger = ledger.map(shift);
      schedule.milestoneGroups = (schedule.milestoneGroups ?? []).map((g) =>
        s.projectId && g.context.projectId !== s.projectId
          ? g
          : { ...g, context: { ...g.context, payerDaysLate: (g.context.payerDaysLate ?? 0) + s.days } }
      );
      description = `They pay ${s.days} days later than they do today.`;
      break;
    }
    case "LOSE_INCOME": {
      // Drop a recurring income source or a job's remaining billings.
      schedule.milestoneGroups = (schedule.milestoneGroups ?? []).filter(
        (g) => g.context.projectId !== s.originId
      );
      schedule.overheads = (schedule.overheads ?? []).filter((o) => o.id !== s.originId);
      ledger = ledger.filter((e) => !(e.direction === "IN" && !e.actualDate && e.projectId === s.originId));
      description = "That income stops.";
      break;
    }
    case "NEW_LOAN": {
      schedule.liabilities = [
        ...(schedule.liabilities ?? []),
        hypotheticalLoan(
          "scenario-loan",
          "New loan (scenario)",
          s.principalCents,
          s.ratePct,
          s.paymentCents,
          s.frequency,
          s.startDate
        ),
      ];
      // The borrowed money lands up front.
      ledger = [
        ...ledger,
        {
          id: "scenario-loan-draw",
          projectId: null,
          direction: "IN",
          amountCents: s.principalCents,
          category: "LOAN",
          expectedDate: s.startDate,
          actualDate: null,
          status: "EXPECTED",
        },
      ];
      description = `Borrow ${usd(s.principalCents)} at ${s.ratePct}%, paying ${usd(
        s.paymentCents
      )} per period.`;
      break;
    }
    case "BUY_ASSET": {
      const down = s.downPaymentCents ?? s.costCents;
      ledger = [
        ...ledger,
        {
          id: "scenario-asset",
          projectId: null,
          direction: "OUT",
          amountCents: down,
          category: "OVERHEAD",
          expectedDate: s.purchaseDate,
          actualDate: null,
          status: "EXPECTED",
        },
      ];
      const financedCents = s.costCents - down;
      if (s.financed && financedCents > 0) {
        schedule.liabilities = [
          ...(schedule.liabilities ?? []),
          hypotheticalLoan(
            "scenario-asset-loan",
            "Equipment loan (scenario)",
            financedCents,
            s.financed.ratePct,
            s.financed.paymentCents,
            s.financed.frequency,
            addPeriod(s.purchaseDate, s.financed.frequency)
          ),
        ];
      }
      description = `Buy it for ${usd(s.costCents)}${
        financedCents > 0 ? `, ${usd(down)} down and the rest financed` : " in cash"
      }.`;
      break;
    }
    case "HIRE": {
      const count = s.count ?? 1;
      schedule.overheads = [
        ...(schedule.overheads ?? []),
        {
          id: "scenario-hire",
          name: count > 1 ? `${count} new hires (scenario)` : "New hire (scenario)",
          category: "PAYROLL",
          amountCents: s.monthlyCostCents * count,
          frequency: "MONTHLY",
          startDate: s.startDate,
          active: true,
        },
      ];
      description = `Add ${count > 1 ? `${count} people` : "a person"} at ${usd(
        s.monthlyCostCents
      )} a month each, all-in.`;
      break;
    }
    case "REVENUE_CHANGE": {
      const factor = 1 + s.pct / 100;
      const scale = (e: CashEvent) =>
        e.direction === "IN" && !e.actualDate
          ? { ...e, amountCents: Math.round(e.amountCents * factor) }
          : e;
      ledger = ledger.map(scale);
      schedule.milestoneGroups = (schedule.milestoneGroups ?? []).map((g) => ({
        ...g,
        milestones: g.milestones.map((m) =>
          m.status === "PAID" ? m : { ...m, amountCents: Math.round(m.amountCents * factor) }
        ),
      }));
      description = `Revenue ${s.pct < 0 ? "drops" : "rises"} ${Math.abs(s.pct)}%.`;
      break;
    }
  }

  return { world: { ...world, ledger, schedule, stressDelayByProjectId }, description };
}

/**
 * Run one "what if" against the current picture and report what moved.
 *
 * Nothing here touches stored data — the scenario is a transform over the
 * world, so an owner can stress-test a decision before making it.
 */
export function applyScenario(world: ScenarioWorld, s: Scenario): ScenarioResult {
  const base = run(world, buildEvents(world));
  const { world: mutated, description } = transform(world, s);
  const result = run(mutated, buildEvents(mutated));

  return {
    scenario: s,
    description,
    base,
    result,
    delta: {
      minBalanceCents: result.base.minBalanceCents - base.base.minBalanceCents,
      endingBalanceCents: result.base.endingBalanceCents - base.base.endingBalanceCents,
      minBalanceDateBefore: base.base.minBalanceDate,
      minBalanceDateAfter: result.base.minBalanceDate,
      breachBefore: base.base.firstBreachDate,
      breachAfter: result.base.firstBreachDate,
      breachAppeared: !base.base.firstBreachDate && !!result.base.firstBreachDate,
      breachCleared: !!base.base.firstBreachDate && !result.base.firstBreachDate,
      stressBreachBefore: base.stress.firstBreachDate,
      stressBreachAfter: result.stress.firstBreachDate,
    },
  };
}

export interface BuyTimingOption {
  label: string;
  purchaseDate: Date;
  result: ScenarioResult;
}

export interface BuyTimingComparison {
  options: BuyTimingOption[];
  /** The timing that keeps the most cushion under the low point. */
  recommendedLabel: string;
  reasons: string[];
}

/**
 * "Should I buy this truck now or wait?" — the same purchase at two or more
 * timings, compared on the number that actually decides it: how close the
 * business comes to running out of cash.
 */
export function compareBuyTiming(
  world: ScenarioWorld,
  purchase: Omit<Extract<Scenario, { kind: "BUY_ASSET" }>, "kind" | "purchaseDate">,
  timings: { label: string; purchaseDate: Date }[]
): BuyTimingComparison {
  const options = timings.map((t) => ({
    label: t.label,
    purchaseDate: t.purchaseDate,
    result: applyScenario(world, { kind: "BUY_ASSET", ...purchase, purchaseDate: t.purchaseDate }),
  }));

  // Prefer the option that never breaches; among those, the deepest cushion.
  const safe = options.filter((o) => !o.result.delta.breachAppeared);
  const pool = safe.length > 0 ? safe : options;
  const best = pool.reduce((a, b) =>
    b.result.result.base.minBalanceCents > a.result.result.base.minBalanceCents ? b : a
  );

  const reasons = options.map((o) => {
    const low = o.result.result.base.minBalanceCents;
    const breach = o.result.delta.breachAppeared;
    return `${o.label}: low point ${usd(low)}${low < 0 ? " (overdrawn)" : ""}${
      breach ? ", drops under your safety floor" : ""
    }.`;
  });

  return { options, recommendedLabel: best.label, reasons };
}
