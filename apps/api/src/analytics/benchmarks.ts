import { prisma } from "@plumb/db";
import { incomeTotals } from "@plumb/engine";
import { companyAsOf } from "../snapshot.js";
import { loadLedger, type Ledger } from "./ledger.js";
import { completeYears, recurringAnnual, revenuePerFieldEmployee } from "./operations.js";
import { arAging, debtDashboard, workingCapital } from "./workingcapital.js";

/**
 * Benchmarks against the other companies on this DNRD install, anonymized.
 * Nothing here is survey data: a metric is shown only when at least three
 * peers report it, and peers are never named.
 */

const MIN_PEERS = 3;
const pct = (v: number, base: number) => (base ? (v / base) * 100 : 0);

export const METRICS = [
  { key: "grossMarginPct", label: "Gross Margin", unit: "pct", higherIsBetter: true },
  { key: "ebitdaMarginPct", label: "EBITDA Margin", unit: "pct", higherIsBetter: true },
  { key: "revenueGrowthPct", label: "Revenue Growth", unit: "pct", higherIsBetter: true },
  { key: "dsoDays", label: "Days to Collect", unit: "days", higherIsBetter: false },
  { key: "currentRatio", label: "Current Ratio", unit: "ratio", higherIsBetter: true },
  { key: "revenuePerFieldCents", label: "Revenue per Field Employee", unit: "money", higherIsBetter: true },
  { key: "debtToEbitda", label: "Debt to EBITDA", unit: "ratio", higherIsBetter: false },
  { key: "recurringSharePct", label: "Recurring Revenue Share", unit: "pct", higherIsBetter: true },
] as const;

type Key = (typeof METRICS)[number]["key"];
type Profile = Partial<Record<Key, number>> & { companyId: string; name: string; year: number | null };

async function profile(companyId: string, name: string, ledger: Ledger): Promise<Profile> {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const y = years.at(-1);
  if (!y) return { companyId, name, year: null };
  const t = incomeTotals(ledger.accounts, ledger.periods.filter((p) => p.startsWith(String(y))));
  const prev = years.at(-2);
  const tp = prev ? incomeTotals(ledger.accounts, ledger.periods.filter((p) => p.startsWith(String(prev)))) : null;
  const [wc, debt, field, rec, ar] = await Promise.all([
    workingCapital(companyId, ledger),
    debtDashboard(companyId, ledger),
    revenuePerFieldEmployee(companyId, ledger, y),
    recurringAnnual(companyId, ledger, y),
    arAging(companyId),
  ]);
  const p: Profile = { companyId, name, year: y };
  if (t.revenue > 0) {
    p.grossMarginPct = pct(t.grossProfit, t.revenue);
    p.ebitdaMarginPct = pct(t.ebitda, t.revenue);
    p.dsoDays = (ar.aging.totalCents / t.revenue) * 365;
    p.recurringSharePct = rec.sharePct;
  }
  if (tp && tp.revenue > 0) p.revenueGrowthPct = pct(t.revenue - tp.revenue, tp.revenue);
  if (wc.currentRatio !== null) p.currentRatio = wc.currentRatio;
  if (field.fieldCount > 0) p.revenuePerFieldCents = field.cents;
  if (t.ebitda > 0) p.debtToEbitda = debt.totalDebtCents / t.ebitda;
  return p;
}

let cache: { at: number; profiles: Profile[] } | null = null;

async function allProfiles(): Promise<Profile[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.profiles;
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const profiles: Profile[] = [];
  for (const c of companies) {
    const ledger = await loadLedger(c.id);
    if (!ledger.periods.length) continue;
    profiles.push(await profile(c.id, c.name, ledger).catch(() => ({ companyId: c.id, name: c.name, year: null })));
  }
  cache = { at: Date.now(), profiles };
  return profiles;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

export async function benchmarks(companyId: string) {
  const profiles = await allProfiles();
  const me = profiles.find((p) => p.companyId === companyId);
  // A company imported twice is still one business, not its own peer.
  const peers = profiles.filter((p) => p.companyId !== companyId && p.name !== me?.name && p.year !== null);
  const seen = new Set<string>();
  const unique = peers.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
  return {
    peers: unique.length,
    minPeers: MIN_PEERS,
    metrics: METRICS.map((m) => {
      const values = unique.map((p) => p[m.key]).filter((v): v is number => v !== undefined && Number.isFinite(v));
      const mine = me?.[m.key];
      if (values.length < MIN_PEERS || mine === undefined) return { ...m, yours: mine ?? null, median: null, topQuartile: null, rank: null, peers: values.length };
      const better = values.filter((v) => (m.higherIsBetter ? v < mine : v > mine)).length;
      return {
        ...m,
        yours: mine,
        median: quantile(values, 0.5),
        topQuartile: quantile(values, m.higherIsBetter ? 0.75 : 0.25),
        // Share of peers this company beats.
        rank: Math.round((better / values.length) * 100),
        peers: values.length,
      };
    }),
  };
}

/** Reset after an import changes a company's books. */
export function clearBenchmarkCache() {
  cache = null;
}
