"use client";

import { useCallback, useEffect, useState } from "react";
import {
  apiFetch,
  getCompanyId,
  usd,
  centsFrom,
  dateInput,
  shortDate,
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  LIABILITY_KINDS,
  LIABILITY_KIND_LABELS,
  FREQUENCIES,
  FREQUENCY_LABELS,
} from "../ui";

type Sheet = any;

const emptyAsset = {
  name: "",
  category: "EQUIPMENT",
  purchaseDate: dateInput(new Date()),
  purchaseCost: "",
  currentValue: "",
  usefulLifeMonths: "",
  salvageValue: "",
};

const emptyLiability = {
  name: "",
  kind: "TERM_LOAN",
  currentBalance: "",
  creditLimit: "",
  interestRatePct: "",
  paymentAmount: "",
  paymentFrequency: "MONTHLY",
  nextPaymentDate: dateInput(new Date()),
  endDate: "",
  assetId: "",
};

export default function BalanceSheet() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [liabilities, setLiabilities] = useState<any[]>([]);
  const [monthlyDebtService, setMonthlyDebtService] = useState(0);
  const [debt, setDebt] = useState<any>(null);
  const [addingAsset, setAddingAsset] = useState(false);
  const [addingLiability, setAddingLiability] = useState(false);
  const [assetForm, setAssetForm] = useState({ ...emptyAsset });
  const [liabilityForm, setLiabilityForm] = useState({ ...emptyLiability });
  const [schedule, setSchedule] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = getCompanyId();
    if (!id) return;
    const [s, a, l, d] = await Promise.all([
      apiFetch(`/companies/${id}/balance-sheet`, { cache: "no-store" }).then((r) => r.json()),
      apiFetch(`/companies/${id}/assets`, { cache: "no-store" }).then((r) => r.json()),
      apiFetch(`/companies/${id}/liabilities`, { cache: "no-store" }).then((r) => r.json()),
      apiFetch(`/companies/${id}/debt`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    setDebt(d);
    setSheet(s);
    setAssets(a.assets ?? []);
    setLiabilities(l.liabilities ?? []);
    setMonthlyDebtService(l.monthlyDebtServiceCents ?? 0);
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

  async function addAsset() {
    const ok = await send("/assets", "POST", {
      name: assetForm.name,
      category: assetForm.category,
      purchaseDate: new Date(assetForm.purchaseDate).toISOString(),
      purchaseCostCents: centsFrom(assetForm.purchaseCost),
      ...(assetForm.currentValue && { currentValueCents: centsFrom(assetForm.currentValue) }),
      ...(assetForm.usefulLifeMonths && { usefulLifeMonths: Number(assetForm.usefulLifeMonths) }),
      ...(assetForm.salvageValue && { salvageValueCents: centsFrom(assetForm.salvageValue) }),
    });
    if (ok) {
      setAssetForm({ ...emptyAsset });
      setAddingAsset(false);
    }
  }

  async function addLiability() {
    const ok = await send("/liabilities", "POST", {
      name: liabilityForm.name,
      kind: liabilityForm.kind,
      currentBalanceCents: centsFrom(liabilityForm.currentBalance),
      ...(liabilityForm.creditLimit && { creditLimitCents: centsFrom(liabilityForm.creditLimit) }),
      interestRatePct: Number(liabilityForm.interestRatePct) || 0,
      paymentAmountCents: centsFrom(liabilityForm.paymentAmount),
      paymentFrequency: liabilityForm.paymentFrequency,
      ...(liabilityForm.nextPaymentDate && {
        nextPaymentDate: new Date(liabilityForm.nextPaymentDate).toISOString(),
      }),
      ...(liabilityForm.endDate && { endDate: new Date(liabilityForm.endDate).toISOString() }),
      ...(liabilityForm.assetId && { assetId: liabilityForm.assetId }),
    });
    if (ok) {
      setLiabilityForm({ ...emptyLiability });
      setAddingLiability(false);
    }
  }

  async function reprice(assetId: string, current: number) {
    const entered = window.prompt("Current value of this asset ($)", String(Math.round(current / 100)));
    if (entered === null) return;
    await send(`/assets/${assetId}`, "PUT", { currentValueCents: centsFrom(entered) });
  }

  async function showSchedule(liabilityId: string) {
    const res = await apiFetch(
      `/companies/${getCompanyId()}/liabilities/${liabilityId}/schedule?horizonDays=1825`,
      { cache: "no-store" }
    );
    setSchedule(await res.json());
  }

  if (!sheet) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }

  const net = sheet.netWorthCents;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Assets & Debt</h1>
        </div>
      </div>

      {error && (
        <div className="alert critical" style={{ marginBottom: 16 }}>
          <div className="alert-title">{error}</div>
        </div>
      )}

      <section className="card">
        <div className="card-title">Net Worth</div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Net Worth</div>
            <div className={`stat-value num ${net >= 0 ? "pos" : "neg"}`}>{usd(net)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Cash</div>
            <div className="stat-value num">{usd(sheet.cashCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Equipment &amp; Property</div>
            <div className="stat-value num">{usd(sheet.assetValueCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Debt Outstanding</div>
            <div className="stat-value num">{usd(sheet.totalLiabilitiesCents)}</div>
          </div>
        </div>
      </section>

      {/* Assets */}
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Assets
          </div>
          <button className="btn btn-ghost" onClick={() => setAddingAsset((v) => !v)}>
            {addingAsset ? "Cancel" : "Add Asset"}
          </button>
        </div>

        {addingAsset && (
          <div className="inline-form">
            <div className="field-grid">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={assetForm.name}
                  onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="F-350 service truck"
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={assetForm.category}
                  onChange={(e) => setAssetForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {ASSET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {ASSET_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Purchase Date</label>
                <input
                  className="input"
                  type="date"
                  value={assetForm.purchaseDate}
                  onChange={(e) => setAssetForm((f) => ({ ...f, purchaseDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Purchase Cost ($)</label>
                <input
                  className="input num"
                  value={assetForm.purchaseCost}
                  onChange={(e) => setAssetForm((f) => ({ ...f, purchaseCost: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Current Value ($, optional)</label>
                <input
                  className="input num"
                  value={assetForm.currentValue}
                  onChange={(e) => setAssetForm((f) => ({ ...f, currentValue: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Useful Life (Months)</label>
                <input
                  className="input num"
                  value={assetForm.usefulLifeMonths}
                  onChange={(e) =>
                    setAssetForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))
                  }
                  inputMode="numeric"
                  placeholder="60"
                />
              </div>
              <div>
                <label className="label">Salvage Value ($)</label>
                <input
                  className="input num"
                  value={assetForm.salvageValue}
                  onChange={(e) => setAssetForm((f) => ({ ...f, salvageValue: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={busy || !assetForm.name || !assetForm.purchaseCost}
                onClick={addAsset}
              >
                {busy ? "Saving…" : "Save Asset"}
              </button>
            </div>
          </div>
        )}

        {assets.length === 0 ? (
          <p className="empty">No assets.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Category</th>
                <th>Purchased</th>
                <th className="num">Cost</th>
                <th className="num">Value Today</th>
                <th className="num">Depreciation</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td className="cell-name">
                    {a.name}
                    
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{ASSET_CATEGORY_LABELS[a.category]}</td>
                  <td style={{ color: "var(--text-muted)" }}>{shortDate(a.purchaseDate)}</td>
                  <td className="num">{usd(a.purchaseCostCents)}</td>
                  <td className="num">
                    {usd(a.valuation?.currentValueCents ?? 0)}
                  </td>
                  <td className="num" style={{ color: "var(--text-muted)" }}>
                    {a.valuation?.monthlyDepreciationCents
                      ? `${usd(a.valuation.monthlyDepreciationCents)}/mo`
                      : "—"}
                  </td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => reprice(a.id, a.valuation?.currentValueCents ?? 0)}
                    >
                      Update Value
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => send(`/assets/${a.id}`, "DELETE")}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {debt && (
        <section className="card">
          <div className="card-title">Debt</div>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Total Debt</div>
              <div className="stat-value num">{usd(debt.totalDebtCents)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Annual Debt Service</div>
              <div className="stat-value num">{usd(debt.annualDebtServiceCents)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Debt Coverage</div>
              <div className="stat-value num">{debt.dscr === null ? "—" : `${debt.dscr}x`}</div>
            </div>
            {debt.loc.limitCents > 0 && (
              <div className="stat">
                <div className="stat-label">Line of Credit</div>
                <div className="stat-value num">
                  {usd(debt.loc.balanceCents)} / {usd(debt.loc.limitCents)}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Liabilities */}
      <section className="card">
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Liabilities
          </div>
          <button className="btn btn-ghost" onClick={() => setAddingLiability((v) => !v)}>
            {addingLiability ? "Cancel" : "Add Liability"}
          </button>
        </div>

        {addingLiability && (
          <div className="inline-form">
            <div className="field-grid">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={liabilityForm.name}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Truck loan — Frost Bank"
                />
              </div>
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={liabilityForm.kind}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, kind: e.target.value }))}
                >
                  {LIABILITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {LIABILITY_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Balance Owed ($)</label>
                <input
                  className="input num"
                  value={liabilityForm.currentBalance}
                  onChange={(e) =>
                    setLiabilityForm((f) => ({ ...f, currentBalance: e.target.value }))
                  }
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Credit Limit ($, cards)</label>
                <input
                  className="input num"
                  value={liabilityForm.creditLimit}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, creditLimit: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Interest Rate (% APR)</label>
                <input
                  className="input num"
                  value={liabilityForm.interestRatePct}
                  onChange={(e) =>
                    setLiabilityForm((f) => ({ ...f, interestRatePct: e.target.value }))
                  }
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Payment ($)</label>
                <input
                  className="input num"
                  value={liabilityForm.paymentAmount}
                  onChange={(e) =>
                    setLiabilityForm((f) => ({ ...f, paymentAmount: e.target.value }))
                  }
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Frequency</label>
                <select
                  className="input"
                  value={liabilityForm.paymentFrequency}
                  onChange={(e) =>
                    setLiabilityForm((f) => ({ ...f, paymentFrequency: e.target.value }))
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
                <label className="label">Next Payment</label>
                <input
                  className="input"
                  type="date"
                  value={liabilityForm.nextPaymentDate}
                  onChange={(e) =>
                    setLiabilityForm((f) => ({ ...f, nextPaymentDate: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="label">Lease Ends (Leases)</label>
                <input
                  className="input"
                  type="date"
                  value={liabilityForm.endDate}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Finances Which Asset?</label>
                <select
                  className="input"
                  value={liabilityForm.assetId}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, assetId: e.target.value }))}
                >
                  <option value="">—</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={busy || !liabilityForm.name}
                onClick={addLiability}
              >
                {busy ? "Saving…" : "Save Liability"}
              </button>
            </div>
          </div>
        )}

        {liabilities.length === 0 ? (
          <p className="empty">No liabilities.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Liability</th>
                <th>Type</th>
                <th className="num">Balance</th>
                <th className="num">Payment</th>
                <th className="num">Rate</th>
                <th>Paid Off</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map((l) => (
                <tr key={l.id} style={l.active ? undefined : { opacity: 0.5 }}>
                  <td className="cell-name">
                    {l.name}
                    
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{LIABILITY_KIND_LABELS[l.kind]}</td>
                  <td className="num">
                    {usd(l.currentBalanceCents)}
                    
                  </td>
                  <td className="num">
                    {usd(l.paymentAmountCents)}
                  </td>
                  <td className="num">{Number(l.interestRatePct.toFixed(3))}%</td>
                  <td>
                    {l.kind === "LINE_OF_CREDIT" ? (
                      <span style={{ color: "var(--text-faint)" }}>Revolving</span>
                    ) : l.summary?.amortizes === false ? (
                      <span className="badge bad">Never at this payment</span>
                    ) : l.summary?.projectedPayoffDate ? (
                      shortDate(l.summary.projectedPayoffDate)
                    ) : l.endDate ? (
                      `${shortDate(l.endDate)} (lease)`
                    ) : (
                      <span style={{ color: "var(--text-faint)" }}>beyond 5 yrs</span>
                    )}
                  </td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => showSchedule(l.id)}>
                      Schedule
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => send(`/liabilities/${l.id}`, "DELETE")}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {schedule && (
        <section className="card">
          <div className="row-between">
            <div className="card-title" style={{ marginBottom: 0 }}>
              {schedule.name}
            </div>
            <button className="btn btn-ghost" onClick={() => setSchedule(null)}>
              Close
            </button>
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Payment</th>
                  <th className="num">Interest</th>
                  <th className="num">Principal</th>
                  <th className="num">Balance After</th>
                </tr>
              </thead>
              <tbody>
                {schedule.payments.slice(0, 120).map((p: any, i: number) => (
                  <tr key={i}>
                    <td>{shortDate(p.date)}</td>
                    <td className="num">{usd(p.amountCents)}</td>
                    <td className="num" style={{ color: "var(--text-muted)" }}>
                      {usd(p.interestCents)}
                    </td>
                    <td className="num">{usd(p.principalCents)}</td>
                    <td className="num">{usd(p.balanceAfterCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
