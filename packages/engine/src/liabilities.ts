import type { Cents, Liability } from "@plumb/shared";
import { PERIODS_PER_YEAR, addPeriod, monthlyEquivalentCents } from "@plumb/shared";

export interface LiabilityPayment {
  liabilityId: string;
  name: string;
  date: Date;
  amountCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  balanceAfterCents: Cents;
}

export interface LiabilitySummary {
  liabilityId: string;
  name: string;
  kind: Liability["kind"];
  currentBalanceCents: Cents;
  monthlyPaymentEquivalentCents: Cents;
  /** Projected payoff within the window, or null if it doesn't clear. */
  projectedPayoffDate: Date | null;
  /** False when the payment doesn't cover interest — the balance never falls. */
  amortizes: boolean;
  creditUtilizationPct: number | null;
}

/** Hard stop so a non-amortizing balance (min-payment credit card) can't loop. */
const MAX_PAYMENTS = 2000;

/**
 * Expand a liability into its individual payments between `from` and `to`.
 *
 * Simple periodic interest: each payment covers accrued interest first, the
 * remainder reduces principal. That's enough for decision support and it keeps
 * the projected balance honest as it feeds net worth. A payment that doesn't
 * cover interest still shows up as an outflow — it just never pays anything off,
 * which is exactly what the owner needs to see.
 */
export function amortizationSchedule(
  liability: Liability,
  from: Date,
  to: Date
): LiabilityPayment[] {
  const out: LiabilityPayment[] = [];
  if (!liability.active) return out;
  if (liability.paymentAmountCents <= 0) return out;

  let balance = liability.currentBalanceCents;
  let date = liability.nextPaymentDate ?? from;
  const periodRate = liability.interestRatePct / 100 / PERIODS_PER_YEAR[liability.paymentFrequency];

  // A lease ends on its end date; a loan ends when it's paid off (or at payoffDate).
  const hardEnd = [liability.endDate, liability.payoffDate]
    .filter((d): d is Date => !!d)
    .reduce<Date | null>((min, d) => (min === null || d < min ? d : min), null);

  let guard = 0;
  while (date <= to && guard++ < MAX_PAYMENTS) {
    if (hardEnd && date > hardEnd) break;
    // A loan with no balance left has nothing to pay; a lease keeps paying rent.
    const isLease =
      liability.kind === "EQUIPMENT_LEASE" || liability.kind === "BUILDING_LEASE";
    if (!isLease && balance <= 0) break;

    const interest = isLease ? 0 : Math.round(balance * periodRate);
    const gross = liability.paymentAmountCents;
    // Never pay more than what's owed (final payment is the stub).
    const amount = isLease ? gross : Math.min(gross, balance + interest);
    const principal = Math.max(0, amount - interest);
    balance = isLease ? balance : Math.max(0, balance - principal);

    if (date >= from) {
      out.push({
        liabilityId: liability.id,
        name: liability.name,
        date,
        amountCents: amount,
        interestCents: interest,
        principalCents: principal,
        balanceAfterCents: balance,
      });
    }
    date = addPeriod(date, liability.paymentFrequency);
  }
  return out;
}

/** Outstanding balance at `asOf`, walking the schedule forward from today. */
export function balanceAtCents(liability: Liability, asOf: Date, from: Date): Cents {
  const payments = amortizationSchedule(liability, from, asOf);
  const last = payments[payments.length - 1];
  return last ? last.balanceAfterCents : liability.currentBalanceCents;
}

export function summarizeLiability(
  liability: Liability,
  from: Date,
  horizonEnd: Date
): LiabilitySummary {
  const schedule = amortizationSchedule(liability, from, horizonEnd);
  const firstPrincipal = schedule[0]?.principalCents ?? 0;
  const isLease =
    liability.kind === "EQUIPMENT_LEASE" || liability.kind === "BUILDING_LEASE";
  // A lease never pays off — it expires. Only a balance-carrying debt has a
  // payoff date, and only if the schedule actually reaches zero in the window.
  const payoff = isLease ? null : schedule.find((p) => p.balanceAfterCents === 0) ?? null;

  return {
    liabilityId: liability.id,
    name: liability.name,
    kind: liability.kind,
    currentBalanceCents: liability.currentBalanceCents,
    monthlyPaymentEquivalentCents: monthlyEquivalentCents(
      liability.paymentAmountCents,
      liability.paymentFrequency
    ),
    projectedPayoffDate: payoff ? payoff.date : null,
    amortizes: isLease || firstPrincipal > 0,
    creditUtilizationPct:
      liability.creditLimitCents && liability.creditLimitCents > 0
        ? Math.round((liability.currentBalanceCents / liability.creditLimitCents) * 1000) / 10
        : null,
  };
}

/** Total fixed debt service per month across every active liability. */
export function monthlyDebtServiceCents(liabilities: Liability[]): Cents {
  return liabilities
    .filter((l) => l.active)
    .reduce(
      (sum, l) => sum + monthlyEquivalentCents(l.paymentAmountCents, l.paymentFrequency),
      0
    );
}
