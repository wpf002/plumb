"use client";

import { useState } from "react";
import { apiFetch, getCompanyId, usd, C } from "../ui";

type MonthRow = { month: string; hours: string };

const recStyle: Record<string, { bg: string; label: string }> = {
  BID_AGGRESSIVE: { bg: C.green, label: "Bid aggressive" },
  BID_NORMAL: { bg: C.orange, label: "Bid normal" },
  BID_SELECTIVE: { bg: C.amber, label: "Bid selective" },
  PASS: { bg: C.red, label: "Pass" },
};

const loadBadge: Record<string, string> = {
  UNDERBOOKED: "warn",
  HEALTHY: "good",
  TIGHT: "info",
  OVEREXTENDED: "bad",
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
      for (const r of rows) if (r.month) laborHoursByMonth[r.month] = Number(r.hours) || 0;
      const body = {
        contractValueCents: Math.round(Number(contract) * 100),
        estCostCents: Math.round(Number(cost) * 100),
        targetMarginPct: Number(margin),
        laborHoursByMonth,
      };
      const res = await apiFetch(`/companies/${getCompanyId()}/bid`, {
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
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Should You Bid This Job?</h1>
          <p>Weighed against your committed crew, worst-case cash, and how recent jobs have run.</p>
        </div>
      </div>

      <section className="card">
        <div className="card-title">The Job</div>
        <div className="field-grid">
          <div>
            <label className="label">Contract value ($)</label>
            <input className="input num" value={contract} onChange={(e) => setContract(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label className="label">Estimated cost ($)</label>
            <input className="input num" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label className="label">Target margin (%)</label>
            <input className="input num" value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" />
          </div>
        </div>

        <div className="divider" />

        <div className="label">Labor Hours By Month</div>
        {rows.map((r, i) => (
          <div key={i} className="row">
            <input
              className="input"
              style={{ maxWidth: 180 }}
              type="month"
              value={r.month}
              onChange={(e) => setRow(i, { month: e.target.value })}
            />
            <input
              className="input num"
              style={{ maxWidth: 140 }}
              value={r.hours}
              onChange={(e) => setRow(i, { hours: e.target.value })}
              inputMode="numeric"
              placeholder="hours"
            />
            <button className="icon-btn" onClick={() => removeRow(i)} aria-label="remove month">
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={addRow} style={{ padding: "8px 14px" }}>
          + Add Month
        </button>

        <div style={{ marginTop: 22 }}>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? "Evaluating…" : "Evaluate Bid"}
          </button>
        </div>
        {error && <p className="neg" style={{ marginBottom: 0 }}>{error}</p>}
      </section>

      {result && rec && (
        <section className="card">
          <div className="card-title">Recommendation</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span className="rec-badge" style={{ background: rec.bg }}>
              {rec.label}
            </span>
            <span style={{ color: "var(--muted)" }}>
              Bid margin <strong className="num" style={{ color: "var(--navy)" }}>{result.bidMarginPct}%</strong>{" "}
              ({result.marginVsTargetPct >= 0 ? "+" : ""}
              {result.marginVsTargetPct} pts vs target) · Cash headroom{" "}
              <strong className="num" style={{ color: "var(--navy)" }}>{usd(result.cashHeadroomCents)}</strong>
            </span>
          </div>

          <div className="divider" />
          <div className="card-title">Crew Load If You Win</div>
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Capacity</th>
                <th className="num">Committed</th>
                <th className="num">This bid</th>
                <th className="num">Utilization</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {result.monthLoads.map((m: any) => (
                <tr key={m.month}>
                  <td className="cell-name">{m.month}</td>
                  <td className="num">{m.capacityHours}h</td>
                  <td className="num">{m.committedHours}h</td>
                  <td className="num">{m.bidHours}h</td>
                  <td className="num">{Math.round(m.utilizationIfWon * 100)}%</td>
                  <td>
                    <span className={`badge ${loadBadge[m.state]}`}>{m.state}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="divider" />
          <div className="card-title">Why</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, color: "var(--ink)" }}>
            {result.reasons.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
