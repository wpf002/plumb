import Link from "next/link";
import { redirect } from "next/navigation";
import { usd, shortDate, C } from "./ui";
import { apiGet, activeCompanyId } from "./server";
import { ConfidenceStrip } from "./health-ui";
import { AskDenny } from "./ask-denny";


const TONE: Record<string, string> = { good: "good", warn: "warn", bad: "bad", neutral: "neutral" };
const RATING_BADGE: Record<string, string> = { Strong: "good", Stable: "info", Watch: "warn", "At Risk": "bad" };
const RATING_TONE: Record<string, string> = { Strong: "", Stable: "", Watch: "warning", "At Risk": "critical" };

function formatMetric(m: { value: number; unit: string }) {
  if (m.unit === "money") return usd(m.value);
  if (m.unit === "pct") return `${m.value.toFixed(1)}%`;
  if (m.unit === "ratio") return `${m.value.toFixed(2)}x`;
  return `${m.value.toFixed(1)} mo`;
}

export default async function Dashboard() {
  const companyId = activeCompanyId();
  if (!companyId) redirect("/login");

  const [forecast, digest, brief, dataHealth, dash, analysis] = await Promise.all([
    apiGet(`/companies/${companyId}/forecast?horizon=90`),
    apiGet(`/companies/${companyId}/digest`),
    apiGet(`/companies/${companyId}/brief`),
    apiGet(`/companies/${companyId}/data-health`),
    apiGet(`/companies/${companyId}/health-dashboard`),
    apiGet(`/companies/${companyId}/collisions`),
  ]);

  const attention = digest.digest.items.filter((i: any) => i.severity !== "good");

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
        </div>
      </div>

      {/* The brief: rating, the standing lines, what stands out, what to do. */}
      <section className={`card readout ${RATING_TONE[brief.rating]}`}>
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Weekly Brief
          </div>
          <span className={`badge ${RATING_BADGE[brief.rating]}`}>{brief.rating}</span>
        </div>
        <ul className="brief-lines">
          {brief.lines.map((l: any) => (
            <li key={l.key} className={`brief-line ${l.tone}`}>
              {l.text}
            </li>
          ))}
        </ul>
        {brief.findings.length > 0 && (
          <ul className="readout-list">
            {brief.findings.map((f: any) => (
              <li key={f.key} className={`readout-item ${f.tone === "bad" ? "critical" : f.tone === "warn" ? "warning" : "good"}`}>
                <b>{f.text}</b>
              </li>
            ))}
          </ul>
        )}
        {brief.actions.length > 0 && (
          <>
            <div className="card-title" style={{ marginTop: 16 }}>
              Recommended Actions
            </div>
            <ol className="action-list">
              {brief.actions.map((a: any) => (
                <li key={a.key}>{a.text}</li>
              ))}
            </ol>
          </>
        )}
        <ConfidenceStrip health={dataHealth} />
      </section>

      <AskDenny />

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
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Needs Attention
          </div>
          <Link href="/digest" className="btn btn-ghost btn-xs">
            Weekly Digest
          </Link>
        </div>
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
            Fixed Obligations
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

    </main>
  );
}
