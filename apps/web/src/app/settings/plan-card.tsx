"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId } from "../ui";

/** Which tier this company is on. Switching changes features only; there is no billing yet. */
export function PlanCard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/companies/${getCompanyId()}/plan`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  async function choose(plan: string) {
    setError(null);
    const r = await apiFetch(`/companies/${getCompanyId()}/plan`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
    const j = await r.json();
    if (!r.ok) return setError(j.message ?? "Only owners can change the plan.");
    setData(j);
  }

  if (!data) return null;
  const limit = (v: number | null, unit: string) => (v === null ? `Unlimited ${unit}` : `${v} ${unit}`);
  return (
    <section className="card" id="plan">
      <div className="card-title">Plan</div>
      <div className="plan-grid">
        {data.plans.map((p: any) => {
          const included = data.catalog.filter((f: any) => f.plan === p.key);
          return (
            <div key={p.key} className={`plan-option${p.key === data.plan ? " active" : ""}`}>
              <div className="row-between">
                <b>{p.label}</b>
                {p.key === data.plan ? <span className="badge good">Current</span> : <button className="btn btn-ghost btn-xs" onClick={() => choose(p.key)}>Switch</button>}
              </div>
              <div className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                {limit(p.limits.seats, "people")} · {limit(p.limits.dennyPerMonth, "Ask Denny questions / month")}
              </div>
              <ul className="plan-features">
                {p.key === "ESSENTIALS" ? <li>Statements, cash, AR/AP, debt, assets, job profitability, customers, health score, CSV import</li> : included.map((f: any) => <li key={f.key}>{f.label}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        This month: {data.usage.denny} Ask Denny questions · {data.usage.seats} people
      </div>
      {error && <p className="neg">{error}</p>}
    </section>
  );
}
