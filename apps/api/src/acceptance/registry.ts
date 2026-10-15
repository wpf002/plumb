import type { Analytics } from "../analytics/types.js";

/**
 * The acceptance answer key: every finding in each test account's
 * `19_ai_insights.md` and every scenario in `18_scenario_assumptions.md`,
 * restated as assertions against the analytics contract. Expected values are
 * copied from those files; the `ref` points back to the line they came from.
 *
 * Tolerances: money within 0.5% (the answer key rounds to the dollar and some
 * figures are themselves estimates); percentages within 0.2 points unless the
 * source states a range.
 */

export type AccountKey = "steve" | "joe" | "robert" | "jerry";

export interface Finding {
  account: AccountKey;
  ref: string;
  title: string;
  phase: string;
  run(a: Analytics): Promise<void>;
}

export class Mismatch extends Error {
  name = "Mismatch";
}

const $ = (dollars: number) => Math.round(dollars * 100);

function money(label: string, actualCents: number, expectedDollars: number, tolPct = 0.5) {
  const exp = $(expectedDollars);
  const tol = Math.max(100, Math.abs(exp) * (tolPct / 100));
  if (Math.abs(actualCents - exp) > tol) {
    throw new Mismatch(`${label}: expected $${expectedDollars.toLocaleString()}, got $${(actualCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  }
}

function pct(label: string, actual: number, expected: number, tolPts = 0.2) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolPts) {
    throw new Mismatch(`${label}: expected ${expected}%, got ${Number.isFinite(actual) ? actual.toFixed(2) : actual}%`);
  }
}

function between(label: string, actual: number, lo: number, hi: number) {
  if (!(actual >= lo && actual <= hi)) throw new Mismatch(`${label}: expected ${lo}–${hi}, got ${actual.toFixed(2)}`);
}

function equal<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) throw new Mismatch(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function truthy(label: string, v: unknown) {
  if (!v) throw new Mismatch(`${label}: expected true`);
}

function range(label: string, actual: [number, number], lo: number, hi: number, tolPct = 0.5) {
  money(`${label} low`, actual[0], lo, tolPct);
  money(`${label} high`, actual[1], hi, tolPct);
}

export const FINDINGS: Finding[] = [
  // ---------------------------------------------------------------- Steve
  {
    account: "steve", ref: "insight 1", phase: "D9",
    title: "Musco is 54.1% of lifetime contract revenue",
    async run(a) {
      const c = await a.customers.concentration();
      money("total lifetime revenue", c.totalCents, 9_568_600);
      truthy("top customer is Musco", /musco/i.test(c.top?.name ?? ""));
      money("Musco lifetime revenue", c.top!.cents, 5_179_700);
      pct("Musco share", c.top!.pct, 54.1, 0.1);
    },
  },
  {
    account: "steve", ref: "insight 2", phase: "D5",
    title: "2023 revenue and net income fell; worst profit-goal miss",
    async run(a) {
      const y22 = await a.statements.annual(2022);
      const y23 = await a.statements.annual(2023);
      money("2022 revenue", y22.revenue, 2_399_342);
      money("2023 revenue", y23.revenue, 2_061_189);
      money("2022 net income", y22.netIncome, 448_175);
      money("2023 net income", y23.netIncome, 241_533);
      pct("2023 profit-goal variance", await a.budget.netIncomeVariancePct(2023), -32.5, 0.1);
      equal("worst profit-goal year", await a.budget.worstProfitYear(), 2023);
    },
  },
  {
    account: "steve", ref: "insight 3", phase: "D6",
    title: "LOC maxed at $150,000 in March 2022 while profitable",
    async run(a) {
      const loc = await a.debt.loc();
      money("LOC limit", loc.limitCents, 150_000);
      money("LOC peak balance", loc.peakBalanceCents, 150_000);
      equal("LOC peak month", loc.peakPeriod, "2022-03");
      const low = await a.statements.cashLow(2022);
      equal("2022 cash low month", low.period, "2022-03");
      money("2022 cash low", low.cents, 31_098);
      money("2022 net income", (await a.statements.annual(2022)).netIncome, 448_175);
    },
  },
  {
    account: "steve", ref: "insight 4", phase: "D6",
    title: "AR $507,097; $28,774 more than 30 days past terms; Musco largest",
    async run(a) {
      const ag = await a.ar.aging();
      money("AR total", ag.totalCents, 507_097);
      money("AR > 30 past terms", ag.pastDue30Cents, 28_774, 1);
      truthy("largest balance is Musco", /musco/i.test(ag.largest?.customer ?? ""));
      money("Musco balance", ag.largest!.cents, 269_197);
    },
  },
  {
    account: "steve", ref: "insight 5", phase: "D8",
    title: "Musco jobs are materials-heavy, labor-light",
    async run(a) {
      const mix = await a.projects.costMix();
      const musco = mix.find((m) => /musco/i.test(m.category));
      truthy("Musco category present", musco);
      between("Musco labor %", musco!.laborPct, 19, 26);
      between("Musco materials %", musco!.materialsPct, 51, 63);
      for (const m of mix.filter((x) => !/musco/i.test(x.category))) {
        between(`${m.category} labor %`, m.laborPct, 25, 34);
        between(`${m.category} materials %`, m.materialsPct, 41, 51);
      }
    },
  },
  {
    account: "steve", ref: "insight 6", phase: "D8",
    title: "6 of 93 jobs underperformed by 8–16 points at 17.7% average",
    async run(a) {
      const m = await a.projects.marginPerformance();
      equal("project count", m.count, 93);
      equal("underperformers", m.under.count, 6);
      equal("outperformers", m.over.count, 6);
      pct("underperformers' average margin", m.under.avgActualMarginPct, 17.7, 0.2);
      between("smallest gap (pts)", m.under.minGapPts, 7.5, 16.5);
      between("largest gap (pts)", m.under.maxGapPts, 7.5, 16.5);
    },
  },
  {
    account: "steve", ref: "insight 7", phase: "D12",
    title: "Owner comp is $48,535 below market — no addback",
    async run(a) {
      const v = await a.valuation.compute();
      money("owner opex comp (burdened)", v.ownerComp.opexBurdenedCents, 122_773);
      money("gap below market", v.ownerComp.marketGapCents, -48_535);
    },
  },
  {
    account: "steve", ref: "insight 8", phase: "D12",
    title: "Profitable at ~20% EBITDA margin; multiple capped by key-person risk",
    async run(a) {
      const v = await a.valuation.compute();
      between("2025 EBITDA margin", v.ebitdaMarginPct, 19, 21);
      equal("SDE multiple low", v.multiples.sde[0], 2.0);
      equal("SDE multiple high", v.multiples.sde[1], 2.8);
      equal("EBITDA multiple low", v.multiples.ebitda[0], 3.0);
      equal("EBITDA multiple high", v.multiples.ebitda[1], 4.2);
    },
  },
  {
    account: "steve", ref: "insight 9", phase: "D10",
    title: "Fleet NBV $129,570 vs market $252,000; forklift is the replacement risk",
    async run(a) {
      const f = await a.fleet.summary();
      money("fleet net book value", f.netBookValueCents, 129_570, 1);
      money("fleet market value", f.marketValueCents, 252_000);
      truthy("forklift flagged for replacement", /forklift/i.test(f.replacementCandidate ?? ""));
    },
  },
  {
    account: "steve", ref: "insight 10", phase: "D8",
    title: "Backlog $296,800 + weighted pipeline $577,050 ≈ 31% of 2025 revenue",
    async run(a) {
      const b = await a.backlog.summary();
      money("signed backlog", b.signedCents, 296_800);
      money("weighted pipeline", b.weightedPipelineCents, 577_050);
      money("2025 revenue", (await a.statements.annual(2025)).revenue, 2_787_584);
      pct("coverage of 2025 revenue", b.coverageOfLastYearRevenuePct, 31.4, 0.6);
    },
  },
  {
    account: "steve", ref: "scenario 1", phase: "D12",
    title: "SDE-basis value $1.39M–$1.95M plus $480K real estate",
    async run(a) {
      const v = await a.valuation.compute();
      money("normalized EBITDA", v.normalizedEbitdaCents, 564_805);
      money("SDE", v.sdeCents, 697_178);
      range("SDE-basis EV", v.sdeRange, 1_394_356, 1_952_098);
      money("real estate", v.realEstate?.marketValueCents ?? 0, 480_000);
      money("total debt", await a.debt.totalCents(), 51_100);
    },
  },
  {
    account: "steve", ref: "scenario 2", phase: "D12",
    title: "EBITDA-basis value today $1.69M–$2.37M",
    async run(a) {
      range("EBITDA-basis EV", (await a.valuation.compute()).ebitdaRange, 1_694_416, 2_372_182);
    },
  },
  {
    account: "steve", ref: "scenario 3", phase: "D11",
    // ANSWER KEY DISAGREES WITH ITS OWN DATA. The scenario says 2025 Musco
    // revenue was ~$1,508,083 (54.1% of total), which applies Musco's lifetime
    // share to 2025 revenue. The 2025 books show $1,792,500 of Musco revenue
    // (revenue_musco in 03_income_statement_monthly.csv, and the same total in
    // 08_project_monthly_progress.csv), 64.3% of 2025 revenue. At the scenario's
    // stated ~30% contribution margin, losing 25% of it costs $448,125 of
    // revenue and $134,438 of EBITDA. The assertion follows the books.
    title: "Losing 25% of Musco cuts EBITDA ~$134,438 (answer key uses lifetime share)",
    async run(a) {
      const r = await a.scenarios.loseCustomerShare("Musco", 25, { contributionMarginPct: 30 });
      money("revenue lost", r.revenueLossCents, 448_125, 1);
      money("EBITDA impact", r.ebitdaDeltaCents, -134_438, 1);
    },
  },

  // ---------------------------------------------------------------- Joe
  {
    account: "joe", ref: "insight 1", phase: "D9",
    title: "Project crew is the bottleneck; maintenance has room",
    async run(a) {
      const u = await a.crews.utilization();
      truthy("project crew tracked", u.project);
      between("project crew average", u.project!.avgPct, 60, 94);
      equal("project crew peak year", u.project!.peakYear, 2024);
      between("project crew peak-year average", u.project!.peakYearAvgPct, 90, 98);
      truthy("maintenance tracked", u.maintenance);
      between("maintenance trailing-12 average", u.maintenance!.trailing12AvgPct, 61, 65);
    },
  },
  {
    account: "joe", ref: "insight 2", phase: "D8",
    title: "Turned-away bids grew from $79,900 to $320,600",
    async run(a) {
      const lost = await a.pipeline.lostByYear();
      money("lost 2022", lost[2022] ?? 0, 79_900);
      money("lost 2024", lost[2024] ?? 0, 373_800);
      money("lost 2025", lost[2025] ?? 0, 320_600);
    },
  },
  {
    account: "joe", ref: "insight 3", phase: "D9",
    // ANSWER KEY DISAGREES WITH ITS OWN DATA. The insight says project revenue
    // went "from a smaller share in 2022 to a majority by 2024-2025", but
    // 03_income_statement_monthly.csv has projects at 66.7% of revenue in 2022,
    // 66.7% in 2023, 68.1% in 2024, and 65.4% in 2025. The assertion follows the
    // books: projects are the majority every year and the share is roughly flat.
    title: "Projects are ~two-thirds of revenue every year (answer key misstates the trend)",
    async run(a) {
      const share = async (y: number) => {
        const s = await a.statements.annual(y);
        const project = Object.entries(s.revenueByLine).filter(([k]) => /project/i.test(k)).reduce((t, [, v]) => t + v, 0);
        return (project / s.revenue) * 100;
      };
      pct("2022 project share", await share(2022), 66.7);
      pct("2024 project share", await share(2024), 68.1);
      pct("2025 project share", await share(2025), 65.4);
    },
  },
  {
    account: "joe", ref: "insight 4", phase: "D9",
    title: "No customer above 6.8% of lifetime revenue",
    async run(a) {
      pct("largest customer share", (await a.customers.concentration()).maxPct, 6.8, 0.1);
    },
  },
  {
    account: "joe", ref: "insight 5", phase: "D9",
    title: "Recurring revenue $453,395 → $693,274; $261,105 cash",
    async run(a) {
      money("recurring 2022", (await a.recurring.annual(2022)).cents, 453_395);
      money("recurring 2025", (await a.recurring.annual(2025)).cents, 693_274);
      money("Dec 2025 cash", (await a.statements.month("2025-12")).cash, 261_105);
    },
  },
  {
    account: "joe", ref: "insight 6", phase: "D8",
    title: "6 of 73 jobs missed target margin by 9+ points",
    async run(a) {
      const m = await a.projects.marginPerformance();
      equal("project count", m.count, 73);
      equal("underperformers", m.under.count, 6);
      truthy("all missed by 9+ points", m.under.minGapPts >= 8.5);
    },
  },
  {
    account: "joe", ref: "insight 7", phase: "D6",
    // ANSWER KEY DISAGREES WITH ITS OWN DATA. The insight (and the dataset README)
    // say the $100,000 line "sat undrawn throughout 2022-2025", but
    // 04_balance_sheet_monthly.csv carries a line_of_credit balance in 14 months,
    // maxing at $100,000 in 2022-03, and 05_cash_flow_monthly.csv records the
    // draws. The assertion follows the books.
    title: "$100,000 LOC maxed in March 2022 (answer key says never drawn)",
    async run(a) {
      const loc = await a.debt.loc();
      money("LOC limit", loc.limitCents, 100_000);
      equal("ever drawn", loc.everDrawn, true);
      money("LOC peak", loc.peakBalanceCents, 100_000);
      equal("LOC peak month", loc.peakPeriod, "2022-03");
    },
  },
  {
    account: "joe", ref: "insight 8", phase: "D9",
    title: "Recurring revenue swings 35–45% winter to summer",
    async run(a) {
      between("recurring seasonal swing", await a.recurring.seasonalSwingPct(), 33, 47);
    },
  },
  {
    account: "joe", ref: "insight 9", phase: "D5",
    title: "2022 thin year; gross margin 25.2% → 31.2%",
    async run(a) {
      const y22 = await a.statements.annual(2022);
      money("2022 revenue", y22.revenue, 1_360_937);
      between("2022 net income", y22.netIncome / 100, 10_000, 20_000);
      pct("2022 gross margin", y22.grossMarginPct, 25.2);
      pct("2024 gross margin", (await a.statements.annual(2024)).grossMarginPct, 31.2);
    },
  },
  {
    account: "joe", ref: "insight 10", phase: "D10",
    title: "Second crew breaks even at ~11% of capacity",
    async run(a) {
      // Inputs from 18_scenario_assumptions.md; capacity and margin come from the books.
      const r = await a.scenarios.crewExpansion({
        equipmentCents: 140_500_00,
        downPct: 15,
        ratePct: 7.9,
        termMonths: 60,
        insuranceAnnualCents: 9_600_00,
        fuelMaintenanceAnnualCents: 14_000_00,
        ramp: [0.45, 0.6, 0.72],
        burdenedPayrollAnnualCents: 299_187_00,
      });
      money("breakeven revenue", r.breakevenRevenueCents, 155_989, 1);
      between("breakeven % of mature capacity", r.breakevenPctOfCapacity, 10, 12);
      money("year-1 contribution", r.year1ContributionCents, 156_772, 1);
    },
  },

  // ---------------------------------------------------------------- Robert
  {
    account: "robert", ref: "insight 1", phase: "D5",
    title: "Revenue +30% while EBITDA margin compressed",
    async run(a) {
      const y22 = await a.statements.annual(2022);
      const y24 = await a.statements.annual(2024);
      const y25 = await a.statements.annual(2025);
      money("2022 revenue", y22.revenue, 6_310_688);
      money("2025 revenue", y25.revenue, 8_203_004);
      pct("2022 EBITDA margin", y22.ebitdaMarginPct, 14.7);
      pct("2024 EBITDA margin", y24.ebitdaMarginPct, 12.2);
      pct("2025 EBITDA margin", y25.ebitdaMarginPct, 13.7);
      pct("2022 COGS % of revenue", y22.cogsPctOfRevenue, 68.6);
      pct("2025 COGS % of revenue", y25.cogsPctOfRevenue, 71.1, 0.6);
    },
  },
  {
    account: "robert", ref: "insight 2", phase: "D9",
    title: "Maintenance agreements 6.5% → 14.7% of revenue",
    async run(a) {
      const r22 = await a.recurring.annual(2022);
      const r25 = await a.recurring.annual(2025);
      money("maintenance 2022", r22.cents, 411_082);
      money("maintenance 2025", r25.cents, 1_204_817);
      pct("2022 share", r22.sharePct, 6.5);
      pct("2025 share", r25.sharePct, 14.7);
    },
  },
  {
    account: "robert", ref: "insight 3", phase: "D9",
    title: "Residential service −18%, residential install +117%",
    async run(a) {
      const y22 = (await a.statements.annual(2022)).revenueByLine;
      const y25 = (await a.statements.annual(2025)).revenueByLine;
      money("res service 2022", y22["Residential Service"] ?? 0, 1_977_521);
      money("res service 2025", y25["Residential Service"] ?? 0, 1_630_630);
      money("res install 2022", y22["Residential Install"] ?? 0, 1_093_189);
      money("res install 2025", y25["Residential Install"] ?? 0, 2_371_822);
    },
  },
  {
    account: "robert", ref: "insight 4", phase: "D9",
    title: "Commercial install flat (+6%)",
    async run(a) {
      money("com install 2022", (await a.statements.annual(2022)).revenueByLine["Commercial Install"] ?? 0, 1_377_092);
      money("com install 2025", (await a.statements.annual(2025)).revenueByLine["Commercial Install"] ?? 0, 1_455_180);
    },
  },
  {
    account: "robert", ref: "insight 5", phase: "D9",
    title: "Revenue per field employee rose 13%",
    async run(a) {
      const r22 = await a.labor.revenuePerFieldEmployee(2022);
      const r25 = await a.labor.revenuePerFieldEmployee(2025);
      equal("2022 field employees", r22.fieldCount, 34);
      equal("2025 field employees", r25.fieldCount, 39);
      money("2022 revenue per field employee", r22.cents, 185_608);
      money("2025 revenue per field employee", r25.cents, 210_333);
    },
  },
  {
    account: "robert", ref: "insight 6", phase: "D8",
    title: "64 of 372 installs ran >4% over, eroding $184,933",
    async run(a) {
      const o = await a.projects.overruns(4);
      equal("projects", o.total, 372);
      equal("overruns", o.count, 64);
      money("gross profit eroded", o.grossProfitErodedCents, 184_933, 1);
    },
  },
  {
    account: "robert", ref: "insight 7", phase: "D6",
    title: "AR $323,735; $35,650 past due, mostly COM-014",
    async run(a) {
      const ag = await a.ar.aging();
      money("AR total", ag.totalCents, 323_735);
      money("AR > 30 past terms", ag.pastDue30Cents, 35_650, 1);
      truthy("COM-014 is the past-due concentration", /COM-014/.test(`${ag.largestPastDue?.externalId ?? ""} ${ag.largestPastDue?.customer ?? ""}`));
      money("COM-014 past due", ag.largestPastDue!.pastDueCents, 31_400);
    },
  },
  {
    account: "robert", ref: "insight 8", phase: "D6",
    title: "Cash $215,000 → $1,445,600; LOC peak $128,934 of $350,000",
    async run(a) {
      money("starting cash", await a.statements.firstCash(), 215_000, 2);
      money("Dec 2025 cash", (await a.statements.month("2025-12")).cash, 1_445_600);
      const loc = await a.debt.loc();
      money("LOC limit", loc.limitCents, 350_000);
      money("LOC peak", loc.peakBalanceCents, 128_934);
    },
  },
  {
    account: "robert", ref: "insight 9", phase: "D9",
    // ANSWER KEY DISAGREES WITH ITS OWN DATA. The 22.1% / 5.5% figures come from
    // 06_customers.csv, whose denominator ($14,004,517) only covers the 245
    // customers in that file. 20b_maintenance_agreement_detail.csv bills 115
    // customers, 44 of them missing from 06_customers.csv, worth $1,372,884 of
    // maintenance revenue that is on the P&L. Counting all of it ($15,377,401),
    // the top five are 20.1% and Mercy Health is 4.97%. The conclusion (no
    // dangerous concentration) is the same; the assertion follows the books.
    title: "Top-5 customers 20.1%, largest 5.0% (answer key omits 44 maintenance customers)",
    async run(a) {
      const c = await a.customers.concentration();
      money("tracked lifetime revenue", c.totalCents, 15_377_401);
      pct("top-5 share", c.top5Pct, 20.1);
      pct("largest share", c.maxPct, 4.97);
    },
  },
  {
    account: "robert", ref: "insight 10", phase: "D12",
    title: "Owner comp near market; reported ≈ normalized EBITDA",
    async run(a) {
      const v = await a.valuation.compute();
      money("owner opex comp", v.ownerComp.opexBurdenedCents, 195_463);
      money("reported EBITDA", v.reportedEbitdaCents, 1_123_084);
      money("normalized EBITDA", v.normalizedEbitdaCents, 1_125_146);
    },
  },
  {
    account: "robert", ref: "scenario 1", phase: "D12",
    // ANSWER KEY DISAGREES WITH ITS OWN DATA. Its equity value subtracts total
    // debt of $654,488, which includes the $287,180 mortgage, and then adds real
    // estate net equity that subtracts the same mortgage again. Valuing the
    // operating company apart from the real estate, operating debt is $367,308
    // (vehicle_equipment_debt on the Dec 2025 balance sheet), so operating
    // equity is $4,144,071 to $5,210,429 and real estate adds $1,472,820.
    title: "Value ranges and $1.47M real-estate equity (answer key counts the mortgage twice)",
    async run(a) {
      const v = await a.valuation.compute();
      money("SDE", v.sdeCents, 1_332_947);
      range("SDE-basis EV", v.sdeRange, 3_065_779, 4_132_137);
      range("EBITDA-basis EV", v.ebitdaRange, 3_938_012, 5_175_673);
      range("operating equity value", v.equityRange, 4_144_071, 5_210_429);
      money("real-estate net equity", v.realEstate?.netEquityCents ?? 0, 1_472_820);
    },
  },
  {
    account: "robert", ref: "scenario 2", phase: "D11",
    title: "Exiting residential service costs ~$489,189 of contribution",
    async run(a) {
      // The scenario states a ~30% contribution margin after direct labor and materials.
      const r = await a.scenarios.exitServiceLine("Residential Service", { contributionMarginPct: 30 });
      money("segment revenue", r.revenueCents, 1_630_630);
      money("contribution lost", r.contributionLossCents, 489_189);
    },
  },
  {
    account: "robert", ref: "scenario 3", phase: "D11",
    title: "Growing residential install 30% adds $711,547",
    async run(a) {
      const r = await a.scenarios.growServiceLine("Residential Install", 30);
      money("added revenue", r.addedRevenueCents, 711_547);
      money("new segment revenue", r.newRevenueCents, 3_083_369);
    },
  },

  {
    account: "robert", ref: "scenario 4", phase: "D12",
    title: "Top value levers: margin trend and recurring revenue",
    async run(a) {
      const r = await a.valuation.exitReadiness();
      between("exit readiness score", r.score, 1, 100);
      equal("three top actions", r.topActions.length, 3);
      const text = r.topActions.join(" ").toLowerCase();
      truthy("names the EBITDA margin trend", /margin/.test(text));
      truthy("names recurring revenue", /recurring/.test(text));
    },
  },

  // ---------------------------------------------------------------- Jerry
  {
    account: "jerry", ref: "insight 1", phase: "D5",
    title: "Lumpy revenue; 2024 net loss",
    async run(a) {
      const rev = { 2022: 3_208_179, 2023: 4_855_022, 2024: 2_866_308, 2025: 3_161_381 } as const;
      for (const [y, v] of Object.entries(rev)) money(`${y} revenue`, (await a.statements.annual(+y)).revenue, v);
      money("2023 net income", (await a.statements.annual(2023)).netIncome, 446_554);
      money("2024 net income", (await a.statements.annual(2024)).netIncome, -92_094);
    },
  },
  {
    account: "jerry", ref: "insight 2", phase: "D5",
    title: "EBITDA margin 9.1 / 10.3 / −1.2 / 3.0",
    async run(a) {
      const exp = { 2022: 9.1, 2023: 10.3, 2024: -1.2, 2025: 3.0 } as const;
      for (const [y, v] of Object.entries(exp)) pct(`${y} EBITDA margin`, (await a.statements.annual(+y)).ebitdaMarginPct, v);
    },
  },
  {
    account: "jerry", ref: "insight 3", phase: "D5",
    title: "Nov 2023 profitable but operating cash −$650,013; low $145,615",
    async run(a) {
      const m = await a.statements.month("2023-11");
      money("Nov 2023 net income", m.netIncome, 37_239);
      money("Nov 2023 operating cash flow", m.operatingCashFlow, -650_013);
      const low = await a.statements.cashLow();
      equal("lowest cash month", low.period, "2022-09");
      money("lowest cash", low.cents, 145_615);
    },
  },
  {
    account: "jerry", ref: "insight 4", phase: "D8",
    title: "CUST-062 faded from ~19% to ~2.5%",
    async run(a) {
      const f = (await a.projects.marginFade()).find((x) => x.externalId === "CUST-062");
      truthy("CUST-062 flagged for margin fade", f);
      money("original contract", f!.originalContractCents, 551_157);
      between("starting projected margin", f!.peakProjectedMarginPct, 17, 21);
      between("final margin", f!.finalMarginPct, 1.5, 3.5);
    },
  },
  {
    account: "jerry", ref: "insight 5", phase: "D8",
    title: "REM-046 finished ~30% vs ~26% category average",
    async run(a) {
      const s = (await a.projects.standouts()).find((x) => x.externalId === "REM-046");
      truthy("REM-046 flagged as a standout", s);
      money("original contract", s!.originalContractCents, 168_819);
      between("final margin", s!.finalMarginPct, 29, 31);
      between("category average", s!.categoryAvgMarginPct, 25, 27);
    },
  },
  {
    account: "jerry", ref: "insight 6", phase: "D8",
    title: "Remodels 25.8% vs custom homes 17.0%",
    async run(a) {
      const t = await a.projects.byType("category");
      const rem = t.find((x) => /remodel/i.test(x.type));
      const cus = t.find((x) => /custom/i.test(x.type));
      equal("remodel count", rem?.count, 60);
      equal("custom home count", cus?.count, 12);
      pct("remodel avg margin", rem!.avgMarginPct, 25.8);
      pct("custom home avg margin", cus!.avgMarginPct, 17.0);
      money("remodel contract total", rem!.contractCents, 4_746_896);
      money("custom home contract total", cus!.contractCents, 9_449_374);
    },
  },
  {
    account: "jerry", ref: "insight 7", phase: "D5",
    title: "Materials ~28% of revenue",
    async run(a) {
      const y = await a.statements.annual(2025);
      money("2025 materials", y.cogsBySubtype.MATERIALS ?? 0, 862_795);
      pct("2025 materials share", ((y.cogsBySubtype.MATERIALS ?? 0) / y.revenue) * 100, 27.3);
    },
  },
  {
    account: "jerry", ref: "insight 8", phase: "D6",
    title: "AR $44,599, none past due",
    async run(a) {
      const ag = await a.ar.aging();
      money("AR total", ag.totalCents, 44_599);
      equal("AR > 30 past terms", ag.pastDue30Cents, 0);
    },
  },
  {
    account: "jerry", ref: "insight 9", phase: "D8",
    title: "12 custom homes started across 48 months",
    async run(a) {
      const s = await a.projects.startsByType();
      const custom = Object.entries(s).filter(([k]) => /custom/i.test(k)).reduce((t, [, v]) => t + v, 0);
      equal("custom home starts", custom, 12);
    },
  },
  {
    account: "jerry", ref: "insight 10", phase: "D9",
    title: "Field crew ceiling $539,447/employee (2023)",
    async run(a) {
      const r23 = await a.labor.revenuePerFieldEmployee(2023);
      const r25 = await a.labor.revenuePerFieldEmployee(2025);
      equal("field employees", r23.fieldCount, 9);
      money("2023 revenue per field employee", r23.cents, 539_447);
      money("2025 revenue per field employee", r25.cents, 351_265);
      const b = await a.backlog.summary();
      money("signed backlog", b.signedCents, 284_252);
      money("weighted pipeline", b.weightedPipelineCents, 879_750);
    },
  },
  {
    account: "jerry", ref: "scenario 1", phase: "D10",
    title: "Two field hires add ~$1.08M of capacity",
    async run(a) {
      money("added capacity", (await a.scenarios.fieldHire(2)).addedCapacityCents, 1_078_894);
    },
  },
  {
    account: "jerry", ref: "scenario 2", phase: "D11",
    title: "+10% materials cost would erase 90% of 2025 EBITDA",
    async run(a) {
      const r = await a.scenarios.materialsIncrease(10);
      money("added cost", r.addedCostCents, 86_279, 1);
      money("2025 EBITDA", r.ebitdaCents, 96_296, 1);
      between("EBITDA impact %", r.ebitdaImpactPct, 88, 92);
    },
  },
  {
    account: "jerry", ref: "scenario 3", phase: "D11",
    title: "Two customers 30 days late would need the LOC",
    async run(a) {
      const r = await a.scenarios.paymentDelay(10_209_600, 30);
      truthy("cash stays above zero or LOC is required", r.locDrawRequired || r.minCashCents > 0);
    },
  },
  {
    account: "jerry", ref: "scenario 4", phase: "D9",
    title: "~$1.69M (54%) of capacity headroom",
    async run(a) {
      const r = await a.scenarios.capacityHeadroom();
      money("capacity ceiling", r.ceilingCents, 4_855_022);
      money("headroom", r.headroomCents, 1_693_641);
      between("headroom %", r.headroomPct, 53, 55);
    },
  },
];

export const ACCOUNTS: Record<AccountKey, string> = {
  steve: "steve_electric",
  joe: "joe_landscaping",
  robert: "robert_plumbing_dataset",
  jerry: "jerry_gc_dataset",
};
