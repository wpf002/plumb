"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Locked } from "../plan-ui";
import { Stat } from "../stat";
import { apiFetch, getCompanyId, readGated, usd } from "../ui";

const HORIZONS = [30, 60, 90, 120, 180, 365];
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
/** $534,703 → $535K; $1,250,000 → $1.25M. */
const compact = (cents: number) => {
  const d = cents / 100;
  const a = Math.abs(d);
  const s = a >= 1_000_000 ? `$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M` : a >= 1000 ? `$${Math.round(a / 1000)}K` : `$${Math.round(a)}`;
  return d < 0 ? `-${s}` : s;
};

/** Round a range out to tidy gridline steps. */
function scale(lo: number, hi: number, ticks = 4) {
  const span = Math.max(hi - lo, Math.abs(hi) * 0.05, 100_00);
  const raw = span / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  return { min, max, steps: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step) };
}

function Chart({ data }: { data: any }) {
  const W = 1000;
  const H = 300;
  const L = 64;
  const R = 16;
  const T = 16;
  const B = 32;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const base: { date: string; cents: number }[] = data.series;
  const late: { date: string; cents: number }[] = data.lateSeries;
  const showLate = late.some((p, i) => p.cents !== base[i]?.cents);

  const { min, max, steps } = useMemo(() => {
    const vals = [...base.map((p) => p.cents), ...(showLate ? late.map((p) => p.cents) : []), data.openingCents];
    let lo = Math.min(...vals);
    const hi = Math.max(...vals);
    // Show the reserve line only when it's near enough to matter.
    if (data.reserveCents > 0 && data.reserveCents >= lo - (hi - lo) * 0.5) lo = Math.min(lo, data.reserveCents);
    return scale(lo, hi);
  }, [base, late, showLate, data.openingCents, data.reserveCents]);

  const x = (i: number) => L + (i / Math.max(1, base.length - 1)) * (W - L - R);
  const y = (c: number) => T + (1 - (c - min) / (max - min || 1)) * (H - T - B);
  const path = (pts: { cents: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(" ");
  const area = `${path(base)} L${x(base.length - 1)},${H - B} L${x(0)},${H - B} Z`;
  const reserveVisible = data.reserveCents > 0 && data.reserveCents >= min && data.reserveCents <= max;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (base.length - 1)));

  function move(e: React.MouseEvent) {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (base.length - 1));
    setHover(i >= 0 && i < base.length ? i : null);
  }

  return (
    <div className="daily-chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily cash balance" onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {steps.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">
              {compact(v)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor={i === 0 ? "start" : i === base.length - 1 ? "end" : "middle"} className="axis">
            {day(base[i].date)}
          </text>
        ))}
        {reserveVisible && (
          <g>
            <line x1={L} x2={W - R} y1={y(data.reserveCents)} y2={y(data.reserveCents)} className="reserve" />
            <text x={W - R} y={y(data.reserveCents) - 6} textAnchor="end" className="reserve-label">
              Reserve {compact(data.reserveCents)}
            </text>
          </g>
        )}
        <path d={area} className="area" />
        {showLate && <path d={path(late)} className="late" />}
        <path d={path(base)} className="line" />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cursor" />
            <circle cx={x(hover)} cy={y(base[hover].cents)} r={4} className="dot" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="daily-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{day(base[hover].date)}</b>
          <span>{usd(base[hover].cents)}</span>
          {showLate && <span className="muted">Late: {usd(late[hover].cents)}</span>}
        </div>
      )}
      {showLate && (
        <div className="legend" style={{ marginTop: 8 }}>
          <i className="bar-a" /> Expected <i className="bar-late" /> Customers Pay 15 Days Late
        </div>
      )}
    </div>
  );
}

export function DailyView() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    apiFetch(`/companies/${getCompanyId()}/forecast/daily?days=${days}`, { cache: "no-store" })
      .then(readGated)
      .then(setData);
  }, [days]);

  const picker = (
    <div className="tabs">
      {HORIZONS.map((h) => (
        <button key={h} className={`tab${h === days ? " active" : ""}`} onClick={() => setDays(h)}>
          {h === 365 ? "1 Year" : `${h} Days`}
        </button>
      ))}
    </div>
  );

  if (data?.__locked) return <Locked info={data.__locked} />;
  return (
    <>
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Daily Cash
          </div>
          {picker}
        </div>
        {!data ? (
          <div className="daily-chart" style={{ height: 300 }} />
        ) : (
          <>
            <div className="stats" style={{ margin: "8px 0 24px" }}>
              <Stat label="Starting Cash" value={usd(data.openingCents)} />
              <Stat label={`Lowest · ${day(data.low.date)}`} value={usd(data.low.cents)} tone={data.firstUnderReserve ? "neg" : undefined} />
              {data.lateLow.cents !== data.low.cents && <Stat label="Lowest If Paid Late" value={usd(data.lateLow.cents)} tone={data.lateFirstUnderReserve ? "neg" : undefined} />}
              <Stat label="Ending Cash" value={usd(data.endingCents)} />
            </div>
            <Chart data={data} />
            {data.firstUnderReserve && (
              <div className="alert critical" style={{ marginTop: 16 }}>
                <div className="alert-title">Cash falls below the reserve on {day(data.firstUnderReserve)}.</div>
              </div>
            )}
          </>
        )}
      </section>
      {data?.monthly?.length > 1 && (
        <section className="card">
          <div className="card-title">By Month</div>
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Lowest</th>
                <th className="num">Ending</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m: any) => (
                <tr key={m.month}>
                  <td className="cell-name">{month(m.month)}</td>
                  <td className={`num${m.lowCents < data.reserveCents ? " neg" : ""}`}>{usd(m.lowCents)}</td>
                  <td className="num">{usd(m.endingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
