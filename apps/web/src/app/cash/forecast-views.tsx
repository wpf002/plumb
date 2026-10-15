"use client";

import { Locked } from "../plan-ui";
import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd, shortDate, C , readGated } from "../ui";

const IN_LABEL: Record<string, string> = {
  collections: "Collections",
  progress_billings: "Progress Billings",
  recurring_receipts: "Recurring Receipts",
  service_revenue: "Service Revenue",
  loan_proceeds: "Loan Proceeds",
  other_inflow: "Other",
};
const OUT_LABEL: Record<string, string> = {
  payroll: "Payroll",
  materials: "Materials & Subs",
  subcontractors: "Subcontractors",
  payables: "Payables",
  debt_payments: "Debt Payments",
  operating_expenses: "Overhead",
  taxes: "Taxes",
  insurance: "Insurance",
  rent: "Rent",
  capex: "Equipment",
  distributions: "Owner Distributions",
  other_outflow: "Other",
};

function useApi(path: string) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    const id = getCompanyId();
    if (!id) return;
    let live = true;
    setData(null);
    apiFetch(`/companies/${id}${path}`, { cache: "no-store" })
      .then(readGated)
      .then((j) => live && setData(j));
    return () => {
      live = false;
    };
  }, [path]);
  return data;
}

function categoriesIn(buckets: any[], side: "inflows" | "outflows") {
  const keys = new Set<string>();
  for (const b of buckets) for (const k of Object.keys(b[side])) if (b[side][k]) keys.add(k);
  return [...keys];
}

/** Weekly or monthly cash table: beginning, each flow line, ending, credit, reserve. */
export function CashTable({ forecast }: { forecast: any }) {
  const b = forecast.buckets;
  const ins = categoriesIn(b, "inflows");
  const outs = categoriesIn(b, "outflows");
  const row = (label: string, values: (number | null)[], cls = "") => (
    <tr key={label} className={cls}>
      <td className="statement-label">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`num${v !== null && v < 0 ? " neg" : ""}`}>
          {v === null || v === 0 ? "—" : usd(v)}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="statement-scroll">
      <table className="table statement">
        <thead>
          <tr>
            <th className="statement-label" />
            {b.map((x: any) => (
              <th key={x.label} className="num" title={`${x.start} – ${x.end}`}>
                {x.label}
                <div className="th-sub">{shortDate(x.start).replace(/, \d{4}$/, "")}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row("Beginning Cash", b.map((x: any) => x.beginningCents), "statement-subtotal")}
          <tr className="statement-section">
            <td colSpan={b.length + 1}>Coming In</td>
          </tr>
          {ins.map((k) => row(IN_LABEL[k] ?? k, b.map((x: any) => x.inflows[k] ?? 0)))}
          {row("Total In", b.map((x: any) => x.totalInCents), "statement-subtotal")}
          <tr className="statement-section">
            <td colSpan={b.length + 1}>Going Out</td>
          </tr>
          {outs.map((k) => row(OUT_LABEL[k] ?? k, b.map((x: any) => -(x.outflows[k] ?? 0))))}
          {row("Total Out", b.map((x: any) => -x.totalOutCents), "statement-subtotal")}
          {forecast.locLimitCents > 0 && row("Credit Line Draw / (Repay)", b.map((x: any) => x.locDrawCents - x.locRepayCents))}
          {row("Ending Cash", b.map((x: any) => x.endingCents), "statement-subtotal")}
          {forecast.locLimitCents > 0 && row("Credit Line Balance", b.map((x: any) => x.locBalanceCents))}
          <tr>
            <td className="statement-label">Reserve Target</td>
            {b.map((x: any) => (
              <td key={x.label} className={`num ${x.belowReserve ? "neg" : "muted"}`}>
                {usd(forecast.reserveTargetCents)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Plain names for the three forecast cases. */
const CASE_LABEL: Record<string, string> = { base: "Expected", upside: "Best Case", downside: "Worst Case" };

export function ThirteenWeek() {
  const [fcase, setCase] = useState("base");
  const data = useApi(`/forecast/13-week?case=${fcase}`);
  if (!data) return <div className="card">Loading…</div>;
  if (data.__locked) return <Locked info={data.__locked} />;
  const f = data.forecast;
  return (
    <>
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            13-Week Forecast
          </div>
          <div className="tabs">
            {["base", "upside", "downside"].map((k) => (
              <button key={k} className={`tab${k === fcase ? " active" : ""}`} onClick={() => setCase(k)}>
                {CASE_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="stat-label">Starting Cash</div>
            <div className="stat-value num">{usd(f.buckets[0]?.beginningCents ?? 0)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Lowest Point</div>
            <div className="stat-value num" style={{ color: f.lowest.cents < f.reserveTargetCents ? C.danger : undefined }}>
              {usd(f.lowest.cents)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Reserve Target</div>
            <div className="stat-value num">{usd(f.reserveTargetCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Credit Line Peak</div>
            <div className="stat-value num">{f.locLimitCents > 0 ? usd(f.peakLocCents) : "—"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Ends At</div>
            <div className="stat-value num">{usd(f.endingCents)}</div>
          </div>
        </div>
        {f.shortfall ? (
          <div className="alert critical" style={{ marginBottom: 16 }}>
            <div>
              <div className="alert-title">
                Cash falls below your {usd(f.reserveTargetCents)} reserve the week of {shortDate(f.shortfall.start)}.
              </div>
              <div className="alert-detail">{f.shortfall.explanation}</div>
            </div>
          </div>
        ) : null}
        <CashTable forecast={f} />
      </section>
    </>
  );
}

export function TwelveMonth() {
  const data = useApi("/forecast/12-month");
  if (!data) return <div className="card">Loading…</div>;
  if (data.__locked) return <Locked info={data.__locked} />;
  const { base, upside, downside } = data.cases;
  const w = 900;
  const h = 200;
  const all = [base, upside, downside].flatMap((c: any) => c.buckets.map((b: any) => b.endingCents));
  const max = Math.max(...all, base.reserveTargetCents, 0);
  const min = Math.min(...all, 0);
  const x = (i: number) => 8 + ((w - 16) * i) / Math.max(1, base.buckets.length - 1);
  const y = (v: number) => 8 + (h - 32) * (1 - (v - min) / (max - min || 1));
  const line = (c: any) => c.buckets.map((b: any, i: number) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b.endingCents).toFixed(1)}`).join(" ");
  return (
    <>
      <section className="card">
        <div className="card-title">12-Month Forecast</div>
        <div className="stats" style={{ marginBottom: 16 }}>
          {[
            [CASE_LABEL.base, base],
            [CASE_LABEL.upside, upside],
            [CASE_LABEL.downside, downside],
          ].map(([label, c]: any) => (
            <div className="stat" key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value num">{usd(c.endingCents)}</div>
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="12-month cash by case">
          <line x1={8} x2={w - 8} y1={y(base.reserveTargetCents)} y2={y(base.reserveTargetCents)} stroke={C.danger} strokeDasharray="4 4" />
          <path d={line(upside)} fill="none" stroke={C.good} strokeWidth="2" />
          <path d={line(downside)} fill="none" stroke={C.warn} strokeWidth="2" strokeDasharray="5 4" />
          <path d={line(base)} fill="none" stroke={C.ink} strokeWidth="2.5" />
          {base.buckets.map((b: any, i: number) =>
            i % 2 === 0 ? (
              <text key={b.label} x={x(i)} y={h - 6} fontSize="11" fill="#6b746f" textAnchor="middle">
                {b.label}
              </text>
            ) : null
          )}
        </svg>
        <div className="chips" style={{ marginTop: 8 }}>
          <span className="chip">
            <b style={{ color: C.ink }}>—</b> Expected
          </span>
          <span className="chip" title="Revenue 10% higher">
            <b style={{ color: C.good }}>—</b> Best Case
          </span>
          <span className="chip" title="Revenue 15% lower, customers pay 15 days later">
            <b style={{ color: C.warn }}>- -</b> Worst Case
          </span>
        </div>
      </section>
      <section className="card">
        <div className="card-title">By Month</div>
        <CashTable forecast={base} />
      </section>
    </>
  );
}

export function RevenueForecast() {
  const data = useApi("/forecast/revenue");
  if (!data) return <div className="card">Loading…</div>;
  if (data.__locked) return <Locked info={data.__locked} />;
  const t = data.totals;
  return (
    <section className="card">
      <div className="card-title">Revenue Forecast</div>
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Signed</div>
          <div className="stat-value num">{usd(t.signed)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Likely</div>
          <div className="stat-value num">{usd(t.likely)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Weighted Pipeline</div>
          <div className="stat-value num">{usd(t.pipeline)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Recurring</div>
          <div className="stat-value num">{usd(t.recurring)}</div>
        </div>
      </div>
      <div className="statement-scroll">
        <table className="table statement">
          <thead>
            <tr>
              <th className="statement-label" />
              {data.months.map((m: any) => (
                <th key={m.month} className="num">
                  {m.month}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Signed", "signedCents", t.signed],
              ["Expected New Work", "unsignedCents", t.unsigned],
              ["Recurring", "recurringCents", t.recurring],
              ["Service", "serviceCents", t.service],
            ].map(([label, key, total]: any) => (
              <tr key={key}>
                <td className="statement-label">{label}</td>
                {data.months.map((m: any) => (
                  <td key={m.month} className="num">
                    {m[key] ? usd(m[key]) : "—"}
                  </td>
                ))}
                <td className="num">{usd(total)}</td>
              </tr>
            ))}
            <tr className="statement-subtotal">
              <td className="statement-label">Projected Revenue</td>
              {data.months.map((m: any) => (
                <td key={m.month} className="num">
                  {usd(m.totalCents)}
                </td>
              ))}
              <td className="num">{usd(t.projectedAnnual)}</td>
            </tr>
            <tr>
              <td className="statement-label muted">Weighted Pipeline</td>
              {data.months.map((m: any) => (
                <td key={m.month} className="num muted">
                  {m.pipelineCents ? usd(m.pipelineCents) : "—"}
                </td>
              ))}
              <td className="num muted">{usd(t.pipeline)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Accuracy() {
  const data = useApi("/forecast/accuracy");
  if (!data) return <div className="card">Loading…</div>;
  if (data.__locked) return <Locked info={data.__locked} />;
  if (!data.backtest) return <section className="card"><p className="empty">Needs 18 months of books.</p></section>;
  const bt = data.backtest;
  return (
    <section className="card">
      <div className="card-title">Forecast vs Actual</div>
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Revenue Error</div>
          <div className="stat-value num">{bt.revenue.mapePct}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Month-End Cash Error</div>
          <div className="stat-value num">{bt.cash.mapePct}%</div>
        </div>
        {bt.jobMargin && (
          <div className="stat">
            <div className="stat-label">Job Margin Error</div>
            <div className="stat-value num">{bt.jobMargin.avgErrorPts} pts</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">Forecast Made</div>
          <div className="stat-value num">{shortDate(bt.asOf)}</div>
        </div>
      </div>
      {(bt.payroll || bt.backlog) && (
        <table className="table" style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Six Months</th>
              <th className="num">Forecast</th>
              <th className="num">Actual</th>
              <th className="num">Off By</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Payroll", bt.payroll],
              ["Backlog Earned", bt.backlog],
            ]
              .filter(([, v]) => v)
              .map(([label, v]: any) => (
                <tr key={label}>
                  <td className="cell-name">{label}</td>
                  <td className="num">{usd(v.forecastCents)}</td>
                  <td className="num">{usd(v.actualCents)}</td>
                  <td className="num">{v.errorPct === null ? "—" : `${v.errorPct > 0 ? "+" : ""}${v.errorPct}%`}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Revenue Forecast</th>
            <th className="num">Revenue Actual</th>
            <th className="num">Cash Forecast</th>
            <th className="num">Cash Actual</th>
          </tr>
        </thead>
        <tbody>
          {bt.revenue.months.map((m: any, i: number) => (
            <tr key={m.month}>
              <td className="cell-name">{m.month}</td>
              <td className="num">{usd(m.forecastCents)}</td>
              <td className="num">{m.actualCents === null ? "—" : usd(m.actualCents)}</td>
              <td className="num">{usd(bt.cash.months[i]?.forecastCents ?? 0)}</td>
              <td className="num">{bt.cash.months[i]?.actualCents == null ? "—" : usd(bt.cash.months[i].actualCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
