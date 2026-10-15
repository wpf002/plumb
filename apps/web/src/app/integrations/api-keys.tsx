"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, getCompanyId, shortDate } from "../ui";

const SCOPES = [
  { key: "read", label: "Read" },
  { key: "analyze", label: "Analyze" },
  { key: "write", label: "Write" },
] as const;

/** Keys for the tool API: AI connectors and scripts. The key is shown once. */
export function ApiKeys() {
  const [keys, setKeys] = useState<any[] | null>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = getCompanyId();
    const [k, c] = await Promise.all([
      apiFetch(`/companies/${id}/api-keys`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      apiFetch(`/companies/${id}/tool-calls`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ]);
    setKeys(k);
    setCalls(c);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setError(null);
    const res = await apiFetch(`/companies/${getCompanyId()}/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    const j = await res.json();
    if (!res.ok) return setError(j.message ?? "Couldn't create the key.");
    setCreated(j.key);
    setName("");
    load();
  }

  async function revoke(id: string) {
    await apiFetch(`/companies/${getCompanyId()}/api-keys/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <section className="card">
      <div className="card-title">API Keys</div>
      <div className="ask-row">
        <input className="input" placeholder="Key name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <div className="chips">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`chip${scopes.includes(s.key) ? " active" : ""}`}
              onClick={() => setScopes((p) => (p.includes(s.key) ? p.filter((x) => x !== s.key) : [...p, s.key]))}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!name.trim() || scopes.length === 0} onClick={create}>
          Create Key
        </button>
      </div>
      {error && <p className="neg">{error}</p>}
      {created && (
        <div className="alert good" style={{ marginTop: 12 }}>
          <div style={{ width: "100%" }}>
            <div className="alert-title">Copy this key now. It won't be shown again.</div>
            <code className="key-reveal">{created}</code>
          </div>
        </div>
      )}
      {keys && keys.length > 0 && (
        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Scopes</th>
              <th>Last Used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={k.revokedAt ? "muted" : undefined}>
                <td className="cell-name">{k.name}</td>
                <td className="num">{k.prefix}…</td>
                <td>{k.scopes.join(", ")}</td>
                <td className="muted">{k.lastUsedAt ? shortDate(k.lastUsedAt) : "Never"}</td>
                <td className="num">
                  {k.revokedAt ? (
                    <span className="badge neutral">Revoked</span>
                  ) : (
                    <button className="btn btn-ghost btn-xs" onClick={() => revoke(k.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {calls.length > 0 && (
        <>
          <div className="card-title" style={{ marginTop: 16 }}>
            API Log
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Caller</th>
                <th>When</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, 10).map((c) => (
                <tr key={c.id}>
                  <td className="cell-name num">{c.tool}</td>
                  <td>{c.caller}</td>
                  <td className="muted">{new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td>{c.ok ? <span className="badge good">OK</span> : <span className="badge bad">{c.error === "permission" ? "Denied" : "Error"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
