import { API, COMPANY, usd, colors, card, chip, h2, th, td } from "./ui";

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const wipColor: Record<string, string> = {
  OVERBILLED: colors.good,
  UNDERBILLED: colors.warn,
  ON_TRACK: colors.muted,
};

export default async function Dashboard() {
  if (!COMPANY) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Plumb</h1>
        <p>
          Set <code>NEXT_PUBLIC_COMPANY_ID</code> (printed by the seed script) and
          reload.
        </p>
      </main>
    );
  }

  const [health, forecast, projects, wip] = await Promise.all([
    get(`/companies/${COMPANY}/health`),
    get(`/companies/${COMPANY}/forecast?horizon=90`),
    get(`/companies/${COMPANY}/projects`),
    get(`/companies/${COMPANY}/wip`),
  ]);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 32 }}>
      <p style={{ color: colors.muted, marginTop: 0 }}>
        Financial command center — 90-day view
      </p>

      <section style={card}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <div style={{ fontSize: 48, fontWeight: 700 }}>{health.score}</div>
          <div style={{ color: colors.muted }}>business health / 100</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          {health.components.map((c: any) => (
            <div key={c.key} style={chip}>
              <div style={{ fontSize: 12, color: colors.muted }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{c.score}</div>
              <div style={{ fontSize: 11, color: colors.faint }}>{c.detail}</div>
            </div>
          ))}
        </div>
        {health.alerts.length > 0 && (
          <ul style={{ marginTop: 16, color: colors.warn }}>
            {health.alerts.map((a: string, i: number) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Cash — worst case vs expected</h2>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Stat label="Expected low" value={usd(forecast.base.minBalanceCents)} sub={forecast.base.minBalanceDate} />
          <Stat
            label="Worst-case low (30d late)"
            value={usd(forecast.stress.minBalanceCents)}
            sub={forecast.stress.minBalanceDate}
            warn={forecast.stress.firstBreachDate}
          />
          <Stat label="Safety threshold" value={usd(forecast.safetyThresholdCents)} sub="floor" />
        </div>
        {forecast.stress.firstBreachDate && (
          <p style={{ color: colors.bad, marginBottom: 0 }}>
            Worst-case cash breaches your floor on {forecast.stress.firstBreachDate}.
          </p>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Projects — margin vs bid</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.muted, fontSize: 13 }}>
              <th style={th}>Project</th>
              <th style={th}>Bid %</th>
              <th style={th}>Projected %</th>
              <th style={th}>Eroded</th>
              <th style={th}>Overrun</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((row: any) => (
              <tr key={row.project.id} style={{ borderTop: `1px solid ${colors.line}` }}>
                <td style={td}>{row.project.name}</td>
                <td style={td}>{row.margin.originalMarginPct}%</td>
                <td style={{ ...td, color: row.margin.atRisk ? colors.bad : colors.good }}>
                  {row.margin.projectedFinalMarginPct}%
                </td>
                <td style={td}>{row.margin.marginErosionPct} pts</td>
                <td style={td}>{usd(row.margin.costOverrunCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h2 style={h2}>WIP — over / under-billing</h2>
        <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
          Net working-capital position:{" "}
          <strong style={{ color: wip.netOverUnderCents >= 0 ? colors.good : colors.warn }}>
            {usd(wip.netOverUnderCents)}
          </strong>{" "}
          {wip.netOverUnderCents >= 0
            ? "(clients are financing you)"
            : "(you're financing the work)"}
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.muted, fontSize: 13 }}>
              <th style={th}>Project</th>
              <th style={th}>% Complete</th>
              <th style={th}>Earned</th>
              <th style={th}>Billed</th>
              <th style={th}>Over / under</th>
              <th style={th}>State</th>
            </tr>
          </thead>
          <tbody>
            {wip.rows.map((r: any) => (
              <tr key={r.projectId} style={{ borderTop: `1px solid ${colors.line}` }}>
                <td style={td}>{r.name}</td>
                <td style={td}>{Math.round(r.percentComplete * 100)}%</td>
                <td style={td}>{usd(r.earnedRevenueCents)}</td>
                <td style={td}>{usd(r.billedToDateCents)}</td>
                <td style={{ ...td, color: wipColor[r.state] }}>{usd(r.overUnderBillingCents)}</td>
                <td style={{ ...td, color: wipColor[r.state] }}>{r.state.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, warn }: any) {
  return (
    <div>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: warn ? colors.bad : colors.text }}>{value}</div>
      <div style={{ fontSize: 12, color: colors.faint }}>{sub}</div>
    </div>
  );
}
