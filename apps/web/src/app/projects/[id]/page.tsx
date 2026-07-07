"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API, COMPANY, usd, usdExact, C } from "../../ui";

const CATEGORIES = ["LABOR", "MATERIAL", "EQUIPMENT", "TRAVEL", "SUBCONTRACT", "OTHER"];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`${API}/companies/${COMPANY}/projects/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = await res.json();
      setData(json);
      const b: Record<string, string> = {};
      for (const cat of CATEGORIES) b[cat] = "0";
      for (const line of json.budgets) b[line.category] = String(Math.round(line.budgetedCostCents / 100));
      setBudgets(b);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  useEffect(() => {
    if (COMPANY && id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const payload = {
        budgets: CATEGORIES.map((category) => ({
          category,
          budgetedCostCents: Math.round((Number(budgets[category]) || 0) * 100),
        })).filter((b) => b.budgetedCostCents > 0),
      };
      const res = await fetch(`${API}/companies/${COMPANY}/projects/${id}/budgets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Save failed (${res.status})`);
      }
      setMsg("Budgets saved — variances updated.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) {
    return (
      <main className="container">
        <div className="card">
          <p className="neg">{error}</p>
          <Link href="/" className="navlink" style={{ color: "var(--orange)" }}>
            ← Back to dashboard
          </Link>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }

  const { project, margin } = data;
  const actualByCat: Record<string, number> = margin.byCategoryCents;
  const varianceByCat: Record<string, any> = {};
  for (const v of margin.variances) varianceByCat[v.category] = v;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <div style={{ marginBottom: 8 }}>
            <Link href="/" style={{ color: "var(--orange)", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              ← Dashboard
            </Link>
          </div>
          <h1>{project.name}</h1>
          <p>
            {project.client} · {project.clientType === "OWNER_DIRECT" ? "Owner-direct" : "Through GC"} ·{" "}
            {project.billingType.replace(/_/g, " ")}
          </p>
        </div>
        <span className={`badge ${margin.atRisk ? "bad" : "good"}`}>
          {margin.atRisk ? "Margin at risk" : "On track"}
        </span>
      </div>

      <section className="card">
        <div className="card-title">Margin</div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Contract</div>
            <div className="stat-value num">{usd(margin.adjustedContractCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Projected final cost</div>
            <div className="stat-value num">{usd(margin.projectedFinalCostCents)}</div>
            <div className="stat-sub">{Math.round(margin.percentComplete * 100)}% complete</div>
          </div>
          <div className="stat">
            <div className="stat-label">Bid → projected margin</div>
            <div className="stat-value num" style={{ color: margin.atRisk ? C.red : C.green }}>
              {margin.originalMarginPct}% → {margin.projectedFinalMarginPct}%
            </div>
            <div className="stat-sub">{margin.marginErosionPct} pts eroded · target {project.targetMarginPct}%</div>
          </div>
          <div className="stat">
            <div className="stat-label">Cost overrun</div>
            <div
              className="stat-value num"
              style={{ color: margin.costOverrunCents > 0 ? C.red : C.green }}
            >
              {usd(margin.costOverrunCents)}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-title">Budget vs actual by cost code</div>
        <p style={{ marginTop: -6, marginBottom: 16, color: "var(--muted)", fontSize: 13.5 }}>
          Set a budget per category. Anything over shows up here and drives the margin-at-risk flag.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Budget ($)</th>
              <th className="num">Actual</th>
              <th className="num">Variance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => {
              const actual = actualByCat[cat] ?? 0;
              const v = varianceByCat[cat];
              const over = v && v.varianceCents > 0;
              return (
                <tr key={cat}>
                  <td className="cell-name">{cat}</td>
                  <td className="num">
                    <input
                      className="input num"
                      style={{ maxWidth: 140, textAlign: "right", marginLeft: "auto" }}
                      value={budgets[cat] ?? "0"}
                      onChange={(e) => setBudgets((b) => ({ ...b, [cat]: e.target.value }))}
                      inputMode="numeric"
                    />
                  </td>
                  <td className="num">{usdExact(actual)}</td>
                  <td className="num" style={{ color: v ? (over ? C.red : C.green) : "var(--faint)", fontWeight: 600 }}>
                    {v ? usdExact(v.varianceCents) : "—"}
                  </td>
                  <td>
                    {v ? (
                      <span className={`badge ${over ? "bad" : "good"}`}>
                        {over ? `Over ${v.variancePct}%` : "Under"}
                      </span>
                    ) : (
                      <span className="badge neutral">No budget</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 14 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save budgets"}
          </button>
          {msg && <span className="pos" style={{ fontSize: 13.5 }}>{msg}</span>}
          {error && <span className="neg" style={{ fontSize: 13.5 }}>{error}</span>}
        </div>
      </section>
    </main>
  );
}
