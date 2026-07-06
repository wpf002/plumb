const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4300";
const COMPANY = process.env.NEXT_PUBLIC_COMPANY_ID ?? "";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

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

  const [health, forecast, projects] = await Promise.all([
    get(`/companies/${COMPANY}/health`),
    get(`/companies/${COMPANY}/forecast?horizon=90`),
    get(`/companies/${COMPANY}/projects`),
  ]);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Plumb</h1>
      <p style={{ color: "#8b93a1", marginTop: 0 }}>
        Financial command center — 90-day view
      </p>

      <section style={card}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <div style={{ fontSize: 48, fontWeight: 700 }}>{health.score}</div>
          <div style={{ color: "#8b93a1" }}>business health / 100</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          {health.components.map((c: any) => (
            <div key={c.key} style={chip}>
              <div style={{ fontSize: 12, color: "#8b93a1" }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{c.score}</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{c.detail}</div>
            </div>
          ))}
        </div>
        {health.alerts.length > 0 && (
          <ul style={{ marginTop: 16, color: "#f0b429" }}>
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
          <p style={{ color: "#e5484d", marginBottom: 0 }}>
            Worst-case cash breaches your floor on {forecast.stress.firstBreachDate}.
          </p>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Projects — margin vs bid</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8b93a1", fontSize: 13 }}>
              <th style={th}>Project</th>
              <th style={th}>Bid %</th>
              <th style={th}>Projected %</th>
              <th style={th}>Eroded</th>
              <th style={th}>Overrun</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((row: any) => (
              <tr
                key={row.project.id}
                style={{ borderTop: "1px solid #1c2128" }}
              >
                <td style={td}>{row.project.name}</td>
                <td style={td}>{row.margin.originalMarginPct}%</td>
                <td style={{ ...td, color: row.margin.atRisk ? "#e5484d" : "#30a46c" }}>
                  {row.margin.projectedFinalMarginPct}%
                </td>
                <td style={td}>{row.margin.marginErosionPct} pts</td>
                <td style={td}>{usd(row.margin.costOverrunCents)}</td>
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
      <div style={{ fontSize: 12, color: "#8b93a1" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: warn ? "#e5484d" : "#e7e9ec" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>{sub}</div>
    </div>
  );
}

const card: any = { background: "#12151a", border: "1px solid #1c2128", borderRadius: 12, padding: 20, marginTop: 16 };
const chip: any = { background: "#0b0d10", border: "1px solid #1c2128", borderRadius: 8, padding: "8px 12px", minWidth: 120 };
const h2: any = { fontSize: 15, marginTop: 0, marginBottom: 12 };
const th: any = { padding: "6px 8px", fontWeight: 500 };
const td: any = { padding: "8px" };
