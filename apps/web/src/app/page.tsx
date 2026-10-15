import Link from "next/link";
import { redirect } from "next/navigation";
import { usd, usdExact, shortDate, C } from "./ui";
import { apiGet, activeCompanyId } from "./server";
import { ConfidenceStrip } from "./health-ui";


const TONE: Record<string, string> = { good: "good", warn: "warn", bad: "bad", neutral: "neutral" };

function formatMetric(m: { value: number; unit: string }) {
  if (m.unit === "money") return usd(m.value);
  if (m.unit === "pct") return `${m.value.toFixed(1)}%`;
  if (m.unit === "ratio") return `${m.value.toFixed(2)}x`;
  return `${m.value.toFixed(1)} mo`;
}

const wipBadge: Record<string, string> = {
  OVERBILLED: "good",
  UNDERBILLED: "warn",
  ON_TRACK: "neutral",
};

export default async function Dashboard() {
  const companyId = activeCompanyId();
  if (!companyId) redirect("/login");

  const [forecast, projects, wip, digest, retainage, analysis, dataHealth, dash] = await Promise.all([
    apiGet(`/companies/${companyId}/forecast?horizon=90`),
    apiGet(`/companies/${companyId}/projects`),
    apiGet(`/companies/${companyId}/wip`),
    apiGet(`/companies/${companyId}/digest`),
    apiGet(`/companies/${companyId}/retainage`),
    apiGet(`/companies/${companyId}/analysis?horizon=90`),
    apiGet(`/companies/${companyId}/data-health`),
    apiGet(`/companies/${companyId}/health-dashboard`),
  ]);

  const attention = digest.digest.items.filter((i: any) => i.severity !== "good");

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
        </div>
      </div>

      {/* The read, in plain English, before any number. */}
      <section className="card readout">
        <div className="readout-head">
          <span className={`readout-dot ${dash.concerns[0]?.severity ?? analysis.concerns[0]?.severity ?? "good"}`} />
          <h2 className="readout-headline">{analysis.headline}</h2>
        </div>
        <p className="readout-summary">{analysis.summary}</p>
        {analysis.source === "claude" && analysis.concerns.length > 0 && (
          <ul className="readout-list">
            {analysis.concerns.map((c: any, i: number) => (
              <li key={i} className={`readout-item ${c.severity}`}>
                <b>{c.title}</b>
                {c.body && <span>{c.body}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="readout-foot">
          {analysis.source === "claude" ? "Written by Denny" : "Rule-based"}
          {analysis.fallbackReason && ` (${analysis.fallbackReason})`}
        </div>
        <ConfidenceStrip health={dataHealth} />
      </section>

      {/* Every health metric, each with the reading an owner acts on. */}
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Financial Health
          </div>
          <span className={`badge ${TONE[dash.position.tone]}`}>{dash.position.label}</span>
        </div>
        <div className="metric-columns">
          {dash.groups.map((g: any) => (
            <div key={g.key} className="metric-column">
              <div className="metric-column-title">{g.label}</div>
              {g.metrics
                .filter((m: any) => m.value !== null)
                .map((m: any) => (
                  <div key={m.key} className="metric-row" title={m.basis ?? undefined}>
                    <span className="metric-label">{m.label}</span>
                    <span className="metric-value num">{formatMetric(m)}</span>
                    {m.reading && <span className={`metric-reading ${m.reading.tone}`}>{m.reading.label}</span>}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>

      {/* What needs attention, worst first. */}
      <section className="card">
        <div className="card-title">Needs Attention</div>
        {dash.concerns.length === 0 && attention.length === 0 ? (
          <p className="empty">Nothing flagged.</p>
        ) : (
          <>
            {dash.concerns.map((c: any, i: number) => (
              <div key={`c${i}`} className={`alert ${c.severity}`}>
                <div>
                  <div className="alert-title">{c.title}</div>
                  <div className="alert-detail">{c.detail}</div>
                </div>
              </div>
            ))}
            {attention
              .filter((item: any) => !dash.concerns.some((c: any) => item.title.includes(c.title.split(" ")[0])))
              .filter((item: any) => /billing|renew|recurring|under-billed/i.test(item.title))
              .map((item: any, i: number) => (
                <div key={`d${i}`} className={`alert ${item.severity}`}>
                  <div>
                    <div className="alert-title">{item.title}</div>
                    {item.detail !== item.title && <div className="alert-detail">{item.detail}</div>}
                  </div>
                </div>
              ))}
          </>
        )}
      </section>

      {/* Cash */}
      <section className="card">
        <div className="card-title">Cash: Expected vs Worst Case</div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Expected Low</div>
            <div className="stat-value num">{usd(forecast.base.minBalanceCents)}</div>
            <div className="stat-sub">on {forecast.base.minBalanceDate}</div>
          </div>
          <div className="stat">
            <div className="stat-label">If Payers Run Late</div>
            <div
              className="stat-value num"
              style={{ color: forecast.stress.firstBreachDate ? C.danger : undefined }}
            >
              {usd(forecast.stress.minBalanceCents)}
            </div>
            <div className="stat-sub">on {forecast.stress.minBalanceDate}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Safety Floor</div>
            <div className="stat-value num">{usd(forecast.safetyThresholdCents)}</div>
            <div className="stat-sub">don&apos;t drop below</div>
          </div>
        </div>
        {forecast.stress.firstBreachDate && (
          <div className="alert critical" style={{ marginTop: 16 }}>
            <div className="alert-title">
              Worst case, cash drops below your floor on {forecast.stress.firstBreachDate}.
            </div>
          </div>
        )}
      </section>

      {analysis.collisions?.length > 0 && (
        <section className="card">
          <div className="card-title">Weeks Worth Watching</div>
          {analysis.collisions.map((c: any) => (
            <div key={c.weekStart} className="alert warning" style={{ marginBottom: 8 }}>
              <div style={{ width: "100%" }}>
                <div className="alert-title">
                  {shortDate(c.weekStart)} to {shortDate(c.weekEnd)}: {usd(c.outflowCents)} goes
                  out, and{" "}
                  {usd(c.atRiskInflowCents)} of what comes in is from a payer who runs late.
                </div>
                <div className="alert-detail">
                  If that money slips you finish the week at {usd(c.balanceIfLateCents)}.{" "}
                  {c.items
                    .map((i: any) => `${i.direction === "OUT" ? "−" : "+"}${usd(i.amountCents)} ${i.label}`)
                    .join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Fixed obligations — the nut before a single job cost */}
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Recurring Obligations
          </div>
          <Link href="/recurring" className="btn btn-ghost btn-xs">
            Manage
          </Link>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Every Month, No Matter What</div>
            <div className="stat-value num">{usd(forecast.obligations.monthlyFixedCents)}</div>
            <div className="stat-sub">overhead + debt service</div>
          </div>
          <div className="stat">
            <div className="stat-label">Overhead</div>
            <div className="stat-value num">{usd(forecast.obligations.monthlyOverheadCents)}</div>
            <div className="stat-sub">insurance, fuel, rent, software</div>
          </div>
          <div className="stat">
            <div className="stat-label">Debt Service</div>
            <div className="stat-value num">
              {usd(forecast.obligations.monthlyDebtServiceCents)}
            </div>
            <div className="stat-sub">
              <Link href="/balance-sheet">loans, cards, leases</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Projects */}
      <section className="card">
        <div className="card-title">Project Margins</div>
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th className="num">Bid %</th>
              <th className="num">Projected %</th>
              <th className="num">Eroded</th>
              <th className="num">Overrun</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((row: any) => (
              <tr key={row.project.id}>
                <td className="cell-name">
                  <Link
                    href={`/projects/${row.project.id}`}
                    style={{ color: "var(--ink)", textDecoration: "none" }}
                  >
                    {row.project.name}
                  </Link>
                </td>
                <td className="num">{row.margin.originalMarginPct}%</td>
                <td className="num" style={{ color: row.margin.atRisk ? C.danger : C.good, fontWeight: 500 }}>
                  {row.margin.projectedFinalMarginPct}%
                </td>
                <td className="num">{row.margin.marginErosionPct} pts</td>
                <td className="num">{usdExact(row.margin.costOverrunCents)}</td>
                <td>
                  <span className={`badge ${row.margin.atRisk ? "bad" : "good"}`}>
                    {row.margin.atRisk ? "At risk" : "On track"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* WIP */}
      <section className="card">
        <div className="card-title">Work In Progress</div>
        <p style={{ marginTop: -4, marginBottom: 16, color: "var(--text-muted)", fontSize: 14 }}>
          You&apos;ve billed{" "}
          <strong className={wip.netOverUnderCents >= 0 ? "pos" : "neg"}>
            {usdExact(Math.abs(wip.netOverUnderCents))}
          </strong>{" "}
          {wip.netOverUnderCents >= 0
            ? "ahead of the work done — clients are funding the job."
            : "behind the work done — you're funding the job out of pocket."}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th className="num">% Complete</th>
              <th className="num">Earned</th>
              <th className="num">Billed</th>
              <th className="num">Over / Under</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {wip.rows.map((r: any) => (
              <tr key={r.projectId}>
                <td className="cell-name">{r.name}</td>
                <td className="num">{Math.round(r.percentComplete * 100)}%</td>
                <td className="num">{usdExact(r.earnedRevenueCents)}</td>
                <td className="num">{usdExact(r.billedToDateCents)}</td>
                <td
                  className="num"
                  style={{ color: r.overUnderBillingCents >= 0 ? C.good : C.warn, fontWeight: 500 }}
                >
                  {usdExact(r.overUnderBillingCents)}
                </td>
                <td>
                  <span className={`badge ${wipBadge[r.state]}`}>{r.state.replace("_", " ")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Retainage */}
      <section className="card">
        <div className="card-title">Retainage Held</div>
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="stat-label">Total Held</div>
            <div className="stat-value num">{usd(retainage.totalHeldCents)}</div>
            <div className="stat-sub">earned</div>
          </div>
          <div className="stat">
            <div className="stat-label">Releasing Within 90 Days</div>
            <div className="stat-value num" style={{ color: C.good }}>
              {usd(retainage.releasingSoonCents)}
            </div>
            <div className="stat-sub">coming back to you</div>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th className="num">Rate</th>
              <th className="num">Held</th>
              <th>Projected Release</th>
            </tr>
          </thead>
          <tbody>
            {retainage.rows.map((r: any) => (
              <tr key={r.projectId}>
                <td className="cell-name">{r.projectName}</td>
                <td className="num">{r.retainagePct}%</td>
                <td className="num">{usdExact(r.retainageHeldCents)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.projectedReleaseDate}
                  <span
                    className={`badge ${r.releasesWithinHorizon ? "good" : "neutral"}`}
                    style={{ marginLeft: 16 }}
                  >
                    {r.releasesWithinHorizon ? "within 90d" : "later"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
