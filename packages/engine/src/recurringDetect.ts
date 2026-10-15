import type { Cents } from "@plumb/shared";
import { addDays } from "@plumb/shared";

/**
 * Find recurring charges and deposits in a bank or card feed: rent, loan
 * payments, software, insurance, maintenance-contract receipts. Groups by
 * normalized merchant and direction, then looks for a steady cadence and a
 * steady amount.
 */

export interface TxnLike {
  date: Date;
  amountCents: Cents;
  description: string;
  merchant?: string | null;
}

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

const CADENCES: { cadence: Cadence; days: number; lo: number; hi: number; minCount: number; perMonth: number }[] = [
  { cadence: "weekly", days: 7, lo: 6, hi: 8, minCount: 4, perMonth: 52 / 12 },
  { cadence: "biweekly", days: 14, lo: 12, hi: 16, minCount: 3, perMonth: 26 / 12 },
  { cadence: "monthly", days: 30, lo: 26, hi: 35, minCount: 3, perMonth: 1 },
  { cadence: "quarterly", days: 91, lo: 82, hi: 100, minCount: 3, perMonth: 1 / 3 },
  { cadence: "annual", days: 365, lo: 350, hi: 380, minCount: 2, perMonth: 1 / 12 },
];

export interface RecurringSeries {
  key: string;
  label: string;
  direction: "in" | "out";
  cadence: Cadence;
  count: number;
  typicalAmountCents: Cents;
  /** Largest deviation of any amount from the typical one, in percent. */
  amountSpreadPct: number;
  lastDate: string;
  nextDate: string;
  monthlyEquivalentCents: Cents;
  /** Share of intervals and amounts that fit the pattern, 0 to 1. */
  confidence: number;
}

const NOISE = /\b(pos|ach|debit|credit|card|purchase|online|pmt|payment|recurring|autopay|web|id|ref|ppd|ccd|des|indn|co|inc|llc|corp)\b/g;

/** "ACH DEBIT ALLY AUTO PMT 0423 #88213" and "ALLY AUTO PMT 0523" both become "ally auto". */
export function normalizeMerchant(description: string, merchant?: string | null): string {
  const base = (merchant || description).toLowerCase();
  return base
    .replace(/[#*]\S+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z& ]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function detectRecurring(txns: TxnLike[], opts: { amountTolerancePct?: number; minConfidence?: number } = {}): RecurringSeries[] {
  const tol = (opts.amountTolerancePct ?? 15) / 100;
  const minConfidence = opts.minConfidence ?? 0.7;
  const groups = new Map<string, TxnLike[]>();
  for (const t of txns) {
    if (t.amountCents === 0) continue;
    const name = normalizeMerchant(t.description, t.merchant);
    if (!name) continue;
    const key = `${t.amountCents > 0 ? "in" : "out"}:${name}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: RecurringSeries[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const gaps = sorted.slice(1).map((t, i) => (t.date.getTime() - sorted[i].date.getTime()) / 86_400_000);
    const gap = median(gaps);
    const c = CADENCES.find((x) => gap >= x.lo && gap <= x.hi);
    if (!c || sorted.length < c.minCount) continue;
    const intervalFit = gaps.filter((g) => g >= c.lo && g <= c.hi).length / gaps.length;
    const amounts = sorted.map((t) => Math.abs(t.amountCents));
    const typical = median(amounts);
    const amountFit = amounts.filter((a) => Math.abs(a - typical) <= typical * tol).length / amounts.length;
    const confidence = Math.round(intervalFit * amountFit * 100) / 100;
    if (confidence < minConfidence) continue;
    const last = sorted.at(-1)!;
    out.push({
      key,
      label: key.split(":")[1].replace(/\b\w/g, (m) => m.toUpperCase()),
      direction: key.startsWith("in") ? "in" : "out",
      cadence: c.cadence,
      count: sorted.length,
      typicalAmountCents: Math.round(typical),
      amountSpreadPct: Math.round((Math.max(...amounts.map((a) => Math.abs(a - typical))) / typical) * 1000) / 10,
      lastDate: last.date.toISOString().slice(0, 10),
      nextDate: addDays(last.date, c.days).toISOString().slice(0, 10),
      monthlyEquivalentCents: Math.round(typical * c.perMonth),
      confidence,
    });
  }
  return out.sort((a, b) => b.monthlyEquivalentCents - a.monthlyEquivalentCents);
}
