"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd } from "../ui";

const CADENCE: Record<string, string> = { weekly: "Weekly", biweekly: "Every 2 Weeks", monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly" };

/** Recurring charges found in the bank and card feeds, one click from the obligation list. */
export function DetectedRecurring({ onAdded }: { onAdded: () => void }) {
  const [data, setData] = useState<any>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch(`/companies/${getCompanyId()}/recurring-transactions`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  const out = (data?.series ?? []).filter((s: any) => s.direction === "out");
  if (!out.length) return null;

  async function add(s: any) {
    await apiFetch(`/companies/${getCompanyId()}/recurring-expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: s.label, amountCents: s.typicalAmountCents, frequency: s.cadence.toUpperCase(), startDate: new Date(`${s.nextDate}T00:00:00Z`).toISOString() }),
    });
    setAdded((p) => new Set(p).add(s.key));
    onAdded();
  }

  return (
    <section className="card">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Found in Bank Feed
        </div>
        <span className="num muted">{usd(data.monthlyOutCents)} / month</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Charge</th>
            <th>Every</th>
            <th className="num">Amount</th>
            <th>Next</th>
            <th className="num"></th>
          </tr>
        </thead>
        <tbody>
          {out.map((s: any) => (
            <tr key={s.key}>
              <td className="cell-name">{s.label}</td>
              <td>{CADENCE[s.cadence]}</td>
              <td className="num">{usd(s.typicalAmountCents)}</td>
              <td className="muted">{s.nextDate}</td>
              <td className="num">
                {added.has(s.key) ? (
                  <span className="badge good">Added</span>
                ) : (
                  <button className="btn btn-ghost btn-xs" onClick={() => add(s)}>
                    Add
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
