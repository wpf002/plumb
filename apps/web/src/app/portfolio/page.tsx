"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, usd } from "../ui";

const ROWS: { key: string; label: string; total?: boolean }[] = [
  { key: "revenueCents", label: "Revenue" },
  { key: "cogsCents", label: "Direct Cost" },
  { key: "grossProfitCents", label: "Gross Profit", total: true },
  { key: "opexCents", label: "Overhead" },
  { key: "ebitdaCents", label: "EBITDA", total: true },
  { key: "netIncomeCents", label: "Net Income", total: true },
  { key: "cashCents", label: "Cash" },
  { key: "receivablesCents", label: "Receivables" },
  { key: "debtCents", label: "Debt" },
];

export default function Portfolio() {
  const [data, setData] = useState<any>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [report, setReport] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [elim, setElim] = useState({ label: "", amount: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/groups", { cache: "no-store" });
    const j = await r.json();
    setData(j);
    setGroupId((g) => g ?? j.groups[0]?.id ?? null);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const loadReport = useCallback(async () => {
    if (!groupId) return setReport(null);
    const r = await apiFetch(`/groups/${groupId}/consolidated${year ? `?year=${year}` : ""}`, { cache: "no-store" });
    setReport(r.ok ? await r.json() : null);
  }, [groupId, year]);
  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function create() {
    setError(null);
    const r = await apiFetch("/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, companyIds: picked }) });
    const j = await r.json();
    if (!r.ok) return setError(j.message ?? "Couldn't create the group.");
    setCreating(false);
    setName("");
    setPicked([]);
    setGroupId(j.id);
    load();
  }

  async function addElimination() {
    const amountCents = Math.round((Number(elim.amount.replace(/[$,]/g, "")) || 0) * 100);
    await apiFetch(`/groups/${groupId}/eliminations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: report.year, label: elim.label, amountCents }) });
    setElim({ label: "", amount: "" });
    loadReport();
  }

  if (!data) return <main className="container"><div className="card">Loading…</div></main>;

  return (
    <main className="container container-wide">
      <div className="page-head">
        <div>
          <h1>Portfolio</h1>
        </div>
        <div className="toolbar-right">
          {data.groups.length > 0 && (
            <select className="input input-sm" value={groupId ?? ""} onChange={(e) => { setGroupId(e.target.value); setYear(null); }}>
              {data.groups.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {report?.years?.length > 0 && (
            <select className="input input-sm" value={report.year ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
              {report.years.map((y: number) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-ghost btn-xs" onClick={() => setCreating((v) => !v)}>
            {creating ? "Cancel" : "New Group"}
          </button>
        </div>
      </div>

      {(creating || data.groups.length === 0) && (
        <section className="card">
          <div className="card-title">New Group</div>
          {data.companies.length < 2 ? (
            <p className="empty">Needs two companies you own or keep the books for.</p>
          ) : (
            <>
              <input className="input" placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              <div className="chips" style={{ margin: "12px 0" }}>
                {data.companies.map((c: any) => (
                  <button key={c.id} type="button" className={`chip${picked.includes(c.id) ? " active" : ""}`} onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>
                    {c.name}
                  </button>
                ))}
              </div>
              {error && <p className="neg">{error}</p>}
              <button className="btn btn-primary" disabled={!name.trim() || picked.length < 2} onClick={create}>
                Create Group
              </button>
            </>
          )}
        </section>
      )}

      {report?.total && (
        <>
          <section className="card">
            <div className="statement-scroll">
              <table className="table statement">
                <thead>
                  <tr>
                    <th>{report.year}</th>
                    {report.companies.map((c: any) => (
                      <th key={c.id} className="num">
                        {c.name}
                      </th>
                    ))}
                    {report.eliminations.length > 0 && <th className="num">Eliminations</th>}
                    <th className="num">Consolidated</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => {
                    const elimTotal = report.eliminations.reduce((s: number, e: any) => s + e.amountCents, 0);
                    const affected = r.key === "revenueCents" || r.key === "cogsCents";
                    return (
                      <tr key={r.key} className={r.total ? "statement-subtotal" : undefined}>
                        <td>{r.label}</td>
                        {report.companies.map((c: any) => (
                          <td key={c.id} className={`num${c[r.key] < 0 ? " neg" : ""}`}>
                            {usd(c[r.key])}
                          </td>
                        ))}
                        {report.eliminations.length > 0 && <td className="num">{affected ? usd(-elimTotal) : ""}</td>}
                        <td className={`num${report.total[r.key] < 0 ? " neg" : ""}`} style={{ fontWeight: 700 }}>
                          {usd(report.total[r.key])}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <div className="card-title">Intercompany Eliminations</div>
            {report.eliminations.map((e: any) => (
              <div key={e.id} className="customize-row">
                <span>{e.label}</span>
                <span className="num">{usd(e.amountCents)}</span>
              </div>
            ))}
            <div className="ask-row" style={{ marginTop: 8 }}>
              <input className="input" placeholder="Description" value={elim.label} onChange={(e) => setElim((x) => ({ ...x, label: e.target.value }))} />
              <input className="input num" style={{ maxWidth: 160 }} placeholder="Amount" inputMode="decimal" value={elim.amount} onChange={(e) => setElim((x) => ({ ...x, amount: e.target.value }))} />
              <button className="btn btn-primary" disabled={!elim.label || !elim.amount} onClick={addElimination}>
                Add
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
