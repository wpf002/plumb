"use client";

import { usd } from "../ui";

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${v.toFixed(d)}%`);
const signed = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : usd(v));

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num${tone ? ` ${tone}` : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const Empty = ({ what }: { what: string }) => <p className="card empty">{what}</p>;

export function ServiceLinesView({ data }: { data: any }) {
  if (!data.lines.length) return <Empty what="No full year of revenue yet." />;
  const years: number[] = data.years;
  const last = years.at(-1)!;
  const showMargin = data.costBasis === "direct";
  return (
    <section className="card">
      <div className="statement-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Line</th>
              {years.map((y) => (
                <th key={y} className="num">
                  {y}
                </th>
              ))}
              <th className="num">Share</th>
              <th className="num">Growth</th>
              <th className="num">Since {years[0]}</th>
              {showMargin && <th className="num" title="Direct costs named for the line, plus a revenue share of shared costs">Gross Margin</th>}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l: any) => (
              <tr key={l.line}>
                <td className="cell-name">{l.line}</td>
                {years.map((y) => (
                  <td key={y} className="num">
                    {usd(l.byYear[y].revenueCents)}
                  </td>
                ))}
                <td className="num">{pct(l.byYear[last].sharePct)}</td>
                <td className={`num${l.growthPct < 0 ? " neg" : ""}`}>{signed(l.growthPct)}</td>
                <td className={`num${l.sinceFirstPct < 0 ? " neg" : ""}`}>{signed(l.sinceFirstPct)}</td>
                {showMargin && <td className="num">{pct(l.byYear[last].marginPct)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CustomersView({ data }: { data: any }) {
  const c = data.concentration;
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Customers" value={String(data.rows.length)} />
          <Stat label="Largest" value={pct(c.maxPct)} sub={c.top?.name} tone={c.maxPct >= 25 ? "neg" : undefined} />
          <Stat label="Top Five" value={pct(c.top5Pct)} />
          <Stat label="Gross Margin" value={pct(data.marginPct)} />
        </div>
      </section>
      <section className="card">
        <div className="statement-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Revenue</th>
                <th className="num">Share</th>
                <th className="num">Gross Profit</th>
                <th className="num">Margin</th>
                <th className="num">Jobs</th>
                <th className="num">Days to Pay</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, 50).map((r: any) => (
                <tr key={r.key}>
                  <td className="cell-name" style={{ minWidth: 200 }}>
                    {r.name}
                    {r.flags.length > 0 && (
                      <div className="neg" style={{ fontSize: 12, fontWeight: 400 }}>
                        {r.flags.join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="num">{usd(r.revenueCents)}</td>
                  <td className="num">{pct(r.sharePct)}</td>
                  <td className="num">{usd(r.grossProfitCents)}</td>
                  <td className="num">{pct(r.marginPct)}</td>
                  <td className="num">{r.jobs || "—"}</td>
                  <td className="num">{r.avgDaysToPay === null ? "—" : Math.round(r.avgDaysToPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const KIND: Record<string, string> = { PROJECT: "Project", SERVICE: "Service", MAINTENANCE: "Maintenance" };

export function LaborView({ data }: { data: any }) {
  const latest = data.years.at(-1);
  const hasHours = data.years.some((y: any) => y.hours);
  const u = data.utilization;
  return (
    <>
      {latest && (
        <section className="card">
          <div className="stats">
            <Stat label="Field Staff" value={String(latest.fieldCount)} />
            <Stat label="Revenue / Field" value={money(latest.revenuePerFieldCents)} />
            <Stat label="Gross Profit / Field" value={money(latest.grossProfitPerFieldCents)} />
            {u.project && <Stat label="Project Crew Load" value={pct(u.project.trailing24AvgPct, 0)} sub={`peak ${u.project.peakYear} at ${pct(u.project.peakYearAvgPct, 0)}`} />}
            {u.maintenance && <Stat label="Maintenance Load" value={pct(u.maintenance.trailing12AvgPct, 0)} sub="last 12 months" />}
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-title">Productivity</div>
        <table className="table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Field Staff</th>
              <th className="num">Revenue / Field</th>
              <th className="num">Gross Profit / Field</th>
              <th className="num">Field Payroll</th>
              <th className="num">% of Revenue</th>
              {hasHours && <th className="num">Revenue / Hour</th>}
              {hasHours && <th className="num">Overtime</th>}
            </tr>
          </thead>
          <tbody>
            {data.years.map((y: any) => (
              <tr key={y.year}>
                <td className="cell-name">{y.year}</td>
                <td className="num">{y.fieldCount}</td>
                <td className="num">{money(y.revenuePerFieldCents)}</td>
                <td className="num">{money(y.grossProfitPerFieldCents)}</td>
                <td className="num">{y.fieldPayrollCents ? usd(y.fieldPayrollCents) : "—"}</td>
                <td className="num">{pct(y.payrollPctOfRevenue)}</td>
                {hasHours && <td className="num">{money(y.revenuePerHourCents)}</td>}
                {hasHours && <td className="num">{pct(y.overtimePct)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className={data.laborOverrunsByType.length ? "grid-2" : undefined}>
        <section className="card">
          <div className="card-title">Crews</div>
          {data.crews.length === 0 ? (
            <p className="empty">No crews.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Crew</th>
                  <th className="num">People</th>
                  <th className="num">Payroll</th>
                  {data.crews.some((c: any) => c.overtimePct !== null) && <th className="num">Overtime</th>}
                </tr>
              </thead>
              <tbody>
                {data.crews.map((c: any) => (
                  <tr key={c.name}>
                    <td className="cell-name">
                      {c.name}
                      <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                        {KIND[c.kind] ?? c.kind}
                      </div>
                    </td>
                    <td className="num">{c.headcount}</td>
                    <td className="num">{usd(c.payrollCents)}</td>
                    {data.crews.some((x: any) => x.overtimePct !== null) && <td className="num">{pct(c.overtimePct)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {data.laborOverrunsByType.length > 0 && (
          <section className="card">
            <div className="card-title">Labor vs Estimate</div>
            <table className="table">
              <thead>
                <tr>
                  <th>Job Type</th>
                  <th className="num">Jobs</th>
                  <th className="num">Variance</th>
                  <th className="num">Over 5%+</th>
                </tr>
              </thead>
              <tbody>
                {data.laborOverrunsByType.map((t: any) => (
                  <tr key={t.type}>
                    <td className="cell-name">{t.type}</td>
                    <td className="num">{t.jobs}</td>
                    <td className={`num${t.laborVariancePct > 3 ? " neg" : ""}`}>{signed(t.laborVariancePct)}</td>
                    <td className="num">{pct(t.overrunSharePct, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}

function LoadBar({ booked, pipeline }: { booked: number; pipeline: number }) {
  const scale = Math.max(100, booked + pipeline);
  return (
    <div className="load-bar" title={`${booked.toFixed(0)}% booked, ${(booked + pipeline).toFixed(0)}% with pipeline`}>
      <span className="load-booked" style={{ width: `${(booked / scale) * 100}%` }} />
      <span className="load-pipeline" style={{ width: `${(pipeline / scale) * 100}%` }} />
      <span className="load-ceiling" style={{ left: `${(100 / scale) * 100}%` }} />
    </div>
  );
}

const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function CapacityView({ data }: { data: any }) {
  const h = data.headroom;
  if (!h.bestYear) return <Empty what="Needs a full year of revenue and field staff." />;
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Revenue Ceiling" value={usd(h.ceilingCents)} sub={`${h.fieldCount} field staff at ${h.bestYear} pace`} />
          <Stat label="Last Year" value={usd(h.lastYearRevenueCents)} />
          <Stat label="Headroom" value={usd(h.headroomCents)} sub={`${pct(h.headroomPct, 0)} above last year`} tone={h.headroomCents > 0 ? "pos" : "neg"} />
        </div>
      </section>
      <section className="card">
        <div className="card-title">Next Six Months</div>
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Booked</th>
              <th className="num">Pipeline</th>
              <th style={{ width: "40%" }}>Load</th>
              <th className="num">Booked</th>
              <th className="num">If Pipeline Closes</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m: any) => (
              <tr key={m.period}>
                <td className="cell-name">{monthLabel(m.period)}</td>
                <td className="num">{usd(m.bookedCents)}</td>
                <td className="num">{usd(m.pipelineCents)}</td>
                <td>
                  <LoadBar booked={m.bookedPct ?? 0} pipeline={(m.withPipelinePct ?? 0) - (m.bookedPct ?? 0)} />
                </td>
                <td className="num">{pct(m.bookedPct, 0)}</td>
                <td className={`num${m.withPipelinePct > 100 ? " neg" : ""}`}>{pct(m.withPipelinePct, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function RecurringChart({ monthly }: { monthly: any[] }) {
  const segs = Object.keys(monthly[0]?.bySegment ?? {});
  const max = Math.max(...monthly.map((m) => m.totalCents), 1);
  const W = 720;
  const H = 160;
  const bw = W / monthly.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="mini-chart" role="img" aria-label="Recurring revenue by month">
      {monthly.map((m, i) => {
        let y = H;
        return (
          <g key={m.period}>
            {segs.map((s, si) => {
              const h = (m.bySegment[s] / max) * H;
              y -= h;
              return <rect key={s} x={i * bw + 2} y={y} width={bw - 4} height={h} className={si === 0 ? "bar-a" : "bar-b"} />;
            })}
            {i % 3 === 0 && (
              <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" className="chart-label">
                {m.period.slice(2)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function RecurringView({ data }: { data: any }) {
  if (!data) return <Empty what="No recurring revenue." />;
  const segs = Object.keys(data.monthly[0]?.bySegment ?? {});
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="MRR" value={usd(data.mrrCents)} sub={data.asOf} />
          <Stat label="Last 12 Months" value={usd(data.trailing12Cents)} />
          {data.activeContracts !== null && <Stat label="Active Contracts" value={String(data.activeContracts)} sub={`${usd(data.avgMonthlyContractCents)} avg / month`} />}
          {data.renewalPct !== null && <Stat label="Retention" value={pct(data.renewalPct)} sub={`${pct(data.churnPct)} churn`} />}
          {data.grossMarginPct !== null && <Stat label="Gross Margin" value={pct(data.grossMarginPct)} />}
          <Stat label="Seasonal Swing" value={pct(data.seasonalSwingPct, 0)} sub="peak to trough" />
        </div>
      </section>
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Monthly
          </div>
          {segs.length > 1 && (
            <span className="legend">
              <i className="bar-a" /> {segs[0]} <i className="bar-b" /> {segs.slice(1).join(", ")}
            </span>
          )}
        </div>
        <RecurringChart monthly={data.monthly} />
      </section>
      <section className="card">
        <div className="card-title">By Year</div>
        <table className="table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Recurring</th>
              <th className="num">Share of Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.annual.map((a: any) => (
              <tr key={a.year}>
                <td className="cell-name">{a.year}</td>
                <td className="num">{usd(a.cents)}</td>
                <td className="num">{pct(a.sharePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function ServiceCallsView({ data }: { data: any }) {
  if (!data) return <Empty what="No service-call detail." />;
  const latest = data.yearly.at(-1);
  const prior = data.yearly.at(-2);
  const callsChange = prior ? ((latest.calls - prior.calls) / prior.calls) * 100 : null;
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label={`Calls ${data.year}`} value={latest.calls.toLocaleString("en-US")} sub={callsChange !== null ? `${signed(callsChange)} vs ${prior.year}` : undefined} />
          <Stat label="Average Ticket" value={usd(latest.avgTicketCents)} />
          <Stat label="Revenue" value={usd(latest.revenueCents)} />
          {data.revenuePerTechCents !== null && <Stat label="Revenue / Tech" value={usd(data.revenuePerTechCents)} sub={`${data.techs} techs · ${data.callsPerTechPerWeek} calls / week`} />}
        </div>
      </section>
      <div className="grid-2">
        <section className="card">
          <div className="card-title">By Year</div>
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Calls</th>
                <th className="num">Avg Ticket</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.yearly.map((y: any) => (
                <tr key={y.year}>
                  <td className="cell-name">{y.year}</td>
                  <td className="num">{y.calls.toLocaleString("en-US")}</td>
                  <td className="num">{usd(y.avgTicketCents)}</td>
                  <td className="num">{usd(y.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <div className="card-title">By Call Type</div>
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">Calls</th>
                <th className="num">Avg Ticket</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((c: any) => (
                <tr key={`${c.segment}${c.category}`}>
                  <td className="cell-name">
                    {c.category}
                    <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                      {c.segment}
                    </div>
                  </td>
                  <td className="num">{c.calls.toLocaleString("en-US")}</td>
                  <td className="num">{usd(c.avgTicketCents)}</td>
                  <td className={`num${c.callsChangePct < 0 ? " neg" : ""}`}>{signed(c.callsChangePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function fmtMetric(v: number | null, unit: string) {
  if (v === null || v === undefined) return "—";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "days") return `${Math.round(v)}`;
  if (unit === "ratio") return `${v.toFixed(2)}x`;
  return usd(v);
}

export function BenchmarksView({ data }: { data: any }) {
  if (data.peers < data.minPeers) return <Empty what={`Needs ${data.minPeers} peer companies on DNRD; ${data.peers} so far.`} />;
  return (
    <section className="card">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Against {data.peers} Peers
        </div>
        <span className="muted" style={{ fontSize: 12 }} title="Other DNRD companies, anonymized. A metric shows only when three or more report it.">
          DNRD companies, anonymized
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">Yours</th>
            <th className="num">Peer Median</th>
            <th className="num">Top Quarter</th>
            <th style={{ width: "28%" }}>Ahead Of</th>
          </tr>
        </thead>
        <tbody>
          {data.metrics.map((m: any) => (
            <tr key={m.key}>
              <td className="cell-name">{m.label}</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {fmtMetric(m.yours, m.unit)}
              </td>
              <td className="num">{fmtMetric(m.median, m.unit)}</td>
              <td className="num">{fmtMetric(m.topQuartile, m.unit)}</td>
              <td>
                {m.rank === null ? (
                  <span className="muted">—</span>
                ) : (
                  <div className="aging-bar" style={{ margin: 0 }} title={`Ahead of ${m.rank}% of peers`}>
                    <span style={{ width: `${Math.max(m.rank, 3)}%`, background: m.rank >= 50 ? "var(--good)" : "var(--warn)" }} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
