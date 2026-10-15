import { prisma } from "@plumb/db";
import { incomeTotals, monthKeyOf, purchaseAnalysis } from "@plumb/engine";
import type { Fact } from "../ai.js";
import { capitalDefaults, fleet, hireFor } from "../analytics/capital.js";
import { thirteenWeek, twelveMonth } from "../analytics/forecast.js";
import { loadLedger, type Ledger } from "../analytics/ledger.js";
import { capacityPlan, completeYears, crewUtilization, customers, serviceLines } from "../analytics/operations.js";
import { backlog, loadJobs, pipeline, wip } from "../analytics/projects.js";
import * as scen from "../analytics/scenarios.js";
import { budgetRows } from "../analytics/statements.js";
import { exitReadiness, valuation } from "../analytics/valuation.js";
import { UNKNOWN_CUSTOMER, arAging, workingCapital } from "../analytics/workingcapital.js";
import { companyAsOf } from "../snapshot.js";

/**
 * The tool layer: one surface for Ask Denny, the brief, and external AI
 * connectors. Each tool declares a permission scope and returns only its own
 * slice of the business as pre-formatted facts. A model never sees raw tables
 * and never formats or computes a number itself.
 */

export type Scope = "read" | "analyze" | "write";

export interface ToolContext {
  companyId: string;
  ledger: Ledger;
  asOf: Date;
}

export interface ToolResult {
  facts: Fact[];
  data: unknown;
}

export interface Tool {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  run(ctx: ToolContext, input: Record<string, any>): Promise<ToolResult>;
}

export const usd = (cents: number) => `${cents < 0 ? "-" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
export const pctStr = (v: number) => `${v.toFixed(1)}%`;
const f = (key: string, label: string, value: string, raw: number | string | null = null): Fact => ({ key, label, value, raw });
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const pctOf = (v: number, base: number) => (base ? (v / base) * 100 : 0);

const lastYear = (ctx: ToolContext) => completeYears(ctx.ledger, ctx.asOf).at(-1);
const totalsFor = (ctx: ToolContext, periods: string[]) => incomeTotals(ctx.ledger.accounts, periods);

const EMPTY = { type: "object" as const, properties: {}, additionalProperties: false };

export const TOOLS: Tool[] = [
  {
    name: "get_financial_summary",
    description: "Revenue, gross margin, EBITDA, and net income for the last full year and year to date; plan variance; recent gross-margin trend and which cost lines moved.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const y = lastYear(ctx);
      const facts: Fact[] = [];
      if (!y) return { facts: [f("summary.none", "Financial history", "less than a full year of books")], data: null };
      const ps = ctx.ledger.periods.filter((p) => p.startsWith(String(y)));
      const t = totalsFor(ctx, ps);
      facts.push(
        f("summary.year", "Last full year", String(y)),
        f("summary.revenue", `${y} revenue`, usd(t.revenue), t.revenue),
        f("summary.grossMargin", `${y} gross margin`, pctStr(pctOf(t.grossProfit, t.revenue))),
        f("summary.ebitda", `${y} EBITDA`, usd(t.ebitda), t.ebitda),
        f("summary.ebitdaMargin", `${y} EBITDA margin`, pctStr(pctOf(t.ebitda, t.revenue))),
        f("summary.netIncome", `${y} net income`, usd(t.netIncome), t.netIncome)
      );
      // Margin trend: last three months against the three before.
      const upto = ctx.ledger.periods.filter((p) => p <= monthKeyOf(ctx.asOf));
      const recent = upto.slice(-3);
      const prior = upto.slice(-6, -3);
      if (prior.length === 3) {
        const a = totalsFor(ctx, prior);
        const b = totalsFor(ctx, recent);
        facts.push(
          f("trend.priorMargin", `Gross margin ${monthName(prior[0])} to ${monthName(prior[2])}`, pctStr(pctOf(a.grossProfit, a.revenue))),
          f("trend.recentMargin", `Gross margin ${monthName(recent[0])} to ${monthName(recent[2])}`, pctStr(pctOf(b.grossProfit, b.revenue)))
        );
        // Which cost lines grew as a share of revenue.
        const cogs = ctx.ledger.accounts.filter((x) => x.statement === "INCOME" && x.type === "COGS");
        const share = (ps2: string[], rev: number) =>
          new Map(cogs.map((x) => [x.name, pctOf(ps2.reduce((s, p) => s + (x.amounts.get(p) ?? 0), 0), rev)]));
        const sa = share(prior, a.revenue);
        const sb = share(recent, b.revenue);
        const moves = cogs.map((x) => ({ name: x.name, from: sa.get(x.name)!, to: sb.get(x.name)! })).sort((m, n2) => n2.to - n2.from - (m.to - m.from));
        moves.slice(0, 2).forEach((m, i) => {
          if (m.to - m.from > 0.5) facts.push(f(`trend.cost${i}`, `${m.name} as a share of revenue`, `${pctStr(m.from)} to ${pctStr(m.to)}`));
        });
      }
      // Plan variance, year to date in the current budget year.
      const rows = await budgetRows(ctx.companyId, y);
      for (const [line, label] of [["REVENUE", "revenue"], ["NET_INCOME", "net income"]] as const) {
        const r = rows.find((x) => x.line === line);
        if (r && r.actual !== null && r.budget) facts.push(f(`plan.${line}`, `${y} ${label} against plan`, pctStr(((r.actual - r.budget) / Math.abs(r.budget)) * 100)));
      }
      return { facts, data: { year: y, totals: t } };
    },
  },
  {
    name: "get_cash_position",
    description: "Cash, receivables, payables, working capital, current ratio, and line-of-credit balance today.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const wc = await workingCapital(ctx.companyId, ctx.ledger);
      const loc = await prisma.liability.findFirst({ where: { companyId: ctx.companyId, kind: "LINE_OF_CREDIT", active: true } });
      const facts = [
        f("cash.now", "Cash in the bank", usd(wc.cashCents), wc.cashCents),
        f("cash.ar", "Receivables", usd(wc.receivablesCents), wc.receivablesCents),
        f("cash.wc", "Working capital", usd(wc.workingCapitalCents), wc.workingCapitalCents),
        f("cash.currentRatio", "Current ratio", wc.currentRatio === null ? "n/a" : `${wc.currentRatio.toFixed(2)}x`),
      ];
      if (loc) {
        facts.push(
          f("loc.limit", "Credit line limit", usd(Number(loc.creditLimit ?? 0n))),
          f("loc.balance", "Credit line drawn", usd(Number(loc.currentBalance)))
        );
      }
      return { facts, data: wc };
    },
  },
  {
    name: "get_cash_forecast",
    description: "13-week cash forecast low point and shortfall, and month-by-month ending cash for the next three months.",
    scope: "analyze",
    inputSchema: EMPTY,
    async run(ctx) {
      const [w, m] = await Promise.all([thirteenWeek(ctx.companyId), twelveMonth(ctx.companyId)]);
      const fc = w.forecast;
      const low = fc.buckets.find((b) => b.label === fc.lowest.label);
      const facts = [
        f("forecast.low", "Lowest cash in the next 13 weeks", usd(fc.lowest.cents), fc.lowest.cents),
        f("forecast.lowWeek", "Week of the low", low ? `week of ${low.start}` : fc.lowest.label),
        f("forecast.reserve", "Cash reserve target", usd(fc.reserveTargetCents)),
        f("forecast.end13", "Cash at week 13", usd(fc.endingCents)),
      ];
      if (fc.shortfall) facts.push(f("forecast.shortfall", "First week under the reserve", `week of ${fc.shortfall.start}`));
      if (fc.peakLocCents > 0) facts.push(f("forecast.loc", "Credit line needed at peak", usd(fc.peakLocCents)));
      m.cases.base.buckets.slice(0, 3).forEach((b, i) => {
        facts.push(
          f(`forecast.m${i}.month`, `Month ${i + 1}`, monthName(b.label)),
          f(`forecast.m${i}.in`, `${monthName(b.label)} cash in`, usd(b.totalInCents)),
          f(`forecast.m${i}.out`, `${monthName(b.label)} cash out`, usd(b.totalOutCents)),
          f(`forecast.m${i}.end`, `${monthName(b.label)} ending cash`, usd(b.endingCents))
        );
      });
      return { facts, data: { low: fc.lowest, shortfall: fc.shortfall } };
    },
  },
  {
    name: "get_job_profitability",
    description: "Jobs losing money or running under target margin, worst first, and average margin by job type.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const jobs = (await loadJobs(ctx.companyId)).filter((j) => j.costKnown && (j.actual.total > 0 || j.status !== "CLOSED"));
      const active = jobs.filter((j) => j.status !== "CLOSED");
      const losing = jobs.filter((j) => j.projectedGrossProfitCents < 0);
      const under = active.filter((j) => j.targetMarginPct && j.projectedMarginPct < j.targetMarginPct - 2);
      const worst = [...losing, ...under.filter((j) => !losing.includes(j))].sort((a, b) => a.projectedMarginPct - b.projectedMarginPct).slice(0, 5);
      const facts = [
        f("jobs.losingCount", "Jobs losing money", String(losing.length)),
        f("jobs.activeUnderCount", "Active jobs under target margin", String(under.length)),
      ];
      worst.forEach((j, i) =>
        facts.push(
          f(`jobs.w${i}.name`, "Job", j.name),
          f(`jobs.w${i}.margin`, `${j.name} margin`, pctStr(j.projectedMarginPct)),
          f(`jobs.w${i}.profit`, `${j.name} gross profit`, usd(j.projectedGrossProfitCents)),
          ...(j.targetMarginPct ? [f(`jobs.w${i}.target`, `${j.name} target margin`, pctStr(j.targetMarginPct))] : [])
        )
      );
      return { facts, data: worst.map((j) => ({ id: j.id, name: j.name, marginPct: j.projectedMarginPct })) };
    },
  },
  {
    name: "get_wip",
    description: "Work in progress: contract, earned, billed, under- and overbilling, and flagged jobs.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const w = await wip(ctx.companyId);
      const facts = [
        f("wip.jobs", "Jobs in progress", String(w.rows.length)),
        f("wip.earned", "Earned to date", usd(w.totals.earned)),
        ...(w.billingKnown ? [f("wip.underbilled", "Underbilled", usd(w.totals.underbilled)), f("wip.overbilled", "Overbilled", usd(w.totals.overbilled))] : []),
      ];
      w.rows.filter((r) => r.flags.length).slice(0, 4).forEach((r, i) => facts.push(f(`wip.flag${i}`, `${r.name} flags`, r.flags.join(", "))));
      return { facts, data: w.totals };
    },
  },
  {
    name: "get_backlog",
    description: "Signed backlog, weighted pipeline, months of work booked, and lost work by year.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const [b, p] = await Promise.all([backlog(ctx.companyId), pipeline(ctx.companyId)]);
      const facts = [
        f("backlog.signed", "Signed backlog", usd(b.signedCents)),
        f("backlog.weighted", "Weighted pipeline", usd(p.totals.weightedCents)),
        f("backlog.coverage", "Backlog plus pipeline as a share of last year's revenue", pctStr(b.coverageOfLastYearRevenuePct)),
      ];
      if (b.monthsOfCoverage !== null) facts.push(f("backlog.months", "Months of work signed", `${b.monthsOfCoverage} months`));
      for (const [y, c] of Object.entries(p.lostByYear)) facts.push(f(`lost.${y}`, `Work lost in ${y}`, usd(c as number)));
      return { facts, data: { signed: b.signedCents, weighted: p.totals.weightedCents } };
    },
  },
  {
    name: "get_receivables",
    description: "Receivables aging and the customers who owe the most, with how late they are.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const { aging } = await arAging(ctx.companyId);
      const late = aging.buckets["31-60"] + aging.buckets["61-90"] + aging.buckets["90+"];
      const facts = [
        f("ar.total", "Receivables outstanding", usd(aging.totalCents)),
        f("ar.over30", "More than 30 days past due", usd(late)),
        f("ar.threshold", "Past-due threshold", "30 days"),
      ];
      // Named customers only; invoices with no customer on file are counted in the totals.
      aging.byParty.filter((p: any) => p.party !== UNKNOWN_CUSTOMER).slice(0, 3).forEach((p: any, i: number) => {
        const pastDue = p.totalCents - (p.buckets.current ?? 0);
        facts.push(f(`ar.p${i}.name`, "Customer", p.party), f(`ar.p${i}.owes`, `${p.party} owes`, usd(p.totalCents)), f(`ar.p${i}.pastDue`, `${p.party} past due`, usd(pastDue)));
      });
      return { facts, data: { total: aging.totalCents, late } };
    },
  },
  {
    name: "get_capacity",
    description: "Revenue the field crew can carry, headroom over last year, crew utilization, and booked load for the next three months.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const [plan, util] = await Promise.all([capacityPlan(ctx.companyId, ctx.ledger), crewUtilization(ctx.companyId)]);
      const h = plan.headroom;
      const facts: Fact[] = [];
      if (h.bestYear) {
        facts.push(
          f("capacity.ceiling", "Revenue the current field crew can carry", usd(h.ceilingCents)),
          ...(h.headroomCents > 0 ? [f("capacity.headroom", "Headroom over last year's revenue", usd(h.headroomCents))] : [f("capacity.atCeiling", "Crew at its revenue ceiling", "yes")]),
          f("capacity.fieldCount", "Field staff", String(h.fieldCount))
        );
      }
      if (util.project) facts.push(f("capacity.projectCrew", "Project crew utilization, last 24 months", pctStr(util.project.trailing24AvgPct)));
      if (util.maintenance) facts.push(f("capacity.maintenance", "Maintenance crew utilization, last 12 months", pctStr(util.maintenance.trailing12AvgPct)));
      plan.months.slice(0, 3).forEach((m, i) => {
        if (m.bookedPct !== null) facts.push(f(`capacity.m${i}`, `${monthName(m.period)} booked`, pctStr(m.bookedPct)));
      });
      return { facts, data: plan };
    },
  },
  {
    name: "get_equipment",
    description: "Fleet book and market value, loans, and the asset most likely to need replacing.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const fl = await fleet(ctx.companyId);
      const facts = [
        f("fleet.book", "Fleet book value", usd(fl.netBookValueCents)),
        f("fleet.market", "Fleet market value", usd(fl.marketValueCents)),
        f("fleet.loans", "Equipment loans outstanding", usd(fl.loanBalanceCents)),
      ];
      if (fl.replacementCandidate) facts.push(f("fleet.replace", "Asset to replace next", fl.replacementCandidate));
      return { facts, data: { candidate: fl.replacementCandidate } };
    },
  },
  {
    name: "get_service_lines",
    description: "Revenue, growth, and gross margin by service line for the last full year.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const y = lastYear(ctx);
      if (!y) return { facts: [], data: null };
      const sl = serviceLines(ctx.ledger, completeYears(ctx.ledger, ctx.asOf).slice(-2));
      const facts: Fact[] = [f("lines.basis", "How line margins are measured", sl.costBasis === "direct" ? "direct costs by line" : "costs are not split by line")];
      const ranked = [...sl.lines].sort((a, b) => b.byYear[y].grossProfitCents - a.byYear[y].grossProfitCents);
      ranked.forEach((l, i) => {
        facts.push(f(`lines.${i}.name`, "Service line", l.line), f(`lines.${i}.revenue`, `${l.line} ${y} revenue`, usd(l.byYear[y].revenueCents)));
        if (sl.costBasis === "direct") facts.push(f(`lines.${i}.gp`, `${l.line} gross profit`, usd(l.byYear[y].grossProfitCents)), f(`lines.${i}.margin`, `${l.line} gross margin`, pctStr(l.byYear[y].marginPct)));
        if (l.growthPct !== null) facts.push(f(`lines.${i}.growth`, `${l.line} growth over prior year`, pctStr(l.growthPct)));
      });
      return { facts, data: ranked.map((l) => l.line) };
    },
  },
  {
    name: "get_customers",
    description: "Customer concentration and the largest customers by revenue and margin.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const c = await customers(ctx.companyId, ctx.ledger);
      const facts = [f("customers.top5", "Top five customers' share of revenue", pctStr(c.concentration.top5Pct))];
      c.rows.slice(0, 3).forEach((r, i) => facts.push(f(`customers.${i}.name`, "Customer", r.name), f(`customers.${i}.share`, `${r.name} share of revenue`, pctStr(r.sharePct)), f(`customers.${i}.margin`, `${r.name} gross margin`, pctStr(r.marginPct))));
      return { facts, data: c.concentration };
    },
  },
  {
    name: "get_business_valuation",
    description: "Valuation ranges, normalized EBITDA and SDE, exit readiness score, and the three actions that would raise value most.",
    scope: "read",
    inputSchema: EMPTY,
    async run(ctx) {
      const [v, r] = await Promise.all([valuation(ctx.companyId, ctx.ledger), exitReadiness(ctx.companyId, ctx.ledger)]);
      const facts = [
        f("value.ebitdaLow", "EBITDA-basis value, low", usd(v.ebitdaRange[0])),
        f("value.ebitdaHigh", "EBITDA-basis value, high", usd(v.ebitdaRange[1])),
        f("value.sdeLow", "SDE-basis value, low", usd(v.sdeRange[0])),
        f("value.sdeHigh", "SDE-basis value, high", usd(v.sdeRange[1])),
        f("value.normalized", "Normalized EBITDA", usd(v.normalizedEbitdaCents)),
        f("value.multiples", "EBITDA multiple range", `${v.multiples.ebitda[0].toFixed(1)}x to ${v.multiples.ebitda[1].toFixed(1)}x`),
        f("value.readiness", "Exit readiness score out of 100", String(r.score)),
        ...r.topActions.map((a, i) => f(`value.action${i}`, `Value lever ${i + 1}`, a)),
      ];
      if (v.realEstate) facts.push(f("value.realEstate", "Real estate net equity, separate from the business", usd(v.realEstate.netEquityCents)));
      return { facts, data: { ebitdaRange: v.ebitdaRange, score: r.score } };
    },
  },
  {
    name: "run_scenario",
    description:
      "Run a what-if: lose_customer (customer, pct), exit_line (line), grow_line (line, pct), materials (pct), hire (count), buy_equipment (priceCents), payment_delay (amountCents, days). Returns the restated year.",
    scope: "analyze",
    inputSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["lose_customer", "exit_line", "grow_line", "materials", "hire", "buy_equipment", "payment_delay"] },
        customer: { type: "string" },
        line: { type: "string" },
        pct: { type: "number" },
        count: { type: "integer" },
        priceCents: { type: "integer" },
        amountCents: { type: "integer" },
        days: { type: "integer" },
      },
    },
    async run(ctx, i) {
      const facts: Fact[] = [];
      const restated = (r: scen.ScenarioImpact) => {
        facts.push(
          f("scenario.revenueChange", "Revenue change", usd(r.delta.revenueCents)),
          f("scenario.ebitdaChange", "EBITDA change", usd(r.delta.ebitdaCents)),
          f("scenario.ebitdaAfter", "EBITDA after", usd(r.after.ebitdaCents)),
          f("scenario.cashAfter", "Cash after a year", usd(r.after.cashCents))
        );
        if (r.delta.enterpriseValueCents !== null) facts.push(f("scenario.valueChange", "Business value change", usd(r.delta.enterpriseValueCents)));
        return { facts, data: r };
      };
      switch (i.kind) {
        case "lose_customer":
          return restated(await scen.loseCustomerShare(ctx.companyId, ctx.ledger, i.customer ?? "", i.pct ?? 100));
        case "exit_line":
          return restated(await scen.exitServiceLine(ctx.companyId, ctx.ledger, i.line ?? ""));
        case "grow_line":
          return restated(await scen.growServiceLine(ctx.companyId, ctx.ledger, i.line ?? "", i.pct ?? 10));
        case "materials": {
          const r = await scen.materialsIncrease(ctx.companyId, ctx.ledger, i.pct ?? 10);
          facts.push(f("scenario.materialsCost", "Added materials cost", usd(r.addedCostCents)), f("scenario.ebitdaShare", "Share of EBITDA it would erase", pctStr(r.ebitdaImpactPct)));
          return restated(r);
        }
        case "hire": {
          const h = await hireFor(ctx.companyId, ctx.ledger, { count: i.count ?? 1 });
          facts.push(f("hire.count", "People hired", String(h.count)), f("hire.monthlyCost", "Loaded monthly cost", usd(h.monthlyCostCents)));
          if (h.requiredMonthlyRevenueCents !== null) facts.push(f("hire.revenueNeeded", "New revenue needed each month at current margin", usd(h.requiredMonthlyRevenueCents)));
          if (h.addedCapacityCents !== null) facts.push(f("hire.capacity", "Revenue capacity added per year", usd(h.addedCapacityCents)));
          return { facts, data: h };
        }
        case "buy_equipment": {
          const d = await capitalDefaults(ctx.companyId, ctx.ledger);
          const price = i.priceCents ?? 55_000_00;
          const p = purchaseAnalysis({ priceCents: price, downPct: 20, ratePct: 8, termMonths: 60, monthlyRevenueCents: 0, grossMarginPct: d.grossMarginPct ?? 0, monthlyOperatingCents: 600_00, usefulLifeMonths: 84, cashCents: d.cashCents });
          facts.push(
            f("buy.price", "Purchase price", usd(price)),
            f("buy.downPct", "Down payment share", "20%"),
            f("buy.down", "Down payment at 20%", usd(p.downPaymentCents)),
            f("buy.payment", "Monthly payment at 8% over 60 months", usd(p.monthlyPaymentCents)),
            f("buy.breakeven", "New revenue needed each month to cover it", usd(p.breakevenMonthlyRevenueCents ?? 0))
          );
          if (p.cashAfterDownCents !== null) facts.push(f("buy.cashAfter", "Cash left after the down payment", usd(p.cashAfterDownCents)));
          return { facts, data: p };
        }
        case "payment_delay": {
          const r = await scen.paymentDelay(ctx.companyId, i.amountCents ?? 0, i.days ?? 30);
          facts.push(
            f("delay.amount", "Payments arriving late", usd(r.amountCents)),
            f("delay.days", "Days late", `${r.days} days`),
            f("delay.low", "13-week cash low with the delay", usd(r.minCashCents)),
            f("delay.loc", "Credit line needed", r.locDrawRequired ? "yes" : "no")
          );
          return { facts, data: r };
        }
      }
      return { facts: [], data: null };
    },
  },
  {
    name: "list_notes",
    description: "The owner's most recent notes.",
    scope: "read",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    async run(ctx, i) {
      const notes = await prisma.note.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: i.limit ?? 10 });
      return { facts: notes.map((x, k) => f(`note.${k}`, x.subject ?? `Note from ${x.createdAt.toISOString().slice(0, 10)}`, x.body)), data: notes };
    },
  },
  {
    name: "add_note",
    description: "Save a note for the owner, such as a decision or a follow-up.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["body"],
      additionalProperties: false,
      properties: { subject: { type: "string", maxLength: 120 }, body: { type: "string", minLength: 1, maxLength: 4000 } },
    },
    async run(ctx, i) {
      const note = await prisma.note.create({ data: { companyId: ctx.companyId, subject: i.subject ?? null, body: String(i.body), source: "TOOL" } });
      return { facts: [f("note.saved", "Note saved", note.subject ?? "untitled")], data: { id: note.id } };
    },
  },
  {
    name: "set_budget",
    description: "Set a budget line for a year: REVENUE, DIRECT_COST, OPEX, CAPEX, or NET_INCOME, in cents.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["year", "line", "amountCents"],
      additionalProperties: false,
      properties: {
        year: { type: "integer", minimum: 2000, maximum: 2100 },
        line: { type: "string", enum: ["REVENUE", "DIRECT_COST", "OPEX", "CAPEX", "NET_INCOME"] },
        amountCents: { type: "integer" },
      },
    },
    async run(ctx, i) {
      const existing = await prisma.budget.findFirst({ where: { companyId: ctx.companyId, year: i.year, line: i.line } });
      if (existing) await prisma.budget.update({ where: { id: existing.id }, data: { budget: BigInt(i.amountCents) } });
      else await prisma.budget.create({ data: { companyId: ctx.companyId, year: i.year, line: i.line, budget: BigInt(i.amountCents) } });
      return { facts: [f("budget.saved", `${i.year} ${String(i.line).toLowerCase().replace("_", " ")} budget`, usd(i.amountCents))], data: { year: i.year, line: i.line } };
    },
  },
];

export const SCOPES_BY_ROLE: Record<string, Scope[]> = { OWNER: ["read", "analyze", "write"], ACCOUNTANT: ["read", "analyze", "write"], MEMBER: ["read", "analyze"], VIEWER: ["read"] };

export function toolsFor(scopes: Scope[]) {
  return TOOLS.filter((t) => scopes.includes(t.scope));
}

export async function toolContext(companyId: string): Promise<ToolContext> {
  const [ledger, asOf] = await Promise.all([loadLedger(companyId), companyAsOf(companyId)]);
  return { companyId, ledger, asOf };
}

export interface Caller {
  caller: string;
  userId?: string | null;
  apiKeyId?: string | null;
}

export class ToolError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Run a tool after checking its scope, and log the call. */
export async function callTool(ctx: ToolContext, name: string, input: Record<string, any>, scopes: Scope[], who: Caller = { caller: "internal" }): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool ${name}.`, 404);
  const started = Date.now();
  const log = (ok: boolean, error?: string) =>
    prisma.toolCallLog
      .create({ data: { companyId: ctx.companyId, tool: name, scope: tool.scope, caller: who.caller, userId: who.userId ?? null, apiKeyId: who.apiKeyId ?? null, ok, error: error?.slice(0, 500) ?? null, durationMs: Date.now() - started } })
      .catch(() => undefined);
  if (!scopes.includes(tool.scope)) {
    await log(false, "permission");
    throw new ToolError(`${name} needs ${tool.scope} permission.`, 403);
  }
  try {
    const r = await tool.run(ctx, input ?? {});
    await log(true);
    return r;
  } catch (e) {
    await log(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
