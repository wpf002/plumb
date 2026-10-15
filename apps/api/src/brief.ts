import { incomeTotals, monthKeyOf } from "@plumb/engine";
import type { Fact } from "./ai.js";
import { verifyNarration } from "./ai.js";
import { twelveMonth } from "./analytics/forecast.js";
import { capacityPlan, completeYears, concentration, crewUtilization, recurringAnnual } from "./analytics/operations.js";
import { backlog, loadJobs } from "./analytics/projects.js";
import { budgetRows } from "./analytics/statements.js";
import { exitReadiness } from "./analytics/valuation.js";
import { UNKNOWN_CUSTOMER, arAging } from "./analytics/workingcapital.js";
import { pctStr, toolContext, usd } from "./tools/index.js";

/**
 * The owner's weekly or monthly brief: a health rating, the handful of
 * findings that matter most, and recommended actions. Every sentence is built
 * from computed facts and checked against them before it ships.
 */

export interface BriefLine {
  key: string;
  text: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

export interface Finding extends BriefLine {
  /** Higher sorts first. */
  weight: number;
}

const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const pctOf = (v: number, base: number) => (base ? (v / base) * 100 : 0);
/** End with one period, even when a name already ends in "Inc." */
const sentence = (t: string) => (t.endsWith(".") ? t : `${t}.`);

export async function buildBrief(companyId: string, period: "week" | "month" = "week") {
  const ctx = await toolContext(companyId);
  const facts: Fact[] = [];
  const fact = (key: string, label: string, value: string) => {
    facts.push({ key, label, value, raw: null });
    return value;
  };
  const years = completeYears(ctx.ledger, ctx.asOf);
  const findings: Finding[] = [];
  const lines: BriefLine[] = [];
  const actions: BriefLine[] = [];
  const add = (x: Finding) => findings.push(x);

  const first = years[0];
  const last = years.at(-1);
  const tot = (y: number) => incomeTotals(ctx.ledger.accounts, ctx.ledger.periods.filter((p) => p.startsWith(String(y))));

  // ---- the standing lines, in the doc's order ----
  if (last) {
    const rows = await budgetRows(companyId, last);
    const rev = rows.find((r) => r.line === "REVENUE");
    if (rev && rev.actual !== null && rev.budget) {
      const v = ((rev.actual - rev.budget) / Math.abs(rev.budget)) * 100;
      const s = fact("plan.revenue", `${last} revenue vs plan`, pctStr(Math.abs(v)));
      lines.push({ key: "plan", text: `Revenue finished ${s} ${v >= 0 ? "ahead of" : "behind"} plan.`, tone: v >= 0 ? "good" : "warn" });
    }
  }
  const upto = ctx.ledger.periods.filter((p) => p <= monthKeyOf(ctx.asOf));
  if (upto.length >= 6) {
    const a = incomeTotals(ctx.ledger.accounts, upto.slice(-6, -3));
    const b = incomeTotals(ctx.ledger.accounts, upto.slice(-3));
    const ma = pctOf(a.grossProfit, a.revenue);
    const mb = pctOf(b.grossProfit, b.revenue);
    const from = fact("margin.prior", "Gross margin, prior three months", pctStr(ma));
    const to = fact("margin.recent", "Gross margin, last three months", pctStr(mb));
    const moved = Math.abs(mb - ma) >= 1;
    lines.push({
      key: "margin",
      text: moved ? `Gross margin ${mb < ma ? "fell" : "rose"} from ${from} to ${to} in three months.` : `Gross margin held at ${to}.`,
      tone: mb < ma - 1 ? "warn" : "good",
    });
  }
  const m12 = await twelveMonth(companyId).catch(() => null);
  if (m12) {
    const base = m12.cases.base;
    const breach = base.buckets.find((x) => x.belowReserve);
    if (breach) {
      const when = fact("cash.breach", "First month under the cash reserve", monthName(breach.label));
      lines.push({ key: "cash", text: `Cash falls below the reserve in ${when}.`, tone: "bad" });
      add({ key: "cash", text: `Cash falls below the reserve in ${when}.`, tone: "bad", weight: 95 });
    } else {
      const through = fact("cash.through", "Cash stays above the reserve through", monthName(base.buckets.at(-1)!.label));
      lines.push({ key: "cash", text: `Cash remains healthy through ${through}.`, tone: "good" });
    }
  }
  const { aging } = await arAging(companyId);
  const late = aging.buckets["31-60"] + aging.buckets["61-90"] + aging.buckets["90+"];
  const lateParty = [...aging.byParty].filter((p: any) => p.party !== UNKNOWN_CUSTOMER).sort((x: any, y: any) => y.totalCents - (y.buckets.current ?? 0) - (x.totalCents - (x.buckets.current ?? 0)))[0] as any;
  fact("ar.threshold", "Past-due threshold", "30 days");
  if (late > 0) {
    const s = fact("ar.late", "Receivables more than 30 days past due", usd(late));
    lines.push({ key: "ar", text: `${s} of receivables are more than 30 days overdue.`, tone: "warn" });
    if (lateParty) {
      const who = fact("ar.lateParty", "Customer with the most past due", lateParty.party);
      actions.push({ key: "collect", text: sentence(`Collect from ${who}`), tone: "warn" });
    }
    add({ key: "ar", text: `${s} of receivables are more than 30 days overdue.`, tone: "warn", weight: 40 + Math.min(30, pctOf(late, aging.totalCents)) });
  } else lines.push({ key: "ar", text: "No receivables are more than 30 days overdue.", tone: "good" });

  const jobs = (await loadJobs(companyId)).filter((j) => j.status !== "CLOSED" && j.costKnown && j.targetMarginPct);
  const under = jobs.filter((j) => j.projectedMarginPct < j.targetMarginPct - 2).sort((a, b) => a.projectedMarginPct - a.targetMarginPct - (b.projectedMarginPct - b.targetMarginPct));
  if (jobs.length) {
    const n = fact("jobs.under", "Active jobs below target margin", String(under.length));
    lines.push({ key: "jobs", text: under.length ? `${n} active job${under.length === 1 ? " is" : "s are"} below target margin.` : "Every active job is at or above target margin.", tone: under.length ? "warn" : "good" });
    if (under[0]) {
      const name = fact("jobs.worst", "Job furthest under target", under[0].name);
      actions.push({ key: "job", text: sentence(`Review costs on ${name}`), tone: "warn" });
      add({ key: "jobs", text: `${n} active job${under.length === 1 ? " is" : "s are"} below target margin.`, tone: "warn", weight: 35 + under.length * 5 });
    }
  }
  const [util, plan] = await Promise.all([crewUtilization(companyId), capacityPlan(companyId, ctx.ledger)]);
  if (util.project) {
    const u = fact("crew.project", "Project crew utilization, last 24 months", pctStr(util.project.trailing24AvgPct));
    const peak = fact("crew.peak", "Project crew peak-year utilization", pctStr(util.project.peakYearAvgPct));
    const peakYear = fact("crew.peakYear", "Project crew peak year", String(util.project.peakYear));
    lines.push({ key: "crew", text: `Project crews are at ${u} capacity.`, tone: util.project.trailing24AvgPct >= 90 ? "warn" : "neutral" });
    if (util.project.trailing24AvgPct >= 80) add({ key: "crew.bottleneck", text: `Project crew peaked at ${peak} capacity in ${peakYear}.`, tone: "warn", weight: 60 });
    if (util.maintenance) {
      const mu = fact("crew.maint", "Maintenance crew utilization, last 12 months", pctStr(util.maintenance.trailing12AvgPct));
      lines.push({ key: "crew.maint", text: `Maintenance crews are at ${mu} capacity.`, tone: "neutral" });
    }
  } else if (plan.months[0]?.bookedPct != null) {
    const b = fact("crew.booked", `${monthName(plan.months[0].period)} crew capacity booked`, pctStr(plan.months[0].bookedPct));
    lines.push({ key: "crew", text: `Field crews are ${b} booked for ${monthName(plan.months[0].period).split(" ")[0]}.`, tone: plan.months[0].bookedPct > 95 ? "warn" : "neutral" });
  }

  // ---- structural findings ----
  if (first && last && first !== last) {
    const a = tot(first);
    const b = tot(last);
    const ma = pctOf(a.ebitda, a.revenue);
    const mb = pctOf(b.ebitda, b.revenue);
    if (mb < ma - 0.5) {
      const from = fact("ebitda.first", `${first} EBITDA margin`, pctStr(ma));
      const to = fact("ebitda.last", `${last} EBITDA margin`, pctStr(mb));
      add({ key: "ebitda", text: `EBITDA margin fell from ${from} in ${first} to ${to} in ${last}.`, tone: ma - mb >= 3 ? "bad" : "warn", weight: 70 + Math.min(20, ma - mb) });
    }
    const losses = years.filter((y) => tot(y).netIncome < 0);
    if (losses.length) {
      const yrs = fact("loss.years", "Years with a net loss", losses.join(", "));
      add({ key: "loss", text: `Lost money in ${yrs}.`, tone: "bad", weight: 65 });
    }
    const growth = pctOf(b.revenue - a.revenue, a.revenue);
    const g = fact("growth", `Revenue change ${first} to ${last}`, pctStr(Math.abs(growth)));
    if (Math.abs(growth) >= 10) add({ key: "growth", text: `Revenue ${growth > 0 ? "grew" : "fell"} ${g} since ${first}.`, tone: growth > 0 ? "good" : "bad", weight: 30 });
    const ra = await recurringAnnual(companyId, ctx.ledger, first);
    const rb = await recurringAnnual(companyId, ctx.ledger, last);
    if (rb.cents > 0 && rb.cents > ra.cents) {
      const from = fact("recurring.first", `${first} recurring revenue`, usd(ra.cents));
      const to = fact("recurring.last", `${last} recurring revenue`, usd(rb.cents));
      const share = fact("recurring.share", `${last} recurring share of revenue`, pctStr(rb.sharePct));
      add({ key: "recurring", text: `Recurring revenue grew from ${from} to ${to} (${share} of revenue).`, tone: "good", weight: 45 });
    }
  }
  const conc = await concentration(companyId, ctx.ledger).catch(() => null);
  if (conc?.top && conc.maxPct >= 20) {
    const who = fact("conc.top", "Largest customer", conc.top.name);
    const share = fact("conc.share", "Largest customer's share of revenue", pctStr(conc.maxPct));
    add({ key: "concentration", text: `${who} is ${share} of revenue.`, tone: "bad", weight: 75 + Math.min(20, conc.maxPct - 20) });
  }
  const bl = await backlog(companyId);
  if (bl.monthsOfCoverage !== null && bl.monthsOfCoverage < 3) {
    const s = fact("backlog.signed", "Signed backlog", usd(bl.signedCents));
    const m = fact("backlog.months", "Months of work signed", `${bl.monthsOfCoverage} months`);
    add({ key: "backlog", text: `${s} of signed backlog covers ${m}.`, tone: "warn", weight: 50 });
  }
  const readiness = last ? await exitReadiness(companyId, ctx.ledger).catch(() => null) : null;
  if (readiness?.topActions[0]) {
    const a = fact("value.action", "Top value lever", readiness.topActions[0]);
    actions.push({ key: "value", text: sentence(a), tone: "neutral" });
  }

  findings.sort((a, b) => b.weight - a.weight);
  const bad = findings.filter((x) => x.tone === "bad").length;
  const warn = findings.filter((x) => x.tone === "warn").length;
  const rating = bad >= 2 ? "At Risk" : bad === 1 ? "Watch" : warn >= 3 ? "Stable" : "Strong";

  const brief = {
    period,
    asOf: ctx.asOf.toISOString().slice(0, 10),
    rating,
    lines,
    // Findings already stated as a standing line aren't repeated.
    findings: findings.filter((x) => !lines.some((l) => l.key === x.key)).slice(0, 5).map(({ weight: _w, ...x }) => x),
    actions: actions.slice(0, 4),
    facts,
  };
  // Every sentence must carry only computed figures.
  const problem = verifyNarration([...brief.lines, ...brief.findings, ...brief.actions].map((l) => l.text).join("\n"), facts);
  return { ...brief, verified: problem === null, verifyError: problem };
}
