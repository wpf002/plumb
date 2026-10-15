"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getCompanyId } from "./ui";

// Reads a folder (or a multi-file selection) of CSVs in the browser and posts
// them as one file set. No zip handling needed: the folder picker hands over
// every file directly.
export function CsvImport({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(list: FileList | null) {
    if (!list) return;
    const out: Record<string, string> = {};
    for (const f of Array.from(list)) {
      if (f.name.toLowerCase().endsWith(".csv")) out[f.name] = await f.text();
    }
    setFiles(Object.keys(out).length ? out : null);
    setResult(null);
    setError(Object.keys(out).length ? null : "No CSV files in that selection.");
  }

  async function run(path: string) {
    if (!files) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setResult(j);
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const count = files ? Object.keys(files).length : 0;

  return (
    <section className="card">
      <div className="card-title">CSV Import</div>
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <label className="btn btn-ghost">
          Choose Folder
          <input
            type="file"
            multiple
            // @ts-expect-error non-standard but supported by every current browser
            webkitdirectory=""
            style={{ display: "none" }}
            onChange={(e) => pick(e.target.files)}
          />
        </label>
        <span className="num" style={{ color: "var(--text-muted)" }}>
          {count ? `${count} CSV files` : "No files"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={!files || busy} onClick={() => run("/imports")}>
            {busy ? "Importing…" : "Import As New Company"}
          </button>
          <button
            className="btn btn-ghost"
            disabled={!files || busy || !isOwner}
            onClick={() => run(`/companies/${getCompanyId()}/import`)}
          >
            Replace Current Data
          </button>
        </div>
      </div>

      {error && (
        <div className="alert critical" style={{ marginTop: 16 }}>
          <div className="alert-title">{error}</div>
        </div>
      )}

      {result && (
        <>
          <div className={`alert ${result.reconciliation.ok ? "good" : "warning"}`} style={{ marginTop: 16 }}>
            <div className="alert-title">
              {result.report.companyName} · as of {result.report.dataAsOf} ·{" "}
              {result.reconciliation.checks.filter((c: any) => c.failures === 0).length}/
              {result.reconciliation.checks.length} checks pass
            </div>
          </div>
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th className="num">Rows</th>
                <th className="num">Written</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {result.report.files.map((f: any) => (
                <tr key={f.file}>
                  <td className="cell-name">{f.file}</td>
                  <td style={{ color: "var(--text-muted)" }}>{f.kind}</td>
                  <td className="num">{f.rows}</td>
                  <td className="num">{f.written}</td>
                  <td style={{ color: "var(--text-muted)" }}>{f.notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Check</th>
                <th className="num">Periods</th>
                <th className="num">Max Diff</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.reconciliation.checks.map((c: any) => (
                <tr key={c.name}>
                  <td className="cell-name">{c.name}</td>
                  <td className="num">{c.periods}</td>
                  <td className="num">{(c.maxDiffCents / 100).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${c.failures ? "bad" : "good"}`}>{c.failures ? `${c.failures} Off` : "Pass"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
