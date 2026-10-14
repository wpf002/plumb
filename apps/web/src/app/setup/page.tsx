"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getCompanyId, TRADES, TRADE_LABELS, REVENUE_MODELS, REVENUE_MODEL_COPY } from "../ui";

// Onboarding wizard. The bar is "under 10 minutes and the forecast means
// something at the end of it" — so every step has a working default and the
// only truly required answer is the revenue model, which gates the modules.
const STEPS = ["Business", "Capacity & Targets", "Opening Cash", "Connect QuickBooks"] as const;

export default function Setup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cash, setCash] = useState<number | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    const id = getCompanyId();
    if (!id) return;
    apiFetch(`/companies/${id}/settings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setForm({
          name: j.company.name,
          trade: j.company.trade,
          employeeCount: String(j.company.employeeCount || ""),
          revenueModel: j.company.revenueModel,
          monthlyLaborHours: String(j.company.monthlyLaborHours || ""),
          portfolioTargetMarginPct: String(j.company.portfolioTargetMarginPct),
          defaultRetainagePct: String(j.company.defaultRetainagePct),
          cashSafetyThreshold: String(Math.round(j.company.cashSafetyThresholdCents / 100)),
        });
        if (j.openingCash) setCash(j.openingCash.balanceCents);
      });
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function put(payload: any) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      return true;
    } catch (e: any) {
      setError(e.message ?? String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveOpeningCash(path: string, payload: any) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setCash(j.balanceCents);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (step === 0) {
      const ok = await put({
        name: form.name,
        trade: form.trade,
        employeeCount: Math.round(Number(form.employeeCount) || 0),
        revenueModel: form.revenueModel,
      });
      if (!ok) return;
    }
    if (step === 1) {
      const ok = await put({
        monthlyLaborHours: Math.round(Number(form.monthlyLaborHours) || 0),
        portfolioTargetMarginPct: Number(form.portfolioTargetMarginPct) || 0,
        defaultRetainagePct: Number(form.defaultRetainagePct) || 0,
        cashSafetyThresholdCents: Math.round((Number(form.cashSafetyThreshold) || 0) * 100),
      });
      if (!ok) return;
    }
    if (step === STEPS.length - 1) {
      const ok = await put({ setupCompleted: true });
      if (!ok) return;
      router.push("/");
      router.refresh();
      return;
    }
    setStep((s) => s + 1);
  }

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>Setup</h1>
        </div>
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`step${i === step ? " current" : ""}${i < step ? " done" : ""}`}>
            <span className="step-dot">{i < step ? "✓" : i + 1}</span>
            {s}
          </div>
        ))}
      </div>

      {error && (
        <div className="alert critical" style={{ marginBottom: 16 }}>
          <div className="alert-title">{error}</div>
        </div>
      )}

      <section className="card">
        {step === 0 && (
          <>
            <div className="card-title">Your Business</div>
            <div className="field-grid">
              <div>
                <label className="label">Business Name</label>
                <input className="input" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <label className="label">Trade</label>
                <select className="input" value={form.trade ?? "GENERAL"} onChange={(e) => set("trade", e.target.value)}>
                  {TRADES.map((t) => (
                    <option key={t} value={t}>
                      {TRADE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Employees</label>
                <input
                  className="input num"
                  value={form.employeeCount ?? ""}
                  onChange={(e) => set("employeeCount", e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 18"
                />
              </div>
            </div>

            <label className="label" style={{ marginTop: 16 }}>
              How Do You Make Money?
            </label>
            <div className="choice-grid">
              {REVENUE_MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`choice${(form.revenueModel ?? "BOTH") === m ? " selected" : ""}`}
                  onClick={() => set("revenueModel", m)}
                >
                  <span className="choice-title">{REVENUE_MODEL_COPY[m].title}</span>
                  <span className="choice-sub">{REVENUE_MODEL_COPY[m].sub}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="card-title">Capacity &amp; Targets</div>
            <div className="field-grid">
              <div>
                <label className="label">Crew Capacity (Labor Hrs / Month)</label>
                <input
                  className="input num"
                  value={form.monthlyLaborHours ?? ""}
                  onChange={(e) => set("monthlyLaborHours", e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 800"
                />
              </div>
              <div>
                <label className="label">Target Margin (%)</label>
                <input
                  className="input num"
                  value={form.portfolioTargetMarginPct ?? ""}
                  onChange={(e) => set("portfolioTargetMarginPct", e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Default Retainage (%)</label>
                <input
                  className="input num"
                  value={form.defaultRetainagePct ?? ""}
                  onChange={(e) => set("defaultRetainagePct", e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="label">Cash Safety Threshold ($)</label>
                <input
                  className="input num"
                  value={form.cashSafetyThreshold ?? ""}
                  onChange={(e) => set("cashSafetyThreshold", e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 50000"
                />
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="card-title">Opening Cash</div>
            {cash !== null && (
              <div className="alert good" style={{ margin: "16px 0" }}>
                <div className="alert-title">
                  Opening cash set to ${(cash / 100).toLocaleString("en-US")}.
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label className="label">Enter It Manually ($)</label>
                <input
                  className="input num"
                  style={{ maxWidth: 200 }}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 250000"
                />
              </div>
              <button
                className="btn btn-ghost"
                disabled={busy || !manual}
                onClick={() =>
                  saveOpeningCash("/opening-cash", {
                    balanceCents: Math.round((Number(manual) || 0) * 100),
                  })
                }
              >
                Save Balance
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => saveOpeningCash("/opening-cash/plaid", {})}
              >
                Connect Bank (Demo)
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="card-title">Connect QuickBooks</div>
            <div style={{ marginTop: 16 }}>
              <a className="btn btn-ghost" href="/integrations">
                Open Connections
              </a>
            </div>
          </>
        )}

        <div className="wizard-actions">
          <button
            className="btn btn-ghost"
            disabled={step === 0 || busy}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={next}>
            {busy ? "Saving…" : step === STEPS.length - 1 ? "Finish Setup" : "Continue"}
          </button>
        </div>
      </section>
    </main>
  );
}
