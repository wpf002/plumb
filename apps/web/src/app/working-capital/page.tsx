"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd } from "../ui";

const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
const BUCKET_LABEL: Record<string, string> = {
  current: "Current",
  "1-30": "1–30",
  "31-60": "31–60",
  "61-90": "61–90",
  "90+": "90+",
};
const BUCKET_TONE: Record<string, string> = {
  current: "var(--good)",
  "1-30": "var(--info)",
  "31-60": "var(--warn)",
  "61-90": "var(--danger)",
  "90+": "var(--danger)",
};

function AgingBar({ buckets, total }: { buckets: Record<string, number>; total: number }) {
  if (total <= 0) return null;
  return (
    <div className="aging-bar" role="img" aria-label="Aging by bucket">
      {BUCKETS.map((b) =>
        buckets[b] > 0 ? (
          <span key={b} style={{ width: `${(buckets[b] / total) * 100}%`, background: BUCKET_TONE[b] }} title={`${BUCKET_LABEL[b]}: ${usd(buckets[b])}`} />
        ) : null
      )}
    </div>
  );
}

function AgingTable({ aging, partyLabel }: { aging: any; partyLabel: string }) {
  if (aging.byParty.length === 0) return <p className="empty">Nothing open.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{partyLabel}</th>
          {BUCKETS.map((b) => (
            <th key={b} className="num">
              {BUCKET_LABEL[b]}
            </th>
          ))}
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {aging.byParty.slice(0, 15).map((p: any) => (
          <tr key={p.partyId ?? p.party}>
            <td className="cell-name">{p.party}</td>
            {BUCKETS.map((b) => (
              <td key={b} className={`num${b !== "current" && b !== "1-30" && p.buckets[b] > 0 ? " neg" : ""}`}>
                {p.buckets[b] ? usd(p.buckets[b]) : "—"}
              </td>
            ))}
            <td className="num" style={{ fontWeight: 700 }}>
              {usd(p.totalCents)}
            </td>
          </tr>
        ))}
        <tr className="statement-subtotal">
          <td>Total</td>
          {BUCKETS.map((b) => (
            <td key={b} className="num">
              {usd(aging.buckets[b])}
            </td>
          ))}
          <td className="num">{usd(aging.totalCents)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export default function WorkingCapital() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const id = getCompanyId();
    if (!id) return;
    apiFetch(`/companies/${id}/working-capital`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  if (!data) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }

  const wc = data.workingCapital;
  const ar = data.receivables;

  return (
    <main className="container container-wide">
      <div className="page-head">
        <div>
          <h1>Working Capital</h1>
        </div>
      </div>

      <section className="card">
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Working Capital</div>
            <div className={`stat-value num${wc.workingCapitalCents < 0 ? " neg" : ""}`}>{usd(wc.workingCapitalCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Current Ratio</div>
            <div className="stat-value num">{wc.currentRatio === null ? "—" : `${wc.currentRatio.toFixed(2)}x`}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Quick Ratio</div>
            <div className="stat-value num">{wc.quickRatio === null ? "—" : `${wc.quickRatio.toFixed(2)}x`}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Cash</div>
            <div className="stat-value num">{usd(wc.cashCents)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Accounts Receivable
          </div>
        </div>
        <AgingBar buckets={ar.buckets} total={ar.totalCents} />
        <AgingTable aging={ar} partyLabel="Customer" />
      </section>

      {data.collections.length > 0 && (
        <section className="card">
          <div className="card-title">Collection Priority</div>
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th className="num">Priority</th>
              </tr>
            </thead>
            <tbody>
              {data.collections.slice(0, 10).map((c: any) => (
                <tr key={c.id}>
                  <td className="cell-name num">{c.id}</td>
                  <td>{c.party}</td>
                  <td className="num">{usd(c.amountCents)}</td>
                  <td className={c.daysPastDue > 30 ? "neg" : "muted"}>{c.reason}</td>
                  <td className="num">{c.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Accounts Payable
          </div>
          <span className="num muted">{usd(data.payables.totalCents)}</span>
        </div>
        <AgingBar buckets={data.payables.buckets} total={data.payables.totalCents} />
        <AgingTable aging={data.payables} partyLabel="Vendor" />
      </section>
    </main>
  );
}
