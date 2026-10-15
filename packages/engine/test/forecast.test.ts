import { describe, it, expect } from "vitest";
import { CASES, expandStream, monthWindows, projectCash, weekWindows, type ForecastInput } from "../src/forecast.js";
import { forecastError, forecastRevenue, runRateProjection, seasonalProjection, trailingGrowth } from "../src/revenueForecast.js";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("forecast windows", () => {
  it("closes a mid-week first window at the next Monday, then runs full weeks", () => {
    const w = weekWindows(d("2025-12-31"), 13); // a Wednesday
    expect(w).toHaveLength(13);
    expect(w[0].start.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(w[0].end.toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(w[1].end.getTime() - w[1].start.getTime()).toBe(7 * 86_400_000);
  });

  it("starts on the as-of date when it is a Monday", () => {
    const w = weekWindows(d("2026-01-05"), 2);
    expect(w[0].start.toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(w[0].end.toISOString().slice(0, 10)).toBe("2026-01-12");
  });

  it("builds twelve calendar months after the as-of month", () => {
    const m = monthWindows(d("2025-12-31"), 12);
    expect(m.map((x) => x.label)[0]).toBe("2026-01");
    expect(m.at(-1)!.label).toBe("2026-12");
  });
});

describe("streams", () => {
  it("expands biweekly payroll to the right monthly total", () => {
    const flows = expandStream({ category: "payroll", label: "Payroll", monthlyCents: 26_000_00, cadence: "biweekly" }, d("2026-01-01"), d("2027-01-01"));
    const total = flows.reduce((s, f) => s + f.cents, 0);
    expect(Math.abs(total - 12 * 26_000_00)).toBeLessThan(26_000_00); // ~12 months, within one paycheck
  });

  it("applies seasonality by calendar month", () => {
    const season = Array(12).fill(1);
    season[6] = 2;
    const flows = expandStream({ category: "service_revenue", label: "s", monthlyCents: 100, cadence: "monthly", seasonality: season }, d("2026-06-01"), d("2026-09-01"));
    expect(flows.map((f) => f.cents)).toEqual([100, 200, 100]);
  });
});

describe("cash projection", () => {
  const base: ForecastInput = {
    asOf: d("2026-01-05"),
    openingCashCents: 100_000_00,
    reserveTargetCents: 50_000_00,
    locLimitCents: 40_000_00,
    locBalanceCents: 0,
    flows: [
      { date: d("2026-01-14"), cents: 90_000_00, category: "payroll", label: "Payroll" },
      { date: d("2026-01-28"), cents: 120_000_00, category: "collections", label: "Big GC" },
    ],
    streams: [],
  };

  it("draws on the line to protect the reserve and repays when cash returns", () => {
    const f = projectCash(base, weekWindows(base.asOf, 4));
    expect(f.buckets[1].locDrawCents).toBe(40_000_00);
    expect(f.buckets[1].endingCents).toBe(50_000_00);
    expect(f.buckets[3].locBalanceCents).toBe(0);
    expect(f.peakLocCents).toBe(40_000_00);
  });

  it("reports the shortfall week before credit and says why", () => {
    const f = projectCash(base, weekWindows(base.asOf, 4));
    expect(f.shortfall?.label).toBe("Wk 2");
    expect(f.shortfall?.cents).toBe(10_000_00);
    expect(f.shortfall?.explanation).toMatch(/Payroll \$90,000/);
  });

  it("slows collections in the downside case", () => {
    const down = projectCash(base, weekWindows(base.asOf, 4), CASES.downside);
    // Collection moves 15 days later, out of week 4.
    expect(down.buckets[3].inflows.collections ?? 0).toBe(0);
  });
});

describe("revenue forecast", () => {
  const hist = new Map<string, number>();
  for (let y = 2024; y <= 2025; y++) for (let m = 1; m <= 12; m++) hist.set(`${y}-${String(m).padStart(2, "0")}`, (y === 2025 ? 110 : 100) * (m === 7 ? 2 : 1));

  it("measures trailing growth year over year", () => {
    expect(trailingGrowth(hist, "2025-12")).toBeCloseTo(0.1, 5);
  });

  it("projects same month last year, grown", () => {
    const p = seasonalProjection(hist, d("2025-12-31"), ["2026-07", "2026-08"]);
    expect(p.get("2026-07")).toBe(242); // 220 * 1.1
    expect(p.get("2026-08")).toBe(121);
  });

  it("projects a flat trailing run-rate for project work", () => {
    const p = runRateProjection(hist, d("2025-12-31"), ["2026-03"]);
    expect(p.get("2026-03")).toBe(Math.round(((110 * 11 + 220) / 12) * 1.1));
  });

  it("fills unsigned project revenue up to the run rate, never below zero", () => {
    const r = forecastRevenue({
      asOf: d("2025-12-31"),
      signed: [{ id: "j", name: "Job", remainingCents: 1_000_000, start: d("2026-01-01"), end: d("2026-01-31") }],
      pipeline: [{ id: "p", name: "Bid", valueCents: 500, probabilityPct: 50, expectedStart: d("2026-02-01"), durationMonths: 1 }],
      recurringHistory: new Map(),
      serviceHistory: new Map(),
      projectHistory: hist,
      months: 3,
    });
    expect(r.months[0].signedCents).toBe(1_000_000);
    expect(r.months[0].unsignedCents).toBe(0);
    expect(r.months[1].unsignedCents).toBeGreaterThan(0);
    expect(r.months[1].pipelineCents).toBe(250);
    expect(r.months[1].totalCents).toBe(r.months[1].unsignedCents); // pipeline shown, not added
  });

  it("grades a forecast with mean absolute percentage error and bias", () => {
    const e = forecastError(new Map([["a", 90], ["b", 120]]), new Map([["a", 100], ["b", 100]]));
    expect(e.mapePct).toBe(15);
    expect(e.biasPct).toBe(5);
  });
});

import { dailyBalances } from "../src/forecast.js";

describe("dailyBalances", () => {
  it("walks the balance day by day and finds the low", () => {
    const r = dailyBalances(
      {
        asOf: d("2026-01-01"),
        openingCashCents: 100_000_00,
        reserveTargetCents: 50_000_00,
        locLimitCents: 0,
        locBalanceCents: 0,
        flows: [
          { date: d("2026-01-05"), cents: 70_000_00, category: "payroll", label: "Payroll" },
          { date: d("2026-01-10"), cents: 40_000_00, category: "collections", label: "Customer" },
        ],
        streams: [],
      },
      15
    );
    expect(r.series).toHaveLength(15);
    expect(r.low).toEqual({ date: "2026-01-05", cents: 30_000_00 });
    expect(r.firstUnderReserve).toBe("2026-01-05");
    expect(r.endingCents).toBe(70_000_00);
  });
});
