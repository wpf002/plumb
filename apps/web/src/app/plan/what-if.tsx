"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, readGated, usd } from "../ui";
import { Locked } from "../plan-ui";

const toCents = (s: string) => Math.round((Number(s.replace(/[$,]/g, "")) || 0) * 100);

type Kind = "revenue_change" | "lose_customer" | "exit_line" | "grow_line" | "materials" | "add_pm" | "add_location" | "payment_delay";

const KINDS: { key: Kind; label: string }[] = [
  { key: "revenue_change", label: "Revenue Change" },
  { key: "lose_customer", label: "Lose a Customer" },
  { key: "materials", label: "Materials Up" },
  { key: "exit_line", label: "Exit a Line" },
  { key: "grow_line", label: "Grow a Line" },
  { key: "add_pm", label: "Add a PM" },
  { key: "add_location", label: "Add a Location" },
  { key: "payment_delay", label: "Late Payments" },
];

type Input = { key: string; label: string; unit: "$" | "%" | "days" | "mo" };

const INPUTS: Record<Kind, Input[]> = {
  revenue_change: [{ key: "pct", label: "Change", unit: "%" }],
  lose_customer: [
    { key: "pct", label: "Share Lost", unit: "%" },
    { key: "contributionMarginPct", label: "Contribution Margin", unit: "%" },
  ],
  exit_line: [{ key: "contributionMarginPct", label: "Contribution Margin", unit: "%" }],
  grow_line: [
    { key: "pct", label: "Growth", unit: "%" },
    { key: "contributionMarginPct", label: "Contribution Margin", unit: "%" },
  ],
  materials: [{ key: "pct", label: "Increase", unit: "%" }],
  add_pm: [
    { key: "annualSalaryCents", label: "Salary", unit: "$" },
    { key: "burdenPct", label: "Burden", unit: "%" },
    { key: "revenueLiftPct", label: "Revenue Lift", unit: "%" },
  ],
  add_location: [
    { key: "annualFixedCostCents", label: "Fixed Cost / Year", unit: "$" },
    { key: "startupCostCents", label: "Startup Cost", unit: "$" },
    { key: "financedPct", label: "Financed", unit: "%" },
    { key: "ratePct", label: "Rate", unit: "%" },
    { key: "termMonths", label: "Term", unit: "mo" },
    { key: "year1RevenueCents", label: "Year 1 Revenue", unit: "$" },
  ],
  payment_delay: [
    { key: "amountCents", label: "Amount Late", unit: "$" },
    { key: "days", label: "Days Late", unit: "days" },
  ],
};

const DEFAULTS: Record<string, string> = {
  pct: "25",
  annualSalaryCents: "85000",
  burdenPct: "20",
  revenueLiftPct: "0",
  annualFixedCostCents: "180000",
  startupCostCents: "120000",
  financedPct: "70",
  ratePct: "8",
  termMonths: "60",
  year1RevenueCents: "400000",
  amountCents: "100000",
  days: "30",
};

const ROWS: { key: string; label: string; pct?: boolean }[] = [
  { key: "revenueCents", label: "Revenue" },
  { key: "grossProfitCents", label: "Gross Profit" },
  { key: "ebitdaCents", label: "EBITDA" },
  { key: "netIncomeCents", label: "Net Income" },
  { key: "cashCents", label: "Cash" },
  { key: "debtCents", label: "Debt" },
  { key: "workingCapitalCents", label: "Working Capital" },
  { key: "capacityUsedPct", label: "Crew Capacity Used", pct: true },
  { key: "enterpriseValueCents", label: "Business Value" },
];

function fmt(v: number | null, isPct?: boolean) {
  if (v === null || v === undefined) return "—";
  return isPct ? `${v.toFixed(1)}%` : usd(v);
}

export function WhatIf() {
  const [opts, setOpts] = useState<any>(null);
  const [kind, setKind] = useState<Kind>("revenue_change");
  const [v, setV] = useState<Record<string, string>>({ ...DEFAULTS, pct: "-15" });
  const [pick, setPick] = useState<{ customer: string; line: string }>({ customer: "", line: "" });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/companies/${getCompanyId()}/what-if/options`, { cache: "no-store" })
      .then(readGated)
      .then((o) => {
        setOpts(o);
        if (o && !o.__locked) {
          setPick({ customer: o.customers[0]?.name ?? "", line: o.lines[0] ?? "" });
          setV((p) => ({ ...p, contributionMarginPct: o.grossMarginPct?.toFixed(1) ?? "30" }));
        }
      });
  }, []);

  const body: Record<string, any> = { kind };
  for (const i of INPUTS[kind]) {
    const raw = v[i.key];
    if (raw === undefined || raw.trim() === "") continue;
    body[i.key] = i.unit === "$" ? toCents(raw) : Number(raw);
  }
  if (kind === "lose_customer") body.customer = pick.customer;
  if (kind === "exit_line" || kind === "grow_line") body.line = pick.line;
  const key = JSON.stringify(body);

  useEffect(() => {
    if (!opts) return;
    const t = setTimeout(async () => {
      const res = await apiFetch(`/companies/${getCompanyId()}/what-if`, { method: "POST", headers: { "Content-Type": "application/json" }, body: key });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(j);
        setError(null);
      } else {
        setResult(null);
        setError(j.message ?? "Check the inputs.");
      }
    }, 300);
    return () => clearTimeout(t);
  }, [key, opts]);

  if (!opts) return <div className="card">Loading…</div>;
  if (opts.__locked) return <Locked info={opts.__locked} />;
  if (!opts.year) return <p className="card empty">Needs a full year of books.</p>;

  return (
    <>
      <section className="card">
        <div className="chips">
          {KINDS.map((k) => (
            <button
              key={k.key}
              className={`chip${k.key === kind ? " active" : ""}`}
              onClick={() => {
                setKind(k.key);
                setV((p) => ({ ...p, pct: k.key === "revenue_change" ? "-15" : DEFAULTS.pct }));
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="field-grid" style={{ marginTop: 16 }}>
          {kind === "lose_customer" && (
            <div>
              <label className="label">Customer</label>
              <select className="input" value={pick.customer} onChange={(e) => setPick((p) => ({ ...p, customer: e.target.value }))}>
                {opts.customers.map((c: any) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.sharePct.toFixed(1)}%)
                  </option>
                ))}
              </select>
            </div>
          )}
          {(kind === "exit_line" || kind === "grow_line") && (
            <div>
              <label className="label">Service Line</label>
              <select className="input" value={pick.line} onChange={(e) => setPick((p) => ({ ...p, line: e.target.value }))}>
                {opts.lines.map((l: string) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
          {INPUTS[kind].map((i) => (
            <div key={i.key}>
              <label className="label">
                {i.label} <span className="muted">({i.unit})</span>
              </label>
              <input className="input num" inputMode="decimal" value={v[i.key] ?? ""} onChange={(e) => setV((p) => ({ ...p, [i.key]: e.target.value }))} />
            </div>
          ))}
        </div>
        {error && <p className="neg">{error}</p>}
      </section>

      {result && kind === "payment_delay" && (
        <section className="card">
          <div className="stats">
            <div className="stat">
              <div className="stat-label">13-Week Low</div>
              <div className={`stat-value num${result.minCashCents < result.reserveTargetCents ? " neg" : ""}`}>{usd(result.minCashCents)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Reserve</div>
              <div className="stat-value num">{usd(result.reserveTargetCents)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Credit Line</div>
              <div className={`stat-value num${result.locDrawRequired ? " neg" : " pos"}`}>{result.locDrawRequired ? `Draw ${usd(result.peakLocCents)}` : "Not Needed"}</div>
            </div>
          </div>
        </section>
      )}

      {result && kind !== "payment_delay" && (
        <section className="card">
          <div className="row-between">
            <div className="card-title" style={{ marginBottom: 0 }}>
              Impact on {result.year}
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th className="num">Actual</th>
                <th className="num">Scenario</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const d = result.delta[r.key];
                return (
                  <tr key={r.key}>
                    <td className="cell-name">{r.label}</td>
                    <td className="num">{fmt(result.base[r.key], r.pct)}</td>
                    <td className="num">{fmt(result.after[r.key], r.pct)}</td>
                    <td className={`num${d < 0 && r.key !== "debtCents" ? " neg" : d > 0 && r.key !== "debtCents" ? " pos" : ""}`}>
                      {d === null ? "—" : `${d > 0 ? "+" : ""}${fmt(d, r.pct)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
