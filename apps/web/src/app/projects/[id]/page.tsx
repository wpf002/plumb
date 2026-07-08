"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, getCompanyId, usd, usdExact, C } from "../../ui";

const CATEGORIES = ["LABOR", "MATERIAL", "EQUIPMENT", "TRAVEL", "SUBCONTRACT", "OTHER"];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Invoice write-back
  const [billAmount, setBillAmount] = useState("");
  const [billMemo, setBillMemo] = useState("");
  const [billing, setBilling] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);

  // Change orders
  const [coContract, setCoContract] = useState("");
  const [coCost, setCoCost] = useState("");
  const [coReason, setCoReason] = useState("");
  const [coBusy, setCoBusy] = useState(false);

  // Phases / cost codes
  const [phaseName, setPhaseName] = useState("");
  const [phaseCode, setPhaseCode] = useState("");
  const [phaseBusy, setPhaseBusy] = useState(false);

  async function addPhase() {
    setPhaseBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/projects/${id}/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: phaseName, code: phaseCode || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setPhaseName("");
      setPhaseCode("");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setPhaseBusy(false);
    }
  }

  async function load() {
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/projects/${id}`, { cache: "no-store" });
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
    if (getCompanyId() && id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function createCO() {
    setCoBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/projects/${id}/change-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractDeltaCents: Math.round((Number(coContract) || 0) * 100),
          costDeltaCents: Math.round((Number(coCost) || 0) * 100),
          reason: coReason || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setCoContract("");
      setCoCost("");
      setCoReason("");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setCoBusy(false);
    }
  }

  async function decideCO(coId: string, action: "approve" | "reject") {
    setCoBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/change-orders/${coId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Failed (${res.status})`);
      }
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setCoBusy(false);
    }
  }

  async function bill() {
    setBilling(true);
    setInvoice(null);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/qbo/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id,
          amountCents: Math.round((Number(billAmount) || 0) * 100),
          memo: billMemo || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? `Failed (${res.status})`);
      setInvoice(json);
      if (json.live) await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBilling(false);
    }
  }

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
      const res = await apiFetch(`/companies/${getCompanyId()}/projects/${id}/budgets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Save failed (${res.status})`);
      }
      setMsg("Budgets saved. Variances updated.");
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
            <div className="stat-label">Projected Final Cost</div>
            <div className="stat-value num">{usd(margin.projectedFinalCostCents)}</div>
            <div className="stat-sub">{Math.round(margin.percentComplete * 100)}% complete</div>
          </div>
          <div className="stat">
            <div className="stat-label">Bid → Projected Margin</div>
            <div className="stat-value num" style={{ color: margin.atRisk ? C.red : C.green }}>
              {margin.originalMarginPct}% → {margin.projectedFinalMarginPct}%
            </div>
            <div className="stat-sub">{margin.marginErosionPct} pts off your {project.targetMarginPct}% target</div>
          </div>
          <div className="stat">
            <div className="stat-label">Cost Overrun</div>
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
        <div className="card-title">Budget vs Actual</div>
        <p style={{ marginTop: -6, marginBottom: 16, color: "var(--muted)", fontSize: 13.5 }}>
          Set a budget per cost code. Anything over budget shows here and flags the job as at risk.
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
            {saving ? "Saving…" : "Save Budgets"}
          </button>
          {msg && <span className="pos" style={{ fontSize: 13.5 }}>{msg}</span>}
          {error && <span className="neg" style={{ fontSize: 13.5 }}>{error}</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-title">Phases &amp; Cost Codes</div>
        <p style={{ marginTop: -6, marginBottom: 16, color: "var(--muted)", fontSize: 13.5 }}>
          Break the job into phases (cost codes) to see budget vs actual at the level you estimate.
        </p>
        {data.phases && data.phases.length > 0 ? (
          <table className="table" style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th>Phase</th>
                <th className="num">Code</th>
                <th className="num">Budget</th>
                <th className="num">Actual</th>
                <th className="num">Hours</th>
                <th className="num">Variance</th>
              </tr>
            </thead>
            <tbody>
              {data.phases.map((ph: any) => (
                <tr key={ph.id}>
                  <td className="cell-name">{ph.name}</td>
                  <td className="num" style={{ color: "var(--muted)" }}>{ph.code ?? "—"}</td>
                  <td className="num">{usdExact(ph.budgetedCostCents)}</td>
                  <td className="num">{usdExact(ph.actualCostCents)}</td>
                  <td className="num">{ph.laborHours || "—"}</td>
                  <td className="num" style={{ color: ph.budgetedCostCents === 0 ? "var(--faint)" : ph.varianceCents > 0 ? C.red : C.green, fontWeight: 600 }}>
                    {ph.budgetedCostCents === 0 ? "no budget" : usdExact(ph.varianceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "var(--faint)", fontSize: 13.5, marginTop: 0 }}>No phases yet.</p>
        )}
        {data.unphasedCostCents > 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -6, marginBottom: 16 }}>
            {usdExact(data.unphasedCostCents)} of costs are not yet assigned to a phase.
          </p>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="label">Phase name</label>
            <input className="input" value={phaseName} onChange={(e) => setPhaseName(e.target.value)} placeholder="Trim-out" />
          </div>
          <div>
            <label className="label">Cost code</label>
            <input className="input num" style={{ maxWidth: 130 }} value={phaseCode} onChange={(e) => setPhaseCode(e.target.value)} placeholder="16-200" />
          </div>
          <button className="btn btn-ghost" disabled={phaseBusy || !phaseName} onClick={addPhase}>
            {phaseBusy ? "…" : "Add Phase"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-title">Change Orders</div>
        <p style={{ marginTop: -6, marginBottom: 16, color: "var(--muted)", fontSize: 13.5 }}>
          Only <strong>approved</strong> change orders move the contract and budget. Pending ones don&apos;t count yet.
        </p>

        {data.changeOrders && data.changeOrders.length > 0 ? (
          <table className="table" style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th>Reason</th>
                <th className="num">Contract Δ</th>
                <th className="num">Cost Δ</th>
                <th className="num">Margin Δ</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.changeOrders.map((co: any) => {
                const badge =
                  co.status === "APPROVED" ? "good" : co.status === "REJECTED" ? "neutral" : "warn";
                return (
                  <tr key={co.id}>
                    <td className="cell-name">{co.reason ?? "—"}</td>
                    <td className="num">{usdExact(co.contractDeltaCents)}</td>
                    <td className="num">{usdExact(co.costDeltaCents)}</td>
                    <td className="num" style={{ color: co.marginImpactCents >= 0 ? C.green : C.red, fontWeight: 600 }}>
                      {usdExact(co.marginImpactCents)}
                    </td>
                    <td>
                      <span className={`badge ${badge}`}>{co.status}</span>
                    </td>
                    <td>
                      {co.status === "PENDING" && (
                        <span style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 13 }} disabled={coBusy} onClick={() => decideCO(co.id, "approve")}>
                            Approve
                          </button>
                          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 13 }} disabled={coBusy} onClick={() => decideCO(co.id, "reject")}>
                            Reject
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "var(--faint)", fontSize: 13.5, marginTop: 0 }}>No change orders yet.</p>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <div>
            <label className="label">Contract Δ ($)</label>
            <input className="input num" style={{ maxWidth: 130 }} value={coContract} onChange={(e) => setCoContract(e.target.value)} inputMode="decimal" placeholder="60000" />
          </div>
          <div>
            <label className="label">Cost Δ ($)</label>
            <input className="input num" style={{ maxWidth: 130 }} value={coCost} onChange={(e) => setCoCost(e.target.value)} inputMode="decimal" placeholder="40000" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="label">Reason</label>
            <input className="input" value={coReason} onChange={(e) => setCoReason(e.target.value)} placeholder="Added panel upgrade" />
          </div>
          <button className="btn btn-ghost" disabled={coBusy || (!coContract && !coCost)} onClick={createCO}>
            {coBusy ? "…" : "Add Change Order"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-title">Bill A Milestone</div>
        <p style={{ marginTop: -6, marginBottom: 16, color: "var(--muted)", fontSize: 13.5 }}>
          Create a progress invoice in QuickBooks and move your billed-to-date up.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="label">Amount ($)</label>
            <input
              className="input num"
              style={{ maxWidth: 160 }}
              value={billAmount}
              onChange={(e) => setBillAmount(e.target.value)}
              inputMode="decimal"
              placeholder="75000"
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="label">Memo</label>
            <input
              className="input"
              value={billMemo}
              onChange={(e) => setBillMemo(e.target.value)}
              placeholder="Rough-in milestone 3"
            />
          </div>
          <button className="btn btn-primary" onClick={bill} disabled={billing || !billAmount}>
            {billing ? "Creating…" : "Create Invoice"}
          </button>
        </div>

        {invoice && (
          <div className={`alert ${invoice.live ? "good" : "warning"}`} style={{ marginTop: 16 }}>
            <div style={{ width: "100%" }}>
              <div className="alert-title">
                {invoice.live ? `Invoice ${invoice.qboInvoiceId} created in QuickBooks` : "Dry run, no QuickBooks connection"}
              </div>
              <div className="alert-detail">{invoice.note}</div>
              <pre
                style={{
                  marginTop: 10,
                  marginBottom: 0,
                  fontSize: 12,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 12,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(invoice.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
