"use client";

import { useState } from "react";
import { apiFetch, getCompanyId } from "../ui";

/** Manual import of a bank or card CSV export, for accounts no feed covers. */
export function TransactionsImport() {
  const [account, setAccount] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    const res = await apiFetch(`/companies/${getCompanyId()}/transactions/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: await file.text(), ...(account.trim() && { account: account.trim() }) }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? `${j.imported} transactions imported${j.skipped ? `, ${j.skipped} skipped` : ""}.` : j.message ?? "Import failed.");
  }

  return (
    <section className="card">
      <div className="card-title">Bank Transactions</div>
      <div className="ask-row">
        <input className="input" placeholder="Account name" value={account} onChange={(e) => setAccount(e.target.value)} maxLength={80} />
        <label className="btn btn-ghost" style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Importing…" : "Import CSV"}
          <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {msg && <p className="muted">{msg}</p>}
    </section>
  );
}
