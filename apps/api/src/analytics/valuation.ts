import { prisma } from "@plumb/db";
import { incomeTotals } from "@plumb/engine";
import { companyAsOf } from "../snapshot.js";
import type { Ledger } from "./ledger.js";
import { completeYears, concentration, recurringAnnual } from "./operations.js";
import { backlog, overruns } from "./projects.js";
import type { Valuation } from "./types.js";
import { totalDebtCents, workingCapital } from "./workingcapital.js";

/**
 * Business valuation and exit readiness.
 *
 * Everything comes from the books except the normalization choices an owner
 * or advisor makes: the market salary to replace the owner, discretionary
 * perks to add back, one-time expenses, and the multiple ranges. Those come
 * from the company's valuation inputs when present and from size-based
 * defaults otherwise. The operating company is valued apart from any real
 * estate it owns.
 */

const n = (b: bigint | null | undefined) => Number(b ?? 0n);
const pct = (v: number, base: number) => (base === 0 ? 0 : Math.round((v / base) * 10000) / 100);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Market salary for a general manager who could replace the owner, by revenue. */
export function marketManagerSalaryCents(revenueCents: number): number {
  if (revenueCents < 5_000_000_00) return 150_000_00;
  if (revenueCents < 10_000_000_00) return 165_000_00;
  if (revenueCents < 25_000_000_00) return 200_000_00;
  return 250_000_00;
}

/** Default EBITDA multiples by size, marked down for key-person and concentration risk. */
export function defaultMultiples(normalizedEbitdaCents: number, risk: { keyPerson: boolean; concentrated: boolean }) {
  const bands: [number, [number, number]][] = [
    [500_000_00, [2.5, 3.5]],
    [1_000_000_00, [3.0, 4.2]],
    [2_000_000_00, [3.5, 4.6]],
    [5_000_000_00, [4.0, 5.5]],
    [Infinity, [5.0, 7.0]],
  ];
  const [lo, hi] = bands.find(([cap]) => normalizedEbitdaCents < cap)![1];
  const cut = (risk.keyPerson ? 0.5 : 0) + (risk.concentrated ? 0.5 : 0);
  const ebitda: [number, number] = [Math.max(2, round1(lo - cut)), Math.max(2.5, round1(hi - cut))];
  const sde: [number, number] = [round1(ebitda[0] * 0.67), round1(ebitda[1] * 0.67)];
  return { ebitda, sde };
}

type Inputs = Record<string, string | number | null>;

export interface ValuationDetail extends Valuation {
  year: number;
  revenueCents: number;
  ownerComp: Valuation["ownerComp"] & { opexUnburdenedCents: number; marketSalaryCents: number; addbackCents: number; perksCents: number };
  oneTimeAddbacksCents: number;
  debtCents: number;
  operatingDebtCents: number;
  cashCents: number;
  multiplesSource: "stated" | "default";
  keyPersonRisk: boolean;
}

async function valuationInputs(companyId: string): Promise<Inputs | null> {
  const v = await prisma.valuationInput.findFirst({ where: { companyId }, orderBy: { asOf: "desc" } });
  return (v?.data as Inputs) ?? null;
}

const field = (inputs: Inputs | null, re: RegExp) => {
  if (!inputs) return null;
  const k = Object.keys(inputs).find((x) => re.test(x));
  const v = k ? Number(inputs[k]) : NaN;
  return Number.isFinite(v) ? v : null;
};

async function ownerEmployee(companyId: string, year: number) {
  const owner = await prisma.employee.findFirst({
    where: { companyId, position: { contains: "Owner", mode: "insensitive" } },
    include: { timeEntries: { where: { period: { startsWith: String(year) } } } },
    orderBy: { externalId: "asc" },
  });
  if (!owner) return null;
  const gross = owner.timeEntries.reduce((s, t) => s + n(t.grossPay), 0) || n(owner.baseAnnualCents);
  return { owner, grossCents: gross, opexShare: 1 - owner.cogsAllocationPct, fieldShare: owner.cogsAllocationPct };
}

export async function valuation(companyId: string, ledger: Ledger): Promise<ValuationDetail> {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const year = years.at(-1);
  if (!year) throw new Error("Valuation needs a full year of books.");
  const periods = ledger.periods.filter((p) => p.startsWith(String(year)));
  const t = incomeTotals(ledger.accounts, periods);
  const inputs = await valuationInputs(companyId);

  // Owner pay that sits in overhead (the field share is already job cost).
  const ownerCompBurdened = ledger.accounts
    .filter((a) => a.statement === "INCOME" && a.subtype === "OWNER_COMP")
    .reduce((s, a) => s + periods.reduce((x, p) => x + (a.amounts.get(p) ?? 0), 0), 0);
  const owner = await ownerEmployee(companyId, year);
  const ownerOpexUnburdened = owner ? Math.round(owner.grossCents * owner.opexShare) : ownerCompBurdened;

  // Market salary: stated gap when the owner gave one, otherwise the size default.
  const statedGap = field(inputs, /owner_comp_vs_market/);
  const marketSalary = statedGap !== null ? ownerOpexUnburdened - Math.round(statedGap * 100) : marketManagerSalaryCents(t.revenue);
  const gap = ownerOpexUnburdened - marketSalary;
  const ownerAddback = Math.max(0, gap);
  const oneTime = Math.round((field(inputs, /one_time|nonrecurring/) ?? 0) * 100);
  const normalized = t.ebitda + ownerAddback + oneTime;

  // Owner perks run through the books (vehicle, insurance, personal expenses).
  const statedSde = field(inputs, /seller_discretionary_earnings/);
  const statedEbitda = field(inputs, /^reported_ebitda/);
  const statedOwner = field(inputs, /owner_officer_compensation/);
  const perks = statedSde !== null && statedEbitda !== null && statedOwner !== null ? Math.round((statedSde - statedEbitda - statedOwner) * 100) : 0;
  const sde = t.ebitda + ownerCompBurdened + perks;

  const conc = await concentration(companyId, ledger).catch(() => null);
  const keyPerson = owner ? owner.fieldShare >= 0.2 || !(await hasManager(companyId)) : true;
  const multiples = (() => {
    const fallback = { ...defaultMultiples(normalized, { keyPerson, concentrated: (conc?.maxPct ?? 0) > 40 }), source: "default" as const };
    const s = [field(inputs, /sde_multiple_range_low/), field(inputs, /sde_multiple_range_high/)];
    const e = [field(inputs, /ebitda_multiple_range_low/), field(inputs, /ebitda_multiple_range_high/)];
    if (![...s, ...e].every((x) => x !== null)) return fallback;
    // Some inputs carry the dollar value range under the multiple's name; back the multiple out.
    const statedNorm = field(inputs, /normalized_ebitda/) ?? statedEbitda;
    const asMultiple = (v: number, base: number | null) => (v <= 50 ? v : base ? round1(v / base) : null);
    const sm = s.map((x) => asMultiple(x!, statedSde));
    const em = e.map((x) => asMultiple(x!, statedNorm));
    if (![...sm, ...em].every((x) => x !== null)) return fallback;
    return { sde: sm as [number, number], ebitda: em as [number, number], source: "stated" as const };
  })();

  // Real estate apart from the operating company.
  const realEstate = await prisma.asset.findMany({ where: { companyId, category: "REAL_ESTATE", disposedAt: null }, include: { liabilities: { where: { active: true } } } });
  const reMarket = realEstate.reduce((s, a) => s + n(a.currentValue ?? a.purchaseCost), 0);
  const mortgageLedger = ledger.accounts
    .filter((a) => a.statement === "BALANCE" && /mortgage/.test(a.key))
    .reduce((s, a) => s + (a.amounts.get(periods.at(-1)!) ?? 0), 0);
  const mortgage = realEstate.length ? mortgageLedger || realEstate.reduce((s, a) => s + a.liabilities.reduce((x, l) => x + n(l.currentBalance), 0), 0) : 0;

  const [debt, wc] = await Promise.all([totalDebtCents(companyId, ledger), workingCapital(companyId, ledger)]);
  const operatingDebt = debt - mortgage;
  const sdeRange: [number, number] = [Math.round(sde * multiples.sde[0]), Math.round(sde * multiples.sde[1])];
  const ebitdaRange: [number, number] = [Math.round(normalized * multiples.ebitda[0]), Math.round(normalized * multiples.ebitda[1])];
  const equityRange: [number, number] = [sdeRange[0] - operatingDebt + wc.cashCents, sdeRange[1] - operatingDebt + wc.cashCents];

  const result: ValuationDetail = {
    year,
    revenueCents: t.revenue,
    reportedEbitdaCents: t.ebitda,
    normalizedEbitdaCents: normalized,
    sdeCents: sde,
    ownerComp: { opexBurdenedCents: ownerCompBurdened, opexUnburdenedCents: ownerOpexUnburdened, marketSalaryCents: marketSalary, marketGapCents: gap, addbackCents: ownerAddback, perksCents: perks },
    oneTimeAddbacksCents: oneTime,
    ebitdaMarginPct: pct(t.ebitda, t.revenue),
    sdeRange,
    ebitdaRange,
    equityRange,
    debtCents: debt,
    operatingDebtCents: operatingDebt,
    cashCents: wc.cashCents,
    realEstate: realEstate.length ? { marketValueCents: reMarket, mortgageCents: mortgage, netEquityCents: reMarket - mortgage } : null,
    multiples: { sde: multiples.sde, ebitda: multiples.ebitda },
    multiplesSource: multiples.source,
    keyPersonRisk: keyPerson,
  };
  return result;
}

async function hasManager(companyId: string) {
  return (await prisma.employee.count({ where: { companyId, position: { contains: "Manager", mode: "insensitive" }, NOT: { position: { contains: "Owner", mode: "insensitive" } } } })) > 0;
}

// ---- exit readiness ------------------------------------------------------------

interface Factor {
  key: string;
  name: string;
  score: number; // 0-10
  weight: number;
  detail: string;
  action: string;
}

const band = (v: number, steps: [number, number][], fallback: number) => {
  for (const [min, s] of steps) if (v >= min) return s;
  return fallback;
};

export async function exitReadiness(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const v = await valuation(companyId, ledger);
  const first = years[0];
  const last = years.at(-1)!;
  const tot = (y: number) => incomeTotals(ledger.accounts, ledger.periods.filter((p) => p.startsWith(String(y))));
  const tFirst = tot(first);
  const tLast = tot(last);
  const marginFirst = tFirst.revenue ? round1((tFirst.ebitda / tFirst.revenue) * 100) : 0;
  const marginLast = tLast.revenue ? round1((tLast.ebitda / tLast.revenue) * 100) : 0;
  const cagr = years.length > 1 && tFirst.revenue > 0 ? (Math.pow(tLast.revenue / tFirst.revenue, 1 / (years.length - 1)) - 1) * 100 : 0;
  const [conc, rec, recFirst, bl, over, owner] = await Promise.all([
    concentration(companyId, ledger).catch(() => null),
    recurringAnnual(companyId, ledger, last),
    recurringAnnual(companyId, ledger, first),
    backlog(companyId),
    overruns(companyId, 4),
    ownerEmployee(companyId, last),
  ]);
  const managers = await prisma.employee.count({
    where: { companyId, payType: "SALARY", NOT: { position: { contains: "Owner", mode: "insensitive" } }, OR: [{ position: { contains: "Manager", mode: "insensitive" } }, { position: { contains: "Superintendent", mode: "insensitive" } }, { position: { contains: "Estimator", mode: "insensitive" } }] },
  });
  const monthsOfBooks = ledger.periods.filter((p) => p <= `${last}-12`).length;
  const hasBalance = ledger.accounts.some((a) => a.statement === "BALANCE");
  const leverage = v.normalizedEbitdaCents > 0 ? v.operatingDebtCents / v.normalizedEbitdaCents : 99;
  const ownerField = owner?.fieldShare ?? 0;

  let ebitdaScore = band(marginLast, [[20, 9], [15, 8], [10, 6], [5, 4]], 2);
  if (marginLast - marginFirst <= -0.5) ebitdaScore -= 2;
  else if (marginLast - marginFirst >= 2) ebitdaScore += 1;
  const factors: Factor[] = [
    {
      key: "reporting",
      name: "Reporting Quality",
      score: Math.min(10, Math.round((Math.min(monthsOfBooks, 36) / 36) * 8) + (hasBalance ? 2 : 0)),
      weight: 1,
      detail: `${monthsOfBooks} months of books`,
      action: "Close the books monthly",
    },
    {
      key: "owner",
      name: "Owner Dependence",
      score: Math.max(1, (v.keyPersonRisk ? 4 : 8) - (ownerField >= 0.2 ? 1 : 0)),
      weight: 1.5,
      detail: ownerField > 0 ? `owner does ${Math.round(ownerField * 100)}% field work` : v.keyPersonRisk ? "no second-in-command" : "manager in place",
      action: "Name a successor for estimating and key accounts",
    },
    {
      key: "concentration",
      name: "Customer Concentration",
      score: conc ? band(-conc.maxPct, [[-5, 10], [-10, 8], [-20, 6], [-35, 4], [-50, 2]], 1) : 5,
      weight: 1.5,
      detail: conc?.top ? `${conc.top.name} ${conc.maxPct}%` : "no customer detail",
      action: conc?.top ? `Reduce reliance on ${conc.top.name}` : "Track revenue by customer",
    },
    {
      key: "recurring",
      name: "Recurring Revenue",
      score: band(rec.sharePct, [[30, 10], [20, 8], [10, 6], [5, 4]], 2),
      weight: 1.5,
      detail: `${rec.sharePct}% of revenue`,
      action: rec.sharePct > 0 ? "Grow recurring revenue past 20%" : "Add maintenance agreements",
    },
    {
      key: "management",
      name: "Management Depth",
      score: band(managers, [[3, 9], [2, 7], [1, 5]], 2),
      weight: 1,
      detail: `${managers} salaried managers`,
      action: "Hire a second-in-command",
    },
    {
      key: "ebitda",
      name: "EBITDA Quality",
      score: Math.max(0, Math.min(10, ebitdaScore)),
      weight: 1.5,
      detail: `${marginLast}% margin (${marginFirst}% in ${first})`,
      action:
        marginLast < marginFirst
          ? "Reverse the EBITDA margin decline"
          : "Lift EBITDA margin above 15%",
    },
    {
      key: "backlog",
      name: "Backlog",
      score: bl.monthsOfCoverage === null ? 5 : band(bl.monthsOfCoverage, [[6, 10], [3, 7], [1, 4]], 2),
      weight: 0.75,
      detail: bl.monthsOfCoverage === null ? "no backlog detail" : `${bl.monthsOfCoverage} months signed`,
      action: "Build backlog past three months",
    },
    {
      key: "process",
      name: "Process Maturity",
      score: over.total ? band(-(over.count / over.total) * 100, [[-10, 9], [-20, 7], [-35, 5]], 3) : 5,
      weight: 1,
      detail: over.total ? `${Math.round((over.count / over.total) * 100)}% of jobs ran 4%+ over` : "no job costing",
      action: over.total ? "Tighten estimating" : "Track job costs against estimates",
    },
    {
      key: "debt",
      name: "Debt",
      score: band(-leverage, [[-1, 10], [-2, 8], [-3, 6], [-4, 4]], 2),
      weight: 0.75,
      detail: `${round1(leverage)}x EBITDA`,
      action: "Pay debt below 2x EBITDA",
    },
    {
      key: "growth",
      name: "Growth",
      score: band(cagr, [[10, 10], [5, 8], [0, 6], [-5, 4]], 2),
      weight: 1,
      detail: `${round1(cagr)}% a year`,
      action: "Restore revenue growth",
    },
  ];
  const weight = factors.reduce((s, f) => s + f.weight, 0);
  const score = Math.round((factors.reduce((s, f) => s + f.score * f.weight, 0) / weight) * 10);
  const ranked = [...factors].sort((a, b) => (10 - b.score) * b.weight - (10 - a.score) * a.weight);
  return {
    score,
    factors: factors.map((f) => ({ key: f.key, name: f.name, score: f.score, detail: f.detail })),
    topActions: ranked.slice(0, 3).map((f) => f.action),
  };
}
