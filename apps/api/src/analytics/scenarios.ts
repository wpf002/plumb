import { prisma } from "@plumb/db";
import { CASES, crewExpansion, incomeTotals, loanPaymentCents, projectCash, weekWindows, type DatedFlow } from "@plumb/engine";
import { addDays } from "@plumb/shared";
import { companyAsOf } from "../snapshot.js";
import { capitalDefaults, type CrewExpansionScenario } from "./capital.js";
import { assembleForecast } from "./forecast.js";
import type { Ledger } from "./ledger.js";
import { capacityHeadroom, completeYears, serviceLines } from "./operations.js";
import { totalDebtCents, workingCapital } from "./workingcapital.js";
import { valuation } from "./valuation.js";

/**
 * Scenarios v2. Every scenario starts from the last full year and reports the
 * same set of outcomes before and after: revenue, gross profit, EBITDA, net
 * income, cash, debt, capacity used, and working capital. Assumptions the
 * owner states (a contribution margin, a ramp) are inputs; everything else is
 * read from the books.
 */

const n = (b: bigint | null | undefined) => Number(b ?? 0n);
const pct = (v: number, base: number) => (base === 0 ? 0 : Math.round((v / base) * 10000) / 100);

export interface Position {
  revenueCents: number;
  grossProfitCents: number;
  ebitdaCents: number;
  netIncomeCents: number;
  cashCents: number;
  debtCents: number;
  workingCapitalCents: number;
  capacityUsedPct: number | null;
  /** Normalized EBITDA at the midpoint of the EBITDA multiple range. */
  enterpriseValueCents: number | null;
}

export interface ScenarioImpact {
  scenario: string;
  year: number;
  assumptions: Record<string, number | string>;
  base: Position;
  after: Position;
  delta: Position;
  notes: string[];
}

async function baseline(companyId: string, ledger: Ledger) {
  const asOf = await companyAsOf(companyId);
  const years = completeYears(ledger, asOf);
  const year = years.at(-1);
  if (!year) throw new Error("Scenarios need a full year of books.");
  const periods = ledger.periods.filter((p) => p.startsWith(String(year)));
  const t = incomeTotals(ledger.accounts, periods);
  const [wc, debt, head, val] = await Promise.all([
    workingCapital(companyId, ledger),
    totalDebtCents(companyId, ledger),
    capacityHeadroom(companyId, ledger),
    valuation(companyId, ledger).catch(() => null),
  ]);
  const midMultiple = val ? (val.multiples.ebitda[0] + val.multiples.ebitda[1]) / 2 : null;
  const normalizedAdj = val ? val.normalizedEbitdaCents - val.reportedEbitdaCents : 0;
  const position: Position = {
    revenueCents: t.revenue,
    grossProfitCents: t.grossProfit,
    ebitdaCents: t.ebitda,
    netIncomeCents: t.netIncome,
    cashCents: wc.cashCents,
    debtCents: debt,
    workingCapitalCents: wc.workingCapitalCents,
    capacityUsedPct: head.ceilingCents ? pct(t.revenue, head.ceilingCents) : null,
    enterpriseValueCents: midMultiple !== null ? Math.round((t.ebitda + normalizedAdj) * midMultiple) : null,
  };
  // Receivables carried per dollar of revenue, for working-capital effects.
  const arPerRevenue = t.revenue ? wc.receivablesCents / t.revenue : 0;
  return { asOf, year, periods, totals: t, position, ceilingCents: head.ceilingCents, arPerRevenue, grossMarginPct: pct(t.grossProfit, t.revenue), midMultiple, normalizedAdj };
}

type Base = Awaited<ReturnType<typeof baseline>>;

/**
 * Apply a change in revenue and costs for one year. Contribution flows to
 * EBITDA and net income; cash moves by the contribution plus the change in
 * receivables that the revenue change carries.
 */
function impact(
  b: Base,
  scenario: string,
  change: { revenueCents: number; grossProfitCents: number; fixedCostCents?: number; cashOnlyCents?: number; debtCents?: number },
  assumptions: ScenarioImpact["assumptions"],
  notes: string[] = []
): ScenarioImpact {
  const ebitda = change.grossProfitCents - (change.fixedCostCents ?? 0);
  const arChange = Math.round(change.revenueCents * b.arPerRevenue);
  const after: Position = {
    revenueCents: b.position.revenueCents + change.revenueCents,
    grossProfitCents: b.position.grossProfitCents + change.grossProfitCents,
    ebitdaCents: b.position.ebitdaCents + ebitda,
    netIncomeCents: b.position.netIncomeCents + ebitda,
    cashCents: b.position.cashCents + ebitda - arChange + (change.cashOnlyCents ?? 0),
    debtCents: b.position.debtCents + (change.debtCents ?? 0),
    workingCapitalCents: b.position.workingCapitalCents + ebitda + (change.cashOnlyCents ?? 0),
    capacityUsedPct: b.ceilingCents ? pct(b.position.revenueCents + change.revenueCents, b.ceilingCents) : null,
    enterpriseValueCents: b.midMultiple !== null ? Math.round((b.position.ebitdaCents + ebitda + b.normalizedAdj) * b.midMultiple) : null,
  };
  const delta = Object.fromEntries(
    (Object.keys(after) as (keyof Position)[]).map((k) => [k, after[k] === null || b.position[k] === null ? null : (after[k] as number) - (b.position[k] as number)])
  ) as unknown as Position;
  return { scenario, year: b.year, assumptions, base: b.position, after, delta, notes };
}

/** A customer's revenue in one year: project revenue recognized that year plus recurring billed that year. */
async function customerYearRevenue(companyId: string, match: string, year: number) {
  const customers = await prisma.customer.findMany({ where: { companyId } });
  const re = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const c = customers.find((x) => re.test(x.name) || x.externalId === match);
  const projects = await prisma.project.findMany({
    where: { companyId, ...(c ? { customerId: c.id } : { client: { contains: match, mode: "insensitive" as const } }) },
    include: { periods: { where: { period: { startsWith: String(year) } } } },
  });
  const project = projects.reduce((s, p) => s + p.periods.reduce((t, x) => t + n(x.revenueMonth), 0), 0);
  const recurring = c
    ? n((await prisma.recurringRevenueEntry.aggregate({ where: { companyId, customerId: c.id, period: { startsWith: String(year) } }, _sum: { amount: true } }))._sum.amount)
    : 0;
  return { name: c?.name ?? match, cents: project + recurring };
}

export async function loseCustomerShare(companyId: string, ledger: Ledger, customer: string, sharePct: number, opts: { contributionMarginPct?: number } = {}) {
  const b = await baseline(companyId, ledger);
  const cust = await customerYearRevenue(companyId, customer, b.year);
  const cm = opts.contributionMarginPct ?? b.grossMarginPct;
  const loss = Math.round((cust.cents * sharePct) / 100);
  const r = impact(b, "lose_customer", { revenueCents: -loss, grossProfitCents: -Math.round((loss * cm) / 100) }, { customer: cust.name, sharePct, customerRevenueCents: cust.cents, contributionMarginPct: cm }, [
    `${cust.name} was ${pct(cust.cents, b.position.revenueCents)}% of ${b.year} revenue.`,
  ]);
  return { ...r, revenueLossCents: loss, ebitdaDeltaCents: r.delta.ebitdaCents };
}

function lineRevenue(ledger: Ledger, year: number, line: string) {
  const sl = serviceLines(ledger, [year]);
  const hit = sl.lines.find((l) => l.line.toLowerCase() === line.toLowerCase()) ?? sl.lines.find((l) => l.line.toLowerCase().includes(line.toLowerCase()));
  if (!hit) throw new Error(`No service line named ${line}.`);
  return { line: hit.line, ...hit.byYear[year], costBasis: sl.costBasis };
}

export async function exitServiceLine(companyId: string, ledger: Ledger, line: string, opts: { contributionMarginPct?: number } = {}) {
  const b = await baseline(companyId, ledger);
  const l = lineRevenue(ledger, b.year, line);
  const cm = opts.contributionMarginPct ?? (l.costBasis === "direct" ? l.marginPct : b.grossMarginPct);
  const contribution = Math.round((l.revenueCents * cm) / 100);
  const r = impact(b, "exit_line", { revenueCents: -l.revenueCents, grossProfitCents: -contribution }, { line: l.line, contributionMarginPct: cm }, [
    "Assumes the line's crew and overhead stay; redeploying the crew changes the answer.",
  ]);
  return { ...r, revenueCents: l.revenueCents, contributionLossCents: contribution };
}

export async function growServiceLine(companyId: string, ledger: Ledger, line: string, growthPct: number, opts: { contributionMarginPct?: number } = {}) {
  const b = await baseline(companyId, ledger);
  const l = lineRevenue(ledger, b.year, line);
  const cm = opts.contributionMarginPct ?? (l.costBasis === "direct" ? l.marginPct : b.grossMarginPct);
  const added = Math.round((l.revenueCents * growthPct) / 100);
  const d = await capitalDefaults(companyId, ledger);
  const hires = d.revenuePerFieldCents ? Math.ceil(added / d.revenuePerFieldCents) : null;
  const notes = [];
  if (b.ceilingCents && b.position.revenueCents + added > b.ceilingCents) notes.push(`Exceeds today's crew ceiling; about ${hires} more field staff needed.`);
  const r = impact(b, "grow_line", { revenueCents: added, grossProfitCents: Math.round((added * cm) / 100) }, { line: l.line, growthPct, contributionMarginPct: cm }, notes);
  return { ...r, addedRevenueCents: added, newRevenueCents: l.revenueCents + added, fieldStaffNeeded: hires };
}

export async function materialsIncrease(companyId: string, ledger: Ledger, increasePct: number) {
  const b = await baseline(companyId, ledger);
  const materials = ledger.accounts
    .filter((a) => a.statement === "INCOME" && a.type === "COGS" && a.subtype === "MATERIALS")
    .reduce((s, a) => s + b.periods.reduce((t, p) => t + (a.amounts.get(p) ?? 0), 0), 0);
  const added = Math.round((materials * increasePct) / 100);
  const r = impact(b, "materials", { revenueCents: 0, grossProfitCents: -added }, { increasePct, materialsCents: materials }, [
    "Assumes fixed-price work absorbs the increase; escalation clauses pass it through.",
  ]);
  return { ...r, addedCostCents: added, ebitdaCents: b.position.ebitdaCents, ebitdaImpactPct: b.position.ebitdaCents ? pct(added, b.position.ebitdaCents) : 0 };
}

export async function addCrew(companyId: string, ledger: Ledger, input: CrewExpansionScenario) {
  const b = await baseline(companyId, ledger);
  const d = await capitalDefaults(companyId, ledger);
  const c = crewExpansion({
    ...input,
    matureCapacityCents: input.matureCapacityCents ?? d.matureCrewCapacityCents ?? 0,
    grossMarginPct: input.grossMarginPct ?? d.jobMarginPct ?? b.grossMarginPct,
  });
  const y1 = c.years[0];
  const financed = input.equipmentCents - c.downPaymentCents;
  const r = impact(
    b,
    "add_crew",
    { revenueCents: y1.revenueCents, grossProfitCents: y1.contributionCents + c.newFixedCostsCents, fixedCostCents: c.newFixedCostsCents - c.annualDebtServiceCents, cashOnlyCents: -c.downPaymentCents - c.annualDebtServiceCents, debtCents: financed },
    { equipmentCents: input.equipmentCents, year1RampPct: y1.rampPct },
    [`Breakeven at ${c.breakevenPctOfCapacity}% of a mature crew.`]
  );
  // Debt service is principal plus interest; the principal part leaves cash, not EBITDA.
  return { ...r, crew: c };
}

export async function addPM(companyId: string, ledger: Ledger, input: { annualSalaryCents: number; burdenPct?: number; revenueLiftPct?: number }) {
  const b = await baseline(companyId, ledger);
  const cost = Math.round(input.annualSalaryCents * (1 + (input.burdenPct ?? 20) / 100));
  const lift = Math.round((b.position.revenueCents * (input.revenueLiftPct ?? 0)) / 100);
  const r = impact(b, "add_pm", { revenueCents: lift, grossProfitCents: Math.round((lift * b.grossMarginPct) / 100), fixedCostCents: cost }, { annualSalaryCents: input.annualSalaryCents, revenueLiftPct: input.revenueLiftPct ?? 0 }, [
    `Needs ${Math.round(cost / Math.max(0.01, b.grossMarginPct / 100) / 100).toLocaleString("en-US")} dollars of new revenue a year to pay for itself.`,
  ]);
  return r;
}

export async function addLocation(
  companyId: string,
  ledger: Ledger,
  input: { annualFixedCostCents: number; startupCostCents: number; financedPct: number; ratePct: number; termMonths: number; year1RevenueCents: number; grossMarginPct?: number }
) {
  const b = await baseline(companyId, ledger);
  const gm = input.grossMarginPct ?? b.grossMarginPct;
  const financed = Math.round((input.startupCostCents * input.financedPct) / 100);
  const payment = loanPaymentCents(financed, input.ratePct, input.termMonths);
  const r = impact(
    b,
    "add_location",
    { revenueCents: input.year1RevenueCents, grossProfitCents: Math.round((input.year1RevenueCents * gm) / 100), fixedCostCents: input.annualFixedCostCents, cashOnlyCents: -(input.startupCostCents - financed) - payment * 12, debtCents: financed },
    { annualFixedCostCents: input.annualFixedCostCents, startupCostCents: input.startupCostCents, year1RevenueCents: input.year1RevenueCents, grossMarginPct: gm },
    [`Breakeven revenue ${Math.round(input.annualFixedCostCents / (gm / 100) / 100).toLocaleString("en-US")} dollars a year.`]
  );
  return r;
}

/**
 * Collections slipping: the largest expected receipts totaling `amountCents`
 * arrive `days` later. Returns the 13-week low and whether the line of credit
 * would have to cover it.
 */
export async function paymentDelay(companyId: string, amountCents: number, days: number) {
  const a = await assembleForecast(companyId);
  const windows = weekWindows(a.input.asOf, 13);
  const base = projectCash(a.input, windows, CASES.base);
  const inflowCats = new Set(["collections", "progress_billings", "service_revenue", "recurring_receipts"]);
  // Delay receipts from the earliest weeks first: the slip that hurts is the one already counted on.
  const order = a.input.flows
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => inflowCats.has(f.category))
    .sort((x, y) => x.f.date.getTime() - y.f.date.getTime() || y.f.cents - x.f.cents);
  let left = amountCents;
  const flows: DatedFlow[] = [...a.input.flows];
  for (const { f, i } of order) {
    if (left <= 0) break;
    const moved = Math.min(left, f.cents);
    flows[i] = { ...f, cents: f.cents - moved };
    flows.push({ ...f, cents: moved, date: addDays(f.date, days), label: `${f.label} (late)` });
    left -= moved;
  }
  const after = projectCash({ ...a.input, flows }, windows, CASES.base);
  const minNoLoc = (fc: typeof after) => Math.min(...fc.buckets.map((x) => x.endingCents - x.locBalanceCents + a.input.locBalanceCents));
  return {
    amountCents,
    days,
    shiftedCents: amountCents - left,
    baseLowCents: base.lowest.cents,
    minCashCents: after.lowest.cents,
    minCashBeforeCreditCents: minNoLoc(after),
    reserveTargetCents: a.input.reserveTargetCents,
    locLimitCents: a.input.locLimitCents,
    peakLocCents: after.peakLocCents,
    locDrawRequired: after.peakLocCents > base.peakLocCents || minNoLoc(after) < a.input.reserveTargetCents,
    lowWeek: after.lowest.label,
  };
}

export const SCENARIO_KINDS = ["lose_customer", "exit_line", "grow_line", "materials", "add_crew", "add_pm", "add_location", "payment_delay"] as const;
