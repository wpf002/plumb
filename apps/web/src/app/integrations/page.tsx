"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd } from "../ui";
import { DataHealthCard } from "../health-ui";
import { CsvImport } from "../csv-import";
import { ApiKeys } from "./api-keys";

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
                <td style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {c.detail}
                  {c.lastSync && ` · last sync ${c.lastSync.status}`}
                </td>
                <td className="num">
                  {c.key === "qbo" && c.action === "connect" && c.connectUrl && (
                    <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 14 }} onClick={() => connectQbo(c.connectUrl)}>
                      Connect
                    </button>
                  )}
                  {c.key === "qbo" && c.action === "sync" && (
                    <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 14 }} disabled={busy === "qbo"} onClick={syncQbo}>
                      {busy === "qbo" ? "Syncing…" : "Sync Now"}
                    </button>
                  )}
                  {c.action === "settings" && (
                    <a className="navlink" href="/settings" style={{ color: "var(--accent)", padding: 0 }}>Settings →</a>
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
          <div className="card-title" style={{ marginBottom: 4 }}>{title}</div>
        </div>
        <button className="btn btn-primary" onClick={go} disabled={busy}>
          {busy ? "Running…" : action}
        </button>
      </div>

      {error && <p className="neg" style={{ marginBottom: 0 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <LiveBadge live={result.live} />
            <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{result.note}</span>
          </div>
          <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>{result.summary}</div>
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

function DataHealth() {
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    if (!getCompanyId()) return;
    apiFetch(`/companies/${getCompanyId()}/data-health`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  if (!health) return null;
  return <DataHealthCard health={health} />;
}

function ImportCard() {
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    apiFetch("/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        const active = me?.companies.find((c: any) => c.id === me.activeCompanyId);
        setIsOwner(active?.role === "OWNER");
      });
  }, []);
  return <CsvImport isOwner={isOwner} />;
}

export default function Integrations() {
  return (
    <main className="container" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
        </div>
      </div>

      <DataHealth />

      <ImportCard />

      <Connections />

      <ApiKeys />

      <Panel
        title="Payroll (Gusto / ADP)"
        blurb="True labor cost and hours per job — the biggest, messiest cost line for a sub."
        action="Preview Import"
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
        blurb="Another place your invoices and expenses can come from, if you don't run QuickBooks."
        action="Preview Sync"
        run={async () => {
          const d = await post("/integrations/freshbooks/sync");
          return {
            live: d.live,
            note: d.note,
            summary: `${usd(d.inflowCents)} in · ${usd(d.outflowCents)} out`,
            rows: d.preview.map((e: any) => ({
              left: e.counterparty,
              mid: e.date,
              right: `${e.direction === "IN" ? "+" : "–"}${usd(e.amountCents)}`,
            })),
          };
        }}
      />

      <Panel
        title="Tax Obligations"
        blurb="Estimated quarterly tax from projected profit, timed into the cash forecast."
        action="Preview Obligations"
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
