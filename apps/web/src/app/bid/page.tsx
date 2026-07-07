"use client";

import { useState } from "react";
import { API, COMPANY, usd, colors, card, h2, th, td } from "../ui";

type MonthRow = { month: string; hours: string };

const recStyle: Record<string, { color: string; label: string }> = {
  BID_AGGRESSIVE: { color: colors.good, label: "Bid aggressive" },
  BID_NORMAL: { color: colors.accent, label: "Bid normal" },
  BID_SELECTIVE: { color: colors.warn, label: "Bid selective" },
  PASS: { color: colors.bad, label: "Pass" },
};

const loadColor: Record<string, string> = {
  UNDERBOOKED: colors.warn,
  HEALTHY: colors.good,
  TIGHT: colors.accent,
  OVEREXTENDED: colors.bad,
};

function nextMonths(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 1; i <= count; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const input: React.CSSProperties = {
  background: colors.bg,
  border: `1px solid ${colors.line}`,
  borderRadius: 8,
  padding: "8px 10px",
  color: colors.text,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 12, color: colors.muted, display: "block", marginBottom: 4 };

export default function BidPage() {
  const [contract, setContract] = useState("950000");
  const [cost, setCost] = useState("800000");
  const [margin, setMargin] = useState("14");
  const [rows, setRows] = useState<MonthRow[]>(
    nextMonths(2).map((month) => ({ month, hours: "300" }))
  );
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setRow = (i: number, patch: Partial<MonthRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { month: nextMonths(rs.length + 1).at(-1)!, hours: "0" }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  async function submit() {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const laborHoursByMonth: Record<string, number> = {};
      for (const r of rows) {
        if (r.month) laborHoursByMonth[r.month] = Number(r.hours) || 0;
      }
      const body = {
        contractValueCents: Math.round(Number(contract) * 100),
        estCostCents: Math.round(Number(cost) * 100),
        targetMarginPct: Number(margin),
        laborHoursByMonth,
      };
      const res = await fetch(`${API}/companies/${COMPANY}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? `Request failed (${res.status})`);
      setResult(json);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  const rec = result ? recStyle[result.recommendation] : null;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Should I bid this job?</h1>
      <p style={{ color: colors.muted, marginTop: 0 }}>
        Scored against your committed crew, worst-case cash, and recent margin trend.
      </p>

      {!COMPANY && (
        <p style={{ color: colors.warn }}>
          Set <code>NEXT_PUBLIC_COMPANY_ID</code> and reload.
        </p>
      )}

      <section style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          <div>
            <label style={label}>Contract value ($)</label>
            <input style={input} value={contract} onChange={(e) => setContract(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label style={label}>Estimated cost ($)</label>
            <input style={input} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label style={label}>Target margin (%)</label>
            <input style={input} value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" />
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={label}>Labor hours by month</label>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input
                style={{ ...input, width: 160 }}
                type="month"
                value={r.month}
                onChange={(e) => setRow(i, { month: e.target.value })}
              />
              <input
                style={{ ...input, width: 120 }}
                value={r.hours}
                onChange={(e) => setRow(i, { hours: e.target.value })}
                inputMode="numeric"
                placeholder="hours"
              />
              <button onClick={() => removeRow(i)} style={ghostBtn} aria-label="remove month">
                ×
              </button>
            </div>
          ))}
          <button onClick={addRow} style={ghostBtn}>
            + add month
          </button>
        </div>

        <button onClick={submit} disabled={loading} style={{ ...primaryBtn, marginTop: 20 }}>
          {loading ? "Evaluating…" : "Evaluate bid"}
        </button>
        {error && <p style={{ color: colors.bad }}>{error}</p>}
      </section>

      {result && rec && (
        <section style={card}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: rec.color,
                border: `1px solid ${rec.color}`,
                borderRadius: 8,
                padding: "6px 14px",
              }}
            >
              {rec.label}
            </span>
            <span style={{ color: colors.muted }}>
              Bid margin {result.bidMarginPct}% ({result.marginVsTargetPct >= 0 ? "+" : ""}
              {result.marginVsTargetPct} pts vs target)
            </span>
            <span style={{ color: colors.muted }}>
              Cash headroom {usd(result.cashHeadroomCents)}
            </span>
          </div>

          <h2 style={{ ...h2, marginTop: 20 }}>Crew load if you win</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: colors.muted, fontSize: 13 }}>
                <th style={th}>Month</th>
                <th style={th}>Capacity</th>
                <th style={th}>Committed</th>
                <th style={th}>This bid</th>
                <th style={th}>Utilization</th>
                <th style={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {result.monthLoads.map((m: any) => (
                <tr key={m.month} style={{ borderTop: `1px solid ${colors.line}` }}>
                  <td style={td}>{m.month}</td>
                  <td style={td}>{m.capacityHours}h</td>
                  <td style={td}>{m.committedHours}h</td>
                  <td style={td}>{m.bidHours}h</td>
                  <td style={td}>{Math.round(m.utilizationIfWon * 100)}%</td>
                  <td style={{ ...td, color: loadColor[m.state] }}>{m.state}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ ...h2, marginTop: 20 }}>Why</h2>
          <ul style={{ marginTop: 0, color: colors.text, lineHeight: 1.6 }}>
            {result.reasons.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

const primaryBtn: React.CSSProperties = {
  background: colors.accent,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent",
  color: colors.muted,
  border: `1px solid ${colors.line}`,
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};
