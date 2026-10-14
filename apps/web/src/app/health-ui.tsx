import Link from "next/link";
import { usd, shortDate } from "./ui";

// Presentational only — no hooks — so both the server-rendered dashboard and
// the client pages can render the same trust surfaces.

const LEVEL_CLASS: Record<string, string> = { high: "good", medium: "warn", low: "bad" };

export function ConfidenceStrip({ health }: { health: any }) {
  const c = health.confidence;
  return (
    <div className="confidence-strip">
      <span className={`badge ${LEVEL_CLASS[c.level]}`}>{c.level} confidence</span>
      <span className="confidence-text">{c.headline}</span>
      {c.topGaps.length > 0 && (
        <Link href="/integrations" className="confidence-link">
          {c.topGaps.length} thing{c.topGaps.length === 1 ? "" : "s"} would raise it →
        </Link>
      )}
    </div>
  );
}

export function DataHealthCard({ health }: { health: any }) {
  const c = health.confidence;
  const sync = health.sync;
  return (
    <section className="card">
      <div className="card-title">Data Health</div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Forecast Confidence</div>
          <div className="stat-value num">{c.score}%</div>
          <div className="stat-sub">{c.headline}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Accounting Sync</div>
          <div className="stat-value num" style={{ fontSize: 20 }}>
            {!sync.connected
              ? "Not connected"
              : sync.lastStatus === "OK"
                ? sync.ageDays === 0
                  ? "Today"
                  : `${sync.ageDays}d ago`
                : "Failing"}
          </div>
          <div className="stat-sub">
            {sync.lastError
              ? sync.lastError.slice(0, 80)
              : sync.lastSuccessAt
                ? `last success ${shortDate(sync.lastSuccessAt)}`
                : "no successful sync yet"}
          </div>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Input</th>
            <th>State</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {c.checks.map((ck: any) => (
            <tr key={ck.key}>
              <td className="cell-name">{ck.label}</td>
              <td>
                <span
                  className={`badge ${ck.status === "good" ? "good" : ck.status === "partial" ? "warn" : "bad"}`}
                >
                  {ck.status === "good" ? "Solid" : ck.status === "partial" ? "Partial" : "Missing"}
                </span>
              </td>
              <td style={{ color: "var(--text-muted)" }}>
                {ck.detail}
                {ck.fix && (
                  <div style={{ color: "var(--accent)", marginTop: 4, fontSize: 12 }}>{ck.fix}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ReconciliationCard({ health }: { health: any }) {
  const r = health.reconciliation;
  const stale = r.ageDays === null || r.ageDays > 14;
  return (
    <section className="card">
      <div className="card-title">Reconciliation</div>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Starting Balance</div>
          <div className="stat-value num">{usd(r.bankBalanceCents)}</div>
          <div className="stat-sub">
            {r.asOf ? `${shortDate(r.asOf)} · ${r.source.toLowerCase()}` : "never set — using a placeholder"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Settled Since Then</div>
          <div className="stat-value num">
            {r.settledNetCents >= 0 ? "+" : "−"}
            {usd(Math.abs(r.settledNetCents))}
          </div>
          <div className="stat-sub">{r.settledSinceCount} transaction(s)</div>
        </div>
        <div className="stat">
          <div className="stat-label">Expected Bank Balance</div>
          <div className="stat-value num">{usd(r.expectedNowCents)}</div>
          
        </div>
      </div>

      {stale && (
        <div className="alert warning" style={{ marginTop: 16 }}>
          <div className="alert-title">
            {r.asOf
              ? `That balance is ${r.ageDays} days old. Refresh it before trusting the forecast.`
              : "No bank balance on file."}
          </div>
        </div>
      )}

      {r.entries.length > 0 && (
        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Settled</th>
              <th>What</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.entries.map((e: any, i: number) => (
              <tr key={i}>
                <td>{shortDate(e.date)}</td>
                <td style={{ color: "var(--text-muted)" }}>
                  {e.category.toLowerCase().replace(/_/g, " ")}
                </td>
                <td className="num" style={{ color: e.direction === "IN" ? "var(--good)" : undefined }}>
                  {e.direction === "IN" ? "+" : "−"}
                  {usd(e.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
