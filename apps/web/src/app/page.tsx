import Link from "next/link";
import { redirect } from "next/navigation";
import { usd, usdExact, scoreColor, C } from "./ui";
import { apiGet, activeCompanyId } from "./server";

function ScoreRing({ score }: { score: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, score)) / 100);
  const col = scoreColor(score);
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} fill="none" stroke={C.line} strokeWidth="12" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={col}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={off}
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="68" textAnchor="middle" className="ring-label" fontSize="38">
        {score}
      </text>
      <text x="70" y="90" textAnchor="middle" className="ring-sub" fontSize="12">
        of 100
      </text>
    </svg>
  );
}

const wipBadge: Record<string, string> = {
  OVERBILLED: "good",
  UNDERBILLED: "warn",
  ON_TRACK: "neutral",
};

export default async function Dashboard() {
  const companyId = activeCompanyId();
  if (!companyId) redirect("/login");

  const [health, forecast, projects, wip, digest, retainage] = await Promise.all([
    apiGet(`/companies/${companyId}/health`),
    apiGet(`/companies/${companyId}/forecast?horizon=90`),
    apiGet(`/companies/${companyId}/projects`),
    apiGet(`/companies/${companyId}/wip`),
    apiGet(`/companies/${companyId}/digest`),
    apiGet(`/companies/${companyId}/retainage`),
  ]);

  const attention = digest.digest.items.filter((i: any) => i.severity !== "good");

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Your cash, margins, and workload over the next 90 days.</p>
        </div>
      </div>

      {/* Health hero */}
      <section className="card">
        <div className="hero">
          <ScoreRing score={health.score} />
          <div style={{ width: "100%" }}>
            <div className="card-title" style={{ marginBottom: 12 }}>
              Business Health
            </div>
            <div className="kpis">
              {health.components.map((c: any) => (
                <div key={c.key} className="kpi">
                  <div className="kpi-label">{c.label}</div>
                  <div className="kpi-value num">{c.score}</div>
                  <div className="kpi-detail">{c.detail}</div>
                  <div className="kpi-bar">
                    <span style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Needs attention */}
      <section className="card">
        <div className="card-title">Needs Attention</div>
        {attention.length === 0 ? (
          <div className="alert good">
            <div>
              <div className="alert-title">Nothing needs your attention this week</div>
              <div className="alert-detail">Cash, margins, crew load, and receivables are all in range.</div>
            </div>
          </div>
        ) : (
          attention.map((item: any, i: number) => (
            <div key={i} className={`alert ${item.severity}`}>
              <div>
                <div className="alert-title">{item.title}</div>
                {item.detail !== item.title && <div className="alert-detail">{item.detail}</div>}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Cash */}
      <section className="card">
        <div className="card-title">Cash: Expected vs Worst Case</div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Expected low</div>
            <div className="stat-value num">{usd(forecast.base.minBalanceCents)}</div>
            <div className="stat-sub">{forecast.base.minBalanceDate}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Worst case, if payers run 30 days late</div>
            <div
              className="stat-value num"
              style={{ color: forecast.stress.firstBreachDate ? C.red : undefined }}
            >
              {usd(forecast.stress.minBalanceCents)}
            </div>
            <div className="stat-sub">{forecast.stress.minBalanceDate}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Safety threshold</div>
            <div className="stat-value num">{usd(forecast.safetyThresholdCents)}</div>
            <div className="stat-sub">your floor</div>
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
                    style={{ color: "var(--navy)", textDecoration: "none" }}
                  >
                    {row.project.name}
                  </Link>
                </td>
                <td className="num">{row.margin.originalMarginPct}%</td>
                <td className="num" style={{ color: row.margin.atRisk ? C.red : C.green, fontWeight: 600 }}>
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
        <p style={{ marginTop: -6, marginBottom: 16, color: "var(--muted)", fontSize: 13.5 }}>
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
              <th className="num">Over / under</th>
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
                  style={{ color: r.overUnderBillingCents >= 0 ? C.green : C.amber, fontWeight: 600 }}
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
        <div className="stats" style={{ marginBottom: 18 }}>
          <div className="stat">
            <div className="stat-label">Total held</div>
            <div className="stat-value num">{usd(retainage.totalHeldCents)}</div>
            <div className="stat-sub">earned, not yet collectible</div>
          </div>
          <div className="stat">
            <div className="stat-label">Releasing within 90 days</div>
            <div className="stat-value num" style={{ color: C.green }}>
              {usd(retainage.releasingSoonCents)}
            </div>
            <div className="stat-sub">coming back into cash</div>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th className="num">Rate</th>
              <th className="num">Held</th>
              <th>Projected release</th>
            </tr>
          </thead>
          <tbody>
            {retainage.rows.map((r: any) => (
              <tr key={r.projectId}>
                <td className="cell-name">{r.projectName}</td>
                <td className="num">{r.retainagePct}%</td>
                <td className="num">{usdExact(r.retainageHeldCents)}</td>
                <td>
                  {r.projectedReleaseDate}{" "}
                  <span className={`badge ${r.releasesWithinHorizon ? "good" : "neutral"}`}>
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
