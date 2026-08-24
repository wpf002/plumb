import type { Frequency } from "./types.js";
import { monthKey } from "./money.js";

/** Where a projected cash event came from. */
export type ScheduleOrigin = "LIABILITY" | "OVERHEAD" | "SERVICE" | "MILESTONE";

/**
 * Identity of one obligation in one period.
 *
 * Monthly and slower cadences bucket by month, so a real bill that lands a few
 * days off its scheduled date still supersedes the projection. Weekly and
 * biweekly cadences bucket by the exact occurrence — those are payroll-shaped
 * and already flow in from QBO directly, so fuzzy matching would do more harm
 * than good.
 */
export function periodKey(frequency: Frequency, occurrence: Date): string {
  if (frequency === "WEEKLY" || frequency === "BIWEEKLY") {
    return occurrence.toISOString().slice(0, 10);
  }
  return monthKey(occurrence);
}

export function sourceKeyFor(
  origin: ScheduleOrigin,
  originId: string,
  frequency: Frequency,
  occurrence: Date
): string {
  return `${origin}:${originId}:${periodKey(frequency, occurrence)}`;
}

/** Milestones aren't recurring — they key off their own id alone. */
export function milestoneSourceKey(milestoneId: string): string {
  return `MILESTONE:${milestoneId}`;
}
