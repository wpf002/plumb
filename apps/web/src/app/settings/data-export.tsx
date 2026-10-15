"use client";

import { useState } from "react";
import { apiFetch, getCompanyId } from "../ui";

const TABLES = [
  { key: "gl", label: "General Ledger" },
  { key: "invoices", label: "Invoices" },
  { key: "bills", label: "Bills" },
  { key: "projects", label: "Jobs" },
  { key: "customers", label: "Customers" },
  { key: "vendors", label: "Vendors" },
  { key: "transactions", label: "Bank Transactions" },
  { key: "payroll", label: "Payroll" },
];

/** CSV per table, or everything as NDJSON for a warehouse load. Owners and accountants. */
export function DataExport() {
  const [error, setError] = useState<string | null>(null);
  async function download(table: string) {
    setError(null);
    const res = await apiFetch(`/companies/${getCompanyId()}/export/${table}`, { cache: "no-store" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).message ?? "Export failed.");
    const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `${table}.csv`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="card">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Data Export
        </div>
        <button className="btn btn-primary btn-xs" onClick={() => download("all")}>
          Export All
        </button>
      </div>
      <div className="chips" style={{ marginTop: 12 }}>
        {TABLES.map((t) => (
          <button key={t.key} type="button" className="chip" onClick={() => download(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="neg">{error}</p>}
    </section>
  );
}
