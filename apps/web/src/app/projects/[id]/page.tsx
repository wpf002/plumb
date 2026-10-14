"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, getCompanyId, usd, usdExact, shortDate, dateInput, centsFrom, C } from "../../ui";

const CATEGORIES = ["LABOR", "MATERIAL", "EQUIPMENT", "TRAVEL", "SUBCONTRACT", "OTHER"];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Invoice write-back
  const [billing, setBilling] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);

  // Billing schedule
  const [ms, setMs] = useState<any>(null);
  const [ripple, setRipple] = useState<any>(null);
  const [msBusy, setMsBusy] = useState<string | null>(null);
  const [genCount, setGenCount] = useState("5");
  const [addingMs, setAddingMs] = useState(false);
  const [newMs, setNewMs] = useState({ name: "", date: dateInput(new Date()), amount: "" });

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
      const [res, msRes] = await Promise.all([
        apiFetch(`/companies/${getCompanyId()}/projects/${id}`, { cache: "no-store" }),
        apiFetch(`/companies/${getCompanyId()}/projects/${id}/milestones`, { cache: "no-store" }),
      ]);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = await res.json();
      setData(json);
      if (msRes.ok) setMs(await msRes.json());
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

  // Bill a milestone: the amount comes from the contract schedule, and on a live
  // connection the milestone flips to BILLED with its QBO invoice id attached.
  async function bill(milestoneId: string) {
    setBilling(true);
    setInvoice(null);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/qbo/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, milestoneId }),
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

  async function msSend(path: string, method: string, payload?: any, label = "ms") {
    setMsBusy(label);
    setError(null);
    try {
      const res = await apiFetch(
        `/companies/${getCompanyId()}/projects/${id}/milestones${path}`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `Failed (${res.status})`);
      await load();
      return json;
    } catch (e: any) {
      setError(e.message ?? String(e));
      return null;
    } finally {
      setMsBusy(null);
    }
  }

  // Pushing a date is not a note field: the API recomputes cash before and
  // after so the owner sees what the delay actually did.
  async function pushDate(milestoneId: string, shiftDays: number) {
    setRipple(null);
    const r = await msSend(`/${milestoneId}/date`, "PATCH", { shiftDays }, milestoneId);
    if (r) setRipple(r);
  }

  async function addMilestone() {
    const ok = await msSend("", "POST", {
      name: newMs.name,
      expectedDate: new Date(newMs.date).toISOString(),
      amountCents: centsFrom(newMs.amount),
    });
    if (ok) {
      setNewMs({ name: "", date: dateInput(new Date()), amount: "" });
      setAddingMs(false);
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
          <Link href="/" className="navlink" style={{ color: "var(--accent)" }}>
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
            <Link href="/" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
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
            <div className="stat-value num" style={{ color: margin.atRisk ? C.danger : C.good }}>
              {margin.originalMarginPct}% → {margin.projectedFinalMarginPct}%
            </div>
            <div className="stat-sub">{margin.marginErosionPct} pts off your {project.targetMarginPct}% target</div>
          </div>
          <div className="stat">
            <div className="stat-label">Cost Overrun</div>
            <div
              className="stat-value num"
              style={{ color: margin.costOverrunCents > 0 ? C.danger : C.good }}
            >
              {usd(margin.costOverrunCents)}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-title">Budget vs Actual</div>
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
                  <td className="num" style={{ color: v ? (over ? C.danger : C.good) : "var(--text-faint)", fontWeight: 500 }}>
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
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Budgets"}
          </button>
          {msg && <span className="pos" style={{ fontSize: 14 }}>{msg}</span>}
          {error && <span className="neg" style={{ fontSize: 14 }}>{error}</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-title">Phases &amp; Cost Codes</div>
        {data.phases && data.phases.length > 0 ? (
          <table className="table" style={{ marginBottom: 16 }}>
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
                  <td className="num" style={{ color: "var(--text-muted)" }}>{ph.code ?? "—"}</td>
                  <td className="num">{usdExact(ph.budgetedCostCents)}</td>
                  <td className="num">{usdExact(ph.actualCostCents)}</td>
                  <td className="num">{ph.laborHours || "—"}</td>
                  <td className="num" style={{ color: ph.budgetedCostCents === 0 ? "var(--text-faint)" : ph.varianceCents > 0 ? C.danger : C.good, fontWeight: 500 }}>
                    {ph.budgetedCostCents === 0 ? "no budget" : usdExact(ph.varianceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "var(--text-faint)", fontSize: 14, marginTop: 0 }}>No phases yet.</p>
        )}
        {data.unphasedCostCents > 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: -4, marginBottom: 16 }}>
            {usdExact(data.unphasedCostCents)} of costs are not yet assigned to a phase.
          </p>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="label">Phase Name</label>
            <input className="input" value={phaseName} onChange={(e) => setPhaseName(e.target.value)} placeholder="Trim-out" />
          </div>
          <div>
            <label className="label">Cost Code</label>
            <input className="input num" style={{ maxWidth: 130 }} value={phaseCode} onChange={(e) => setPhaseCode(e.target.value)} placeholder="16-200" />
          </div>
          <button className="btn btn-ghost" disabled={phaseBusy || !phaseName} onClick={addPhase}>
            {phaseBusy ? "…" : "Add Phase"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-title">Change Orders</div>

        {data.changeOrders && data.changeOrders.length > 0 ? (
          <table className="table" style={{ marginBottom: 16 }}>
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
                    <td className="num" style={{ color: co.marginImpactCents >= 0 ? C.good : C.danger, fontWeight: 500 }}>
                      {usdExact(co.marginImpactCents)}
                    </td>
                    <td>
                      <span className={`badge ${badge}`}>{co.status}</span>
                    </td>
                    <td>
                      {co.status === "PENDING" && (
                        <span style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 14 }} disabled={coBusy} onClick={() => decideCO(co.id, "approve")}>
                            Approve
                          </button>
                          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 14 }} disabled={coBusy} onClick={() => decideCO(co.id, "reject")}>
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
          <p style={{ color: "var(--text-faint)", fontSize: 14, marginTop: 0 }}>No change orders yet.</p>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
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

      {/* Billing schedule — what the contract lets you invoice, and when */}
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Billing Schedule
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-ghost btn-xs" onClick={() => setAddingMs((v) => !v)}>
              {addingMs ? "Cancel" : "Add Milestone"}
            </button>
            <input
              className="input num"
              style={{ width: 62, height: 32, padding: "4px 8px" }}
              value={genCount}
              onChange={(e) => setGenCount(e.target.value)}
              inputMode="numeric"
              aria-label="Number of milestones to draft"
            />
            <button
              className="btn btn-ghost btn-xs"
              disabled={msBusy !== null}
              onClick={() =>
                msSend("/generate", "POST", { count: Number(genCount) || 5, replace: true }, "gen")
              }
            >
              {msBusy === "gen" ? "Drafting…" : "Draft Schedule"}
            </button>
          </div>
        </div>

        {ms?.summary && (
          <div className="stats" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-label">Scheduled</div>
              <div className="stat-value num">{usd(ms.summary.scheduledCents)}</div>
              <div className="stat-sub">
                {ms.summary.unscheduledCents === 0
                  ? "covers the full contract"
                  : `${usd(ms.summary.unscheduledCents)} of contract unscheduled`}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Still To Bill</div>
              <div className="stat-value num">{usd(ms.summary.unbilledCents)}</div>
              <div className="stat-sub">{ms.summary.count} milestones</div>
            </div>
            <div className="stat">
              <div className="stat-label">Retainage Held Back</div>
              <div className="stat-value num">{usd(ms.summary.retainageHeldCents)}</div>
              <div className="stat-sub">released at completion</div>
            </div>
            <div className="stat">
              <div className="stat-label">Slip</div>
              <div className={`stat-value num ${ms.summary.totalSlipDays > 0 ? "neg" : ""}`}>
                {ms.summary.totalSlipDays > 0 ? `+${ms.summary.totalSlipDays}d` : "None"}
              </div>
              <div className="stat-sub">
                {ms.summary.slippedCount > 0
                  ? `${ms.summary.slippedCount} milestone(s) moved`
                  : "on the original dates"}
              </div>
            </div>
          </div>
        )}

        {addingMs && (
          <div className="inline-form">
            <div className="field-grid">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={newMs.name}
                  onChange={(e) => setNewMs((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Switchgear set & energized"
                />
              </div>
              <div>
                <label className="label">Expected Date</label>
                <input
                  className="input"
                  type="date"
                  value={newMs.date}
                  onChange={(e) => setNewMs((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Amount ($)</label>
                <input
                  className="input num"
                  value={newMs.amount}
                  onChange={(e) => setNewMs((f) => ({ ...f, amount: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={msBusy !== null || !newMs.name || !newMs.amount}
                onClick={addMilestone}
              >
                Save Milestone
              </button>
            </div>
          </div>
        )}

        {ripple && (
          <div
            className={`alert ${ripple.delta.breachAppeared ? "critical" : ripple.delta.minBalanceCents < 0 ? "warning" : "good"}`}
            style={{ marginBottom: 16 }}
          >
            <div style={{ width: "100%" }}>
              <div className="alert-title">
                {ripple.milestone.name} moved to {shortDate(ripple.milestone.expectedDate)}.
              </div>
              <div className="alert-detail">
                {ripple.delta.minBalanceCents === 0 && !ripple.delta.minBalanceDateMoved
                  ? "Your cash low point didn't change."
                  : `Your low point ${
                      ripple.delta.minBalanceDateMoved
                        ? `moves from ${shortDate(ripple.before.minBalanceDate)} to ${shortDate(
                            ripple.after.minBalanceDate
                          )}`
                        : `stays on ${shortDate(ripple.after.minBalanceDate)}`
                    } and goes ${ripple.delta.minBalanceCents < 0 ? "down" : "up"} ${usd(
                      Math.abs(ripple.delta.minBalanceCents)
                    )}, to ${usd(ripple.after.minBalanceCents)}.`}
                {ripple.delta.breachAppeared &&
                  " That now puts you under your cash safety floor."}
                {ripple.delta.breachCleared && " That clears your safety-floor breach."}
              </div>
            </div>
          </div>
        )}

        {!ms || ms.milestones.length === 0 ? (
          <p className="empty">No billing schedule.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Milestone</th>
                <th>Expected</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ms.milestones.map((m: any) => (
                <tr key={m.id}>
                  <td style={{ color: "var(--text-faint)" }}>{m.sequence}</td>
                  <td className="cell-name">{m.name}</td>
                  <td>
                    {shortDate(m.expectedDate)}
                    {m.slipDays !== 0 && (
                      <div style={{ fontSize: 12, color: m.slipDays > 0 ? C.danger : C.good }}>
                        {m.slipDays > 0 ? `+${m.slipDays}d` : `${m.slipDays}d`} vs original
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {usd(m.amountCents)}
                    {m.retainagePct > 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                        {usd(Math.round((m.amountCents * (100 - m.retainagePct)) / 100))} after
                        retainage
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        m.status === "PAID" ? "good" : m.status === "BILLED" ? "info" : "neutral"
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {(m.status === "PLANNED" || m.status === "READY") && (
                      <>
                        <button
                          className="btn btn-ghost btn-xs"
                          disabled={msBusy !== null}
                          onClick={() => pushDate(m.id, 14)}
                          title="Push this milestone two weeks and see what it does to cash"
                        >
                          Push 2 Wks
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          disabled={msBusy !== null}
                          onClick={() => pushDate(m.id, -14)}
                        >
                          Pull In
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          disabled={billing}
                          onClick={() => bill(m.id)}
                        >
                          {billing ? "…" : "Bill It"}
                        </button>
                      </>
                    )}
                    {m.status === "BILLED" && (
                      <button
                        className="btn btn-ghost btn-xs"
                        disabled={msBusy !== null}
                        onClick={() => msSend(`/${m.id}`, "PUT", { status: "PAID" }, m.id)}
                      >
                        Mark Paid
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={msBusy !== null}
                      onClick={() => msSend(`/${m.id}`, "DELETE", undefined, m.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {invoice && (
          <div className={`alert ${invoice.live ? "good" : "warning"}`} style={{ marginTop: 16 }}>
            <div style={{ width: "100%" }}>
              <div className="alert-title">
                {invoice.live
                  ? `Invoice ${invoice.qboInvoiceId} created in QuickBooks`
                  : "Dry run — no QuickBooks connection, nothing was changed"}
              </div>
              <div className="alert-detail">
                {invoice.note}
                {invoice.netOfRetainageCents !== null &&
                  ` Expect ${usd(invoice.netOfRetainageCents)} in the bank after retainage.`}
              </div>
              <pre
                style={{
                  marginTop: 8,
                  marginBottom: 0,
                  fontSize: 12,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
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
