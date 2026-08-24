"use client";

import { useCallback, useEffect, useState } from "react";
import {
  apiFetch,
  getCompanyId,
  usd,
  centsFrom,
  dateInput,
  shortDate,
  hasServices,
  FREQUENCIES,
  FREQUENCY_LABELS,
  C,
} from "../ui";

const OVERHEAD_CATEGORIES = ["OVERHEAD", "PAYROLL", "INSURANCE", "TAX", "VENDOR_BILL"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  OVERHEAD: "Overhead",
  PAYROLL: "Payroll",
  INSURANCE: "Insurance",
  TAX: "Tax",
  VENDOR_BILL: "Vendor",
  LOAN: "Debt service",
  PROGRESS_BILLING: "Progress billing",
  RETAINAGE_RELEASE: "Retainage",
};

const empty = {
  name: "",
  category: "OVERHEAD",
  amount: "",
  frequency: "MONTHLY",
  startDate: dateInput(new Date()),
  matchKeyword: "",
};

const emptyContract = {
  name: "",
  client: "",
  amount: "",
  billingFrequency: "MONTHLY",
  netDays: "30",
  startDate: dateInput(new Date()),
  renewalDate: "",
  autoRenew: true,
};

export default function Recurring() {
  const [data, setData] = useState<any>(null);
  const [svc, setSvc] = useState<any>(null);
  const [showServices, setShowServices] = useState(true);
  const [addingContract, setAddingContract] = useState(false);
  const [contract, setContract] = useState({ ...emptyContract });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = getCompanyId();
    if (!id) return;
    const [res, sres, me] = await Promise.all([
      apiFetch(`/companies/${id}/recurring-expenses`, { cache: "no-store" }),
      apiFetch(`/companies/${id}/service-contracts`, { cache: "no-store" }),
      apiFetch("/auth/me", { cache: "no-store" }),
    ]);
    if (res.ok) setData(await res.json());
    if (sres.ok) setSvc(await sres.json());
    if (me.ok) {
      const j = await me.json();
      const active = j.companies.find((c: any) => c.id === j.activeCompanyId);
      setShowServices(hasServices(active?.revenueModel));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, method: string, payload?: any) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Failed (${res.status})`);
      }
      await load();
      return true;
    } catch (e: any) {
      setError(e.message ?? String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const ok = await send("/recurring-expenses", "POST", {
      name: form.name,
      category: form.category,
      amountCents: centsFrom(form.amount),
      frequency: form.frequency,
      startDate: new Date(form.startDate).toISOString(),
      ...(form.matchKeyword && { matchKeyword: form.matchKeyword }),
    });
    if (ok) {
      setForm({ ...empty });
      setAdding(false);
    }
  }

  async function addContract() {
    const ok = await send("/service-contracts", "POST", {
      name: contract.name,
      client: contract.client,
      amountCents: centsFrom(contract.amount),
      billingFrequency: contract.billingFrequency,
      netDays: Number(contract.netDays) || 30,
      startDate: new Date(contract.startDate).toISOString(),
      ...(contract.renewalDate && {
        renewalDate: new Date(contract.renewalDate).toISOString(),
      }),
      autoRenew: contract.autoRenew,
    });
    if (ok) {
      setContract({ ...emptyContract });
      setAddingContract(false);
    }
  }

  async function recordPaid(origin: string, originId: string, amountCents: number) {
    setMsg(null);
    const ok = await send("/obligations/record-payment", "POST", {
      origin,
      originId,
      paidOn: new Date().toISOString(),
      amountCents,
    });
    if (ok) setMsg("Marked paid. It's now a real ledger entry, and the projection for that period is gone.");
  }

  if (!data) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }

  const ob = data.obligations;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Recurring</h1>
          <p>
            What it costs to open the doors each month &mdash; and when each piece of it actually
            leaves the bank.
          </p>
        </div>
      </div>

      {(error || msg) && (
        <div className={`alert ${error ? "critical" : "good"}`} style={{ marginBottom: 20 }}>
          <div className="alert-title">{error ?? msg}</div>
        </div>
      )}

      <section className="card">
        <div className="card-title">Monthly Fixed Cost</div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Total Every Month</div>
            <div className="stat-value num">{usd(ob.monthlyFixedCents)}</div>
            <div className="stat-sub">before a single job cost</div>
          </div>
          <div className="stat">
            <div className="stat-label">Overhead</div>
            <div className="stat-value num">{usd(ob.monthlyOverheadCents)}</div>
            <div className="stat-sub">insurance, software, fuel, rent</div>
          </div>
          <div className="stat">
            <div className="stat-label">Debt Service</div>
            <div className="stat-value num">{usd(ob.monthlyDebtServiceCents)}</div>
            <div className="stat-sub">loans, cards, leases</div>
          </div>
        </div>
        {ob.byCategory.length > 0 && (
          <div className="chips" style={{ marginTop: 16 }}>
            {ob.byCategory
              .slice()
              .sort((a: any, b: any) => b.monthlyCents - a.monthlyCents)
              .map((c: any) => (
                <span key={c.category} className="chip">
                  {CATEGORY_LABELS[c.category] ?? c.category}
                  <b>{usd(c.monthlyCents)}</b>
                </span>
              ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Recurring Overhead
          </div>
          <button className="btn btn-ghost" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add Expense"}
          </button>
        </div>

        {adding && (
          <div className="inline-form">
            <div className="field-grid">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="General liability insurance"
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {OVERHEAD_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Amount ($)</label>
                <input
                  className="input num"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">How Often</label>
                <select
                  className="input"
                  value={form.frequency}
                  onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">First / Next Due</label>
                <input
                  className="input"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">QuickBooks Vendor Contains</label>
                <input
                  className="input"
                  value={form.matchKeyword}
                  onChange={(e) => setForm((f) => ({ ...f, matchKeyword: e.target.value }))}
                  placeholder="Travelers"
                />
              </div>
            </div>
            <p className="hint">
              The vendor keyword is optional. When a synced QuickBooks bill matches it, that real
              payment replaces the projection for the month instead of being counted twice.
            </p>
            <div style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary"
                disabled={busy || !form.name || !form.amount}
                onClick={add}
              >
                {busy ? "Saving…" : "Save Expense"}
              </button>
            </div>
          </div>
        )}

        {data.expenses.length === 0 ? (
          <p className="empty">
            Nothing here yet. Add insurance, software, fuel, utilities, rent, and any payroll not
            tied to a job &mdash; each one becomes a scheduled outflow in the forecast.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Expense</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>How Often</th>
                <th className="num">Per Month</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((e: any) => {
                const perMonth = {
                  WEEKLY: 52 / 12,
                  BIWEEKLY: 26 / 12,
                  MONTHLY: 1,
                  QUARTERLY: 1 / 3,
                  ANNUAL: 1 / 12,
                }[e.frequency as string];
                return (
                  <tr key={e.id} style={e.active ? undefined : { opacity: 0.5 }}>
                    <td className="cell-name">
                      {e.name}
                      {e.matchKeyword && (
                        <div style={{ fontSize: 12, color: "var(--faint)", fontWeight: 400 }}>
                          matches QuickBooks vendor &ldquo;{e.matchKeyword}&rdquo;
                        </div>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)" }}>
                      {CATEGORY_LABELS[e.category] ?? e.category}
                    </td>
                    <td className="num">{usd(e.amountCents)}</td>
                    <td style={{ color: "var(--muted)" }}>{FREQUENCY_LABELS[e.frequency]}</td>
                    <td className="num">{usd(Math.round(e.amountCents * (perMonth ?? 1)))}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => send(`/recurring-expenses/${e.id}`, "PUT", { active: !e.active })}
                      >
                        {e.active ? "Pause" : "Resume"}
                      </button>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => send(`/recurring-expenses/${e.id}`, "DELETE")}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {showServices && svc && (
        <section className="card">
          <div className="row-between">
            <div className="card-title" style={{ marginBottom: 0 }}>
              Recurring Revenue
            </div>
            <button className="btn btn-ghost" onClick={() => setAddingContract((v) => !v)}>
              {addingContract ? "Cancel" : "Add Contract"}
            </button>
          </div>

          <div className="stats" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-label">Coming In Every Month</div>
              <div className="stat-value num">{usd(svc.summary.monthlyRecurringCents)}</div>
              <div className="stat-sub">
                {svc.summary.activeCount} active contract
                {svc.summary.activeCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Covers Your Fixed Cost</div>
              <div
                className="stat-value num"
                style={{
                  color:
                    svc.summary.monthlyRecurringCents >= ob.monthlyFixedCents ? C.green : undefined,
                }}
              >
                {ob.monthlyFixedCents > 0
                  ? `${Math.round((svc.summary.monthlyRecurringCents / ob.monthlyFixedCents) * 100)}%`
                  : "—"}
              </div>
              <div className="stat-sub">of the nut, before any job</div>
            </div>
            <div className="stat">
              <div className="stat-label">Biggest Client</div>
              <div
                className="stat-value num"
                style={{ color: svc.summary.largestClientSharePct >= 40 ? C.amber : undefined }}
              >
                {svc.summary.largestClientSharePct}%
              </div>
              <div className="stat-sub">{svc.summary.largestClientName ?? "—"}</div>
            </div>
          </div>

          {svc.summary.renewals.length > 0 && (
            <div className="alert warning" style={{ marginBottom: 16 }}>
              <div style={{ width: "100%" }}>
                <div className="alert-title">
                  {svc.summary.renewals.length} contract
                  {svc.summary.renewals.length === 1 ? "" : "s"} up for renewal in the next 90 days.
                </div>
                <div className="alert-detail">
                  {svc.summary.renewals
                    .map(
                      (r: any) =>
                        `${r.client} — ${r.name} (${r.shareOfRecurringPct}% of recurring) in ${r.daysAway} days${r.autoRenew ? ", auto-renews" : ""}`
                    )
                    .join(". ")}
                  .
                </div>
              </div>
            </div>
          )}

          {addingContract && (
            <div className="inline-form">
              <div className="field-grid">
                <div>
                  <label className="label">Contract</label>
                  <input
                    className="input"
                    value={contract.name}
                    onChange={(e) => setContract((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Fire alarm monitoring"
                  />
                </div>
                <div>
                  <label className="label">Client</label>
                  <input
                    className="input"
                    value={contract.client}
                    onChange={(e) => setContract((f) => ({ ...f, client: e.target.value }))}
                    placeholder="Hillwood Properties"
                  />
                </div>
                <div>
                  <label className="label">Amount ($)</label>
                  <input
                    className="input num"
                    value={contract.amount}
                    onChange={(e) => setContract((f) => ({ ...f, amount: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="label">Billed</label>
                  <select
                    className="input"
                    value={contract.billingFrequency}
                    onChange={(e) =>
                      setContract((f) => ({ ...f, billingFrequency: e.target.value }))
                    }
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {FREQUENCY_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Payment Terms (Days)</label>
                  <input
                    className="input num"
                    value={contract.netDays}
                    onChange={(e) => setContract((f) => ({ ...f, netDays: e.target.value }))}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="label">Starts</label>
                  <input
                    className="input"
                    type="date"
                    value={contract.startDate}
                    onChange={(e) => setContract((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Renews / Ends</label>
                  <input
                    className="input"
                    type="date"
                    value={contract.renewalDate}
                    onChange={(e) => setContract((f) => ({ ...f, renewalDate: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy || !contract.name || !contract.client || !contract.amount}
                  onClick={addContract}
                >
                  Save Contract
                </button>
              </div>
            </div>
          )}

          {svc.contracts.length === 0 ? (
            <p className="empty">
              No recurring contracts yet. Maintenance agreements, monitoring, and service plans go
              here &mdash; they&rsquo;re the income that shows up whether or not you win the next
              bid.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Client</th>
                  <th className="num">Amount</th>
                  <th>Billed</th>
                  <th className="num">Per Month</th>
                  <th>Renews</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {svc.contracts.map((c: any) => {
                  const perMonth = {
                    WEEKLY: 52 / 12,
                    BIWEEKLY: 26 / 12,
                    MONTHLY: 1,
                    QUARTERLY: 1 / 3,
                    ANNUAL: 1 / 12,
                  }[c.billingFrequency as string];
                  return (
                    <tr key={c.id} style={c.status === "ACTIVE" ? undefined : { opacity: 0.5 }}>
                      <td className="cell-name">{c.name}</td>
                      <td style={{ color: "var(--muted)" }}>
                        {c.client}
                        {c.payer && (
                          <div style={{ fontSize: 12, color: "var(--faint)" }}>
                            pays {c.payer.typicalDaysLate}d past terms
                          </div>
                        )}
                      </td>
                      <td className="num">{usd(c.amountCents)}</td>
                      <td style={{ color: "var(--muted)" }}>
                        {FREQUENCY_LABELS[c.billingFrequency]}
                      </td>
                      <td className="num">{usd(Math.round(c.amountCents * (perMonth ?? 1)))}</td>
                      <td>
                        {c.renewalDate ? shortDate(c.renewalDate) : "—"}
                        {c.renewalDate && (
                          <div style={{ fontSize: 12, color: "var(--faint)" }}>
                            {c.autoRenew ? "auto-renews" : "must be re-signed"}
                          </div>
                        )}
                      </td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() =>
                            send(`/service-contracts/${c.id}`, "PUT", {
                              status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                            })
                          }
                        >
                          {c.status === "ACTIVE" ? "Pause" : "Resume"}
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => send(`/service-contracts/${c.id}`, "DELETE")}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-title">Leaving the Bank — Next 30 Days</div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
          Every scheduled obligation the forecast is counting on. Marking one paid turns it into a
          real ledger entry and removes the projection for that period.
        </p>
        {data.upcoming.length === 0 ? (
          <p className="empty">No scheduled obligations in the next 30 days.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Due</th>
                <th>What</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.upcoming.map((u: any) => (
                <tr key={u.sourceKey}>
                  <td>{shortDate(u.expectedDate)}</td>
                  <td className="cell-name">{u.label}</td>
                  <td>
                    <span className={`badge ${u.origin === "LIABILITY" ? "info" : "neutral"}`}>
                      {u.origin === "LIABILITY" ? "Debt" : "Overhead"}
                    </span>
                  </td>
                  <td className="num">{usd(u.amountCents)}</td>
                  <td className="num">
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={busy}
                      onClick={() => recordPaid(u.origin, u.originId, u.amountCents)}
                    >
                      Mark Paid
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
