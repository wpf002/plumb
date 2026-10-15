import type { Cents } from "@plumb/shared";

/**
 * Receivable and payable aging, and which invoices to chase first.
 *
 * "Days late" counts from the due date (issue + terms), so an invoice on
 * Net 45 that is 40 days old is current. Buckets match how a bookkeeper reads
 * an aging report: current, 1-30, 31-60, 61-90, 90+ days past terms.
 */

export interface OpenItem {
  id: string;
  party: string; // customer or vendor name
  partyId?: string | null; // external id, when the source has one
  amountCents: Cents;
  issueDate: Date;
  dueDate: Date;
  /** For receivables: how many days late this customer typically pays. */
  partyAvgDaysLate?: number | null;
}

export const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type Bucket = (typeof BUCKETS)[number];

const DAY = 86_400_000;

export function daysPastDue(item: OpenItem, asOf: Date): number {
  return Math.floor((asOf.getTime() - item.dueDate.getTime()) / DAY);
}

export function bucketOf(days: number): Bucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface PartyAging {
  party: string;
  partyId: string | null;
  buckets: Record<Bucket, Cents>;
  totalCents: Cents;
  pastDue30Cents: Cents;
  oldestDays: number;
}

export interface Aging {
  asOf: string;
  buckets: Record<Bucket, Cents>;
  totalCents: Cents;
  pastDue30Cents: Cents;
  byParty: PartyAging[];
}

const emptyBuckets = (): Record<Bucket, Cents> => ({ current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });

export function agingReport(items: OpenItem[], asOf: Date): Aging {
  const buckets = emptyBuckets();
  const parties = new Map<string, PartyAging>();
  for (const it of items) {
    const days = daysPastDue(it, asOf);
    const b = bucketOf(days);
    buckets[b] += it.amountCents;
    const key = it.partyId ?? it.party;
    const p = parties.get(key) ?? { party: it.party, partyId: it.partyId ?? null, buckets: emptyBuckets(), totalCents: 0, pastDue30Cents: 0, oldestDays: 0 };
    p.buckets[b] += it.amountCents;
    p.totalCents += it.amountCents;
    if (days > 30) p.pastDue30Cents += it.amountCents;
    p.oldestDays = Math.max(p.oldestDays, days);
    parties.set(key, p);
  }
  const totalCents = items.reduce((s, i) => s + i.amountCents, 0);
  const pastDue30Cents = buckets["31-60"] + buckets["61-90"] + buckets["90+"];
  return {
    asOf: asOf.toISOString().slice(0, 10),
    buckets,
    totalCents,
    pastDue30Cents,
    byParty: [...parties.values()].sort((a, b) => b.totalCents - a.totalCents),
  };
}

export interface CollectionPriority {
  id: string;
  party: string;
  amountCents: Cents;
  daysPastDue: number;
  score: number;
  reason: string;
}

/**
 * Rank open invoices by what chasing them is worth. Size matters most, then
 * lateness, then whether this customer habitually pays late (a late invoice
 * from a habitually slow payer needs a call; one from a reliable payer is
 * probably in the mail). `cashImpact` boosts everything when cash is tight.
 */
export function collectionsPriority(items: OpenItem[], asOf: Date, opts: { cashTight?: boolean } = {}): CollectionPriority[] {
  const largest = Math.max(1, ...items.map((i) => i.amountCents));
  return items
    .map((it) => {
      const days = daysPastDue(it, asOf);
      const size = it.amountCents / largest; // 0..1
      const lateness = days <= 0 ? 0 : Math.min(1, days / 90);
      const habit = Math.min(1, Math.max(0, (it.partyAvgDaysLate ?? 0) / 45));
      const score = Math.round((0.5 * size + 0.35 * lateness + 0.15 * habit) * (opts.cashTight ? 1.25 : 1) * 100);
      const reason =
        days > 60
          ? `${days} days past terms`
          : days > 30
            ? `${days} days past terms, ${it.partyAvgDaysLate ? `pays ~${Math.round(it.partyAvgDaysLate)} days late` : "unusual for this customer"}`
            : days > 0
              ? `${days} days past terms`
              : `due in ${-days} days`;
      return { id: it.id, party: it.party, amountCents: it.amountCents, daysPastDue: days, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}
