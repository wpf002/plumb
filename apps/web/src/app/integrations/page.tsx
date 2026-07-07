"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd } from "../ui";

const statusBadge: Record<string, { cls: string; label: string }> = {
  connected: { cls: "good", label: "Connected" },
  configured: { cls: "good", label: "Live" },
  available: { cls: "info", label: "Ready" },
  demo: { cls: "neutral", label: "Demo" },
  not_configured: { cls: "neutral", label: "Not set up" },
};

function Connections() {
  const [conns, setConns] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await apiFetch(`/companies/${getCompanyId()}/connections`, { cache: "no-store" });
    if (res.ok) setConns((await res.json()).connections);
  }
  useEffect(() => {
    if (getCompanyId()) load();
  }, []);

  async function connectQbo(url: string) {
    window.location.href = url;
  }
  async function syncQbo() {
    setBusy("qbo");
    await apiFetch(`/companies/${getCompanyId()}/qbo/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await load();
    setBusy(null);
  }

  if (!conns) return null;
  return (
    <section className="card">
      <div className="card-title">Connections</div>
      <table className="table">
        <tbody>
          {conns.map((c) => {
            const b = statusBadge[c.status] ?? statusBadge.demo;
            return (
              <tr key={c.key}>
                <td className="cell-name">{c.name}</td>
                <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                <td style={{ color: "var(--muted)", fontSize: 13.5 }}>
                  {c.detail}
                  {c.lastSync && ` · last sync ${c.lastSync.status}`}
                </td>
                <td className="num">
                  {c.key === "qbo" && c.action === "connect" && c.connectUrl && (
                    <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 13 }} onClick={() => connectQbo(c.connectUrl)}>
                      Connect
                    </button>
                  )}
                  {c.key === "qbo" && c.action === "sync" && (
                    <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 13 }} disabled={busy === "qbo"} onClick={syncQbo}>
                      {busy === "qbo" ? "Syncing…" : "Sync now"}
                    </button>
                  )}
                  {c.action === "settings" && (
                    <a className="navlink" href="/settings" style={{ color: "var(--orange)", padding: 0 }}>Settings →</a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

type Result = { live: boolean; note: string; rows: { left: string; mid?: string; right: string }[]; summary: string };

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span className={`badge ${live ? "good" : "warn"}`}>{live ? "Live" : "Dry run"}</span>
  );
}

function Panel({
  title,
  blurb,
  action,
  run,
}: {
  title: string;
  blurb: string;
  action: string;
  run: () => Promise<Result>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await run());
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 6 }}>{title}</div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>{blurb}</p>
        </div>
        <button className="btn btn-primary" onClick={go} disabled={busy}>
          {busy ? "Running…" : action}
        </button>
      </div>

      {error && <p className="neg" style={{ marginBottom: 0 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <LiveBadge live={result.live} />
            <span style={{ color: "var(--muted)", fontSize: 13.5 }}>{result.note}</span>
          </div>
          <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 8 }}>{result.summary}</div>
          <table className="table">
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i}>
                  <td className="cell-name">{r.left}</td>
                  {r.mid !== undefined && <td>{r.mid}</td>}
                  <td className="num">{r.right}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function post(path: string) {
  const res = await apiFetch(`/companies/${getCompanyId()}${path}`, { method: "POST" });
  const j = await res.json();
  if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
  return j;
}
async function get(path: string) {
  const res = await apiFetch(`/companies/${getCompanyId()}${path}`, { cache: "no-store" });
  const j = await res.json();
  if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
  return j;
}

export default function Integrations() {
  return (
    <main className="container" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <p>Pull the rest of the picture in. Each previews without credentials and imports for real once connected.</p>
        </div>
      </div>

      <Connections />

      <Panel
        title="Payroll — Gusto / ADP"
        blurb="True labor cost and hours per job — the biggest, messiest cost line for a sub."
        action="Preview import"
        run={async () => {
          const d = await post("/integrations/payroll/import");
          return {
            live: d.live,
            note: d.note,
            summary: `${d.totalHours} hrs · ${usd(d.totalCents)} labor`,
            rows: d.preview.map((e: any) => ({ left: e.employee, mid: `${e.hours} h`, right: usd(e.amountCents) })),
          };
        }}
      />

      <Panel
        title="FreshBooks"
        blurb="An alternative accounting source to QuickBooks for shops that don't run QBO."
        action="Preview sync"
        run={async () => {
          const d = await post("/integrations/freshbooks/sync");
          return {
            live: d.live,
            note: d.note,
            summary: `${usd(d.inflowCents)} in · ${usd(d.outflowCents)} out`,
            rows: d.preview.map((e: any) => ({
              left: `${e.direction === "IN" ? "▲" : "▼"} ${e.counterparty}`,
              mid: e.date,
              right: usd(e.amountCents),
            })),
          };
        }}
      />

      <Panel
        title="Tax obligations"
        blurb="Estimated quarterly tax from projected profit, timed into the cash forecast."
        action="Preview obligations"
        run={async () => {
          const d = await get("/integrations/tax");
          return {
            live: d.live,
            note: d.note,
            summary: `${d.ratePct}% of ${usd(d.annualProfitCents)} profit → ${usd(d.annualTaxCents)} / yr`,
            rows: d.obligations.map((o: any) => ({ left: `Due ${o.dueDate}`, right: usd(o.amountCents) })),
          };
        }}
      />
    </main>
  );
}
