"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd, shortDate, C } from "../ui";

const PAYER_TYPES = ["GC", "OWNER_DIRECT", "PUBLIC_ENTITY"] as const;
const PAYER_TYPE_LABELS: Record<string, string> = {
  GC: "General contractor",
  OWNER_DIRECT: "Owner direct",
  PUBLIC_ENTITY: "Public entity",
};

// Open jobs with who pays them and the next billing date, plus each payer's
// observed lateness.
function marginBadge(m: any) {
  if (m.atRisk) return { cls: "bad", label: "At risk" };
  if (m.marginErosionPct > 0) return { cls: "warn", label: "Slipping" };
  return { cls: "good", label: "On track" };
}

export function PayersTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [payers, setPayers] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPayer, setNewPayer] = useState({ name: "", type: "GC", typicalDaysLate: "" });

  const load = useCallback(async () => {
    const id = getCompanyId();
    if (!id) return;
    const [jobs, ps] = await Promise.all([
      apiFetch(`/companies/${id}/projects`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : []
      ),
      apiFetch(`/companies/${id}/payers`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { payers: [] }
      ),
    ]);
    setRows(jobs);
    setPayers(ps.payers ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, method: string, payload?: any, label = "x") {
    setBusy(label);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      await load();
      return j;
    } catch (e: any) {
      setError(e.message ?? String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function observe(payerId: string) {
    setMsg(null);
    const r = await send(`/payers/${payerId}/observe`, "POST", undefined, payerId);
    if (r) setMsg(r.note);
  }

  async function addPayer() {
    const ok = await send("/payers", "POST", {
      name: newPayer.name,
      type: newPayer.type,
      typicalDaysLate: Number(newPayer.typicalDaysLate) || 0,
    });
    if (ok) {
      setNewPayer({ name: "", type: "GC", typicalDaysLate: "" });
      setAdding(false);
    }
  }

  if (!rows) {
    return <div className="card">Loading…</div>;
  }

  return (
    <>
      {(error || msg) && (
        <div className={`alert ${error ? "critical" : "good"}`} style={{ marginBottom: 16 }}>
          <div className="alert-title">{error ?? msg}</div>
        </div>
      )}

      <section className="card">
        {rows.length === 0 ? (
          <p className="empty">No open jobs.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Paid By</th>
                <th className="num">Contract</th>
                <th className="num">Margin (Bid → Now)</th>
                <th>Next Billing</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ project, margin, billing }) => {
                const b = marginBadge(margin);
                return (
                  <tr key={project.id}>
                    <td className="cell-name">
                      <Link href={`/projects/${project.id}`}>{project.name}</Link>
                      {billing?.totalSlipDays > 0 && (
                        <div style={{ fontSize: 12, color: C.danger, fontWeight: 400 }}>
                          {billing.totalSlipDays} days of billing slip
                        </div>
                      )}
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>
                      <select
                        className="input"
                        style={{ height: 34, padding: "4px 26px 4px 8px", fontSize: 14 }}
                        value={project.payerId ?? ""}
                        disabled={busy !== null}
                        onChange={(e) =>
                          send(
                            `/projects/${project.id}`,
                            "PUT",
                            { payerId: e.target.value || null },
                            project.id
                          )
                        }
                      >
                        <option value="">{project.client} (unassigned)</option>
                        {payers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {project.payerDaysLate > 0 && (
                        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>
                          pays {project.payerDaysLate} days past terms
                        </div>
                      )}
                    </td>
                    <td className="num">{usd(project.contractValueCents)}</td>
                    <td className="num">
                      {margin.originalMarginPct.toFixed(1)}% →{" "}
                      <b style={{ color: margin.marginErosionPct > 0 ? C.danger : C.good }}>
                        {margin.projectedFinalMarginPct.toFixed(1)}%
                      </b>
                      <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                        {usd(margin.adjustedContractCents - margin.projectedFinalCostCents)}{" "}
                        projected profit
                      </div>
                    </td>
                    <td>
                      {billing?.nextMilestone ? (
                        <>
                          {shortDate(billing.nextMilestone.expectedDate)}
                          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            {billing.nextMilestone.name} · {usd(billing.nextMilestone.amountCents)}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: "var(--text-faint)" }}>no schedule</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${b.cls}`}>{b.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Payer behaviour — the difference between contract terms and reality */}
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Who Pays You
          </div>
          <button className="btn btn-ghost btn-xs" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add Payer"}
          </button>
        </div>

        {adding && (
          <div className="inline-form">
            <div className="field-grid">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={newPayer.name}
                  onChange={(e) => setNewPayer((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Rogers-Healy GC"
                />
              </div>
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={newPayer.type}
                  onChange={(e) => setNewPayer((f) => ({ ...f, type: e.target.value }))}
                >
                  {PAYER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PAYER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Typically Days Late</label>
                <input
                  className="input num"
                  value={newPayer.typicalDaysLate}
                  onChange={(e) =>
                    setNewPayer((f) => ({ ...f, typicalDaysLate: e.target.value }))
                  }
                  inputMode="numeric"
                  placeholder="30"
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={busy !== null || !newPayer.name}
                onClick={addPayer}
              >
                Save Payer
              </button>
            </div>
          </div>
        )}

        {payers.length === 0 ? (
          <p className="empty">No payers.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Payer</th>
                <th>Type</th>
                <th className="num">Runs Late By</th>
                <th>Based On</th>
                <th className="num">Work In Their Hands</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payers.map((p) => (
                <tr key={p.id}>
                  <td className="cell-name">
                    {p.name}
                    {p.projects.length > 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-faint)", fontWeight: 400 }}>
                        {p.projects.map((j: any) => j.name).join(", ")}
                      </div>
                    )}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{PAYER_TYPE_LABELS[p.type]}</td>
                  <td className="num">
                    <b style={{ color: p.typicalDaysLate >= 30 ? C.danger : C.ink }}>
                      {p.typicalDaysLate} days
                    </b>
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>past terms</div>
                  </td>
                  <td>
                    {p.source === "OBSERVED" ? (
                      <span className="badge info">{p.sampleSize} paid invoices</span>
                    ) : (
                      <span className="badge neutral">Your estimate</span>
                    )}
                  </td>
                  <td className="num">{usd(p.exposureCents)}</td>
                  <td className="num">
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={busy !== null}
                      onClick={() => observe(p.id)}
                      title="Recompute from invoices this payer has already settled"
                    >
                      {busy === p.id ? "…" : "Use History"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
