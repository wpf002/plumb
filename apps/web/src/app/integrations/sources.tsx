"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch, getCompanyId, shortDate } from "../ui";

const CATEGORY: Record<string, string> = {
  accounting: "Accounting",
  banking: "Banking",
  payments: "Payments",
  payroll: "Payroll",
  time: "Time Tracking",
  field_service: "Field Service",
  construction: "Construction",
  estimating: "Estimating",
  fleet: "Fleet",
  crm: "CRM",
};

const KIND: Record<string, string> = {
  customers: "Customers",
  vendors: "Vendors",
  invoices: "Invoices",
  payments: "Payments",
  bills: "Bills",
  accounts: "Accounts",
  transactions: "Transactions",
  payroll: "Payroll Months",
  jobs: "Jobs",
  timeEntries: "Time Entries",
  opportunities: "Opportunities",
  vehicles: "Vehicles",
};

/** Every outside system, with a preview of what it brings in and a sync once connected. */
export function DataSources() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await apiFetch(`/companies/${getCompanyId()}/sources`, { cache: "no-store" });
    setData(r.ok ? await r.json() : null);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(key: string, action: "preview" | "sync") {
    setBusy(`${key}:${action}`);
    setMsg(null);
    const r = await apiFetch(`/companies/${getCompanyId()}/sources/${key}/${action}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setMsg(j.message ?? "Failed.");
    if (action === "preview") {
      setPreview((p) => ({ ...p, [key]: j }));
      setOpen(key);
    } else {
      setMsg(`Synced ${Object.entries(j.counts).map(([k, v]) => `${v} ${(KIND[k] ?? k).toLowerCase()}`).join(", ") || "nothing new"}.`);
      load();
    }
  }

  async function connect(key: string, fields: string[]) {
    const credentials = Object.fromEntries(fields.map((f) => [f, creds[`${key}.${f}`] ?? ""]).filter(([, v]) => v));
    const r = await apiFetch(`/companies/${getCompanyId()}/sources/${key}/connection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Connected." : j.message ?? "Couldn't connect.");
    load();
  }

  if (!data) return null;
  const phases = [1, 2, 3].filter((p) => data.sources.some((s: any) => s.phase === p));

  return (
    <section className="card">
      <div className="card-title">Sources</div>
      {msg && <p className="muted">{msg}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Brings In</th>
            <th>Status</th>
            <th className="num"></th>
          </tr>
        </thead>
        <tbody>
          {phases.map((phase) => (
            <Fragment key={phase}>
              {data.sources
                .filter((s: any) => s.phase === phase)
                .map((s: any) => {
                  const p = preview[s.key];
                  const fields: string[] = s.credentialFields;
                  return (
                    <Fragment key={s.key}>
                      <tr>
                        <td className="cell-name">
                          {s.name}
                        </td>
                        <td className="muted" style={{ fontSize: 14 }}>
                          {s.provides.map((k: string) => KIND[k] ?? k).join(", ")}
                        </td>
                        <td>
                          {s.live ? <span className="badge good">Live</span> : s.csvOnly ? <span className="badge info" title="No open API; import its CSV export above">CSV Import</span> : <span className="badge neutral">Preview</span>}
                          
                        </td>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btn-ghost btn-xs" disabled={busy !== null} onClick={() => (open === s.key ? setOpen(null) : run(s.key, "preview"))}>
                            {busy === `${s.key}:preview` ? "…" : open === s.key ? "Close" : "Preview"}
                          </button>{" "}
                          {s.live && (
                            <button className="btn btn-primary btn-xs" disabled={busy !== null} onClick={() => run(s.key, "sync")}>
                              {busy === `${s.key}:sync` ? "…" : "Sync"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open === s.key && p && (
                        <tr>
                          <td colSpan={4} style={{ background: "var(--surface-2)" }}>
                            <div className="chips" style={{ marginBottom: 8 }}>
                              <span className={`badge ${p.live ? "good" : "neutral"}`}>{p.live ? "From your account" : "Sample data"}</span>
                              {Object.entries(p.counts).map(([k, v]) => (
                                <span key={k} className="chip">
                                  {KIND[k] ?? k} <b>{String(v)}</b>
                                </span>
                              ))}
                            </div>
                            {!s.live && fields.length > 0 && data.canStoreCredentials && (
                              <div className="ask-row" style={{ marginTop: 8 }}>
                                {fields.map((f) => (
                                  <input key={f} className="input" type="password" autoComplete="off" placeholder={f} value={creds[`${s.key}.${f}`] ?? ""} onChange={(e) => setCreds((c) => ({ ...c, [`${s.key}.${f}`]: e.target.value }))} />
                                ))}
                                <button className="btn btn-primary" onClick={() => connect(s.key, fields)}>
                                  Connect
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
