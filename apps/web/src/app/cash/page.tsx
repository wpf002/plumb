"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, getCompanyId, usd, centsFrom, shortDate, C } from "../ui";
import { ReconciliationCard } from "../health-ui";
import { Accuracy, RevenueForecast, ThirteenWeek, TwelveMonth } from "./forecast-views";
import { DailyView } from "./daily-view";

const VIEWS = [
  { key: "13w", label: "13-Week" },
  { key: "12m", label: "12-Month" },
  { key: "revenue", label: "Revenue" },
  { key: "daily", label: "Daily" },
  { key: "whatif", label: "Cash Scenarios" },
  { key: "accuracy", label: "Forecast vs Actual" },
] as const;

const HORIZONS = [30, 60, 90, 120, 180, 365];

// Two lines: what you expect, and what happens if every payer runs at their
// own worst. The gap between them is the thing an owner needs to feel.

const emptyWhatIf = {
  kind: "DELAY_PROJECT",
  projectId: "",
  days: "30",
  pct: "-20",
  originId: "",
  principal: "100000",
  ratePct: "9",
  payment: "2100",
  monthlyCost: "8500",
  count: "1",
  cost: "68000",
  down: "10000",
  financePayment: "1150",
};

export default function Cash() {
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>("13w");
  const [horizon, setHorizon] = useState(90);
  const [forecast, setForecast] = useState<any>(null);
  const [options, setOptions] = useState<any>(null);
  const [dataHealth, setDataHealth] = useState<any>(null);
  const [wi, setWi] = useState({ ...emptyWhatIf });
  const [result, setResult] = useState<any>(null);
  const [timing, setTiming] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = getCompanyId();
    if (!id) return;
    const [f, o, h] = await Promise.all([
      apiFetch(`/companies/${id}/forecast?horizon=${horizon}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null
      ),
      apiFetch(`/companies/${id}/scenarios/options`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null
      ),
      apiFetch(`/companies/${id}/data-health`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null
      ),
    ]);
    setForecast(f);
    setOptions(o);
    setDataHealth(h);
    if (o?.projects?.length && !wi.projectId) {
      setWi((f2) => ({ ...f2, projectId: o.projects[0].id, originId: o.projects[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon]);

  useEffect(() => {
    load();
  }, [load]);

  const scenarioBody = useMemo(() => {
    const startDate = new Date().toISOString();
    switch (wi.kind) {
      case "DELAY_PROJECT":
        return { kind: wi.kind, projectId: wi.projectId, days: Number(wi.days) || 0 };
      case "PAYER_LATE":
        return { kind: wi.kind, projectId: wi.projectId, days: Number(wi.days) || 0 };
      case "LOSE_INCOME":
        return { kind: wi.kind, originId: wi.originId };
      case "REVENUE_CHANGE":
        return { kind: wi.kind, pct: Number(wi.pct) || 0 };
      case "NEW_LOAN":
        return {
          kind: wi.kind,
          principalCents: centsFrom(wi.principal),
          ratePct: Number(wi.ratePct) || 0,
          paymentCents: centsFrom(wi.payment),
          frequency: "MONTHLY",
          startDate,
        };
      case "HIRE":
        return {
          kind: wi.kind,
          monthlyCostCents: centsFrom(wi.monthlyCost),
          count: Number(wi.count) || 1,
          startDate,
        };
      default:
        return { kind: wi.kind };
    }
  }, [wi]);

  async function runScenario() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch(
        `/companies/${getCompanyId()}/scenarios?horizon=${Math.max(horizon, 180)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scenarioBody),
        }
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setResult(j);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBuyTiming() {
    setBusy(true);
    setError(null);
    setTiming(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/scenarios/buy-timing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costCents: centsFrom(wi.cost),
          downPaymentCents: centsFrom(wi.down),
          financed: {
            ratePct: Number(wi.ratePct) || 8,
            paymentCents: centsFrom(wi.financePayment),
            frequency: "MONTHLY",
          },
          waitMonths: [0, 3, 6],
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setTiming(j);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!forecast) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }


  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Cash</h1>
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs">
          {VIEWS.map((v) => (
            <button key={v.key} className={`tab${v.key === view ? " active" : ""}`} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "13w" && (
        <>
          <ThirteenWeek />
          {dataHealth && <ReconciliationCard health={dataHealth} />}
        </>
      )}
      {view === "12m" && <TwelveMonth />}
      {view === "revenue" && <RevenueForecast />}
      {view === "accuracy" && <Accuracy />}

      {error && (
        <div className="alert critical" style={{ marginBottom: 16 }}>
          <div className="alert-title">{error}</div>
        </div>
      )}

      {view === "daily" && <DailyView />}

      {view === "whatif" && (
      <>
      {/* What if */}
      <section className="card">
        <div className="card-title">Cash Scenarios</div>

        <div className="field-grid">
          <div>
            <label className="label">Question</label>
            <select className="input" value={wi.kind} onChange={(e) => setWi((f) => ({ ...f, kind: e.target.value }))}>
              <option value="DELAY_PROJECT">A job runs late</option>
              <option value="PAYER_LATE">A payer pays later than usual</option>
              <option value="LOSE_INCOME">I lose this work</option>
              <option value="REVENUE_CHANGE">Revenue changes across the board</option>
              <option value="NEW_LOAN">I take on a loan</option>
              <option value="HIRE">I hire someone</option>
            </select>
          </div>

          {(wi.kind === "DELAY_PROJECT" || wi.kind === "PAYER_LATE") && (
            <>
              <div>
                <label className="label">Which Job</label>
                <select className="input" value={wi.projectId} onChange={(e) => setWi((f) => ({ ...f, projectId: e.target.value }))}>
                  {options?.projects?.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">How Many Days</label>
                <input className="input num" value={wi.days} onChange={(e) => setWi((f) => ({ ...f, days: e.target.value }))} inputMode="numeric" />
              </div>
            </>
          )}

          {wi.kind === "LOSE_INCOME" && (
            <div>
              <label className="label">Which Income</label>
              <select className="input" value={wi.originId} onChange={(e) => setWi((f) => ({ ...f, originId: e.target.value }))}>
                {options?.projects?.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {wi.kind === "REVENUE_CHANGE" && (
            <div>
              <label className="label">Change (%)</label>
              <input className="input num" value={wi.pct} onChange={(e) => setWi((f) => ({ ...f, pct: e.target.value }))} inputMode="decimal" />
            </div>
          )}

          {wi.kind === "NEW_LOAN" && (
            <>
              <div>
                <label className="label">Amount ($)</label>
                <input className="input num" value={wi.principal} onChange={(e) => setWi((f) => ({ ...f, principal: e.target.value }))} inputMode="decimal" />
              </div>
              <div>
                <label className="label">Rate (%)</label>
                <input className="input num" value={wi.ratePct} onChange={(e) => setWi((f) => ({ ...f, ratePct: e.target.value }))} inputMode="decimal" />
              </div>
              <div>
                <label className="label">Monthly Payment ($)</label>
                <input className="input num" value={wi.payment} onChange={(e) => setWi((f) => ({ ...f, payment: e.target.value }))} inputMode="decimal" />
              </div>
            </>
          )}

          {wi.kind === "HIRE" && (
            <>
              <div>
                <label className="label">Cost Per Person ($/mo, All-In)</label>
                <input className="input num" value={wi.monthlyCost} onChange={(e) => setWi((f) => ({ ...f, monthlyCost: e.target.value }))} inputMode="decimal" />
              </div>
              <div>
                <label className="label">How Many</label>
                <input className="input num" value={wi.count} onChange={(e) => setWi((f) => ({ ...f, count: e.target.value }))} inputMode="numeric" />
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={runScenario}>
            {busy ? "Working…" : "Show Me"}
          </button>
        </div>

        {result && (
          <div
            className={`alert ${result.delta.breachAppeared ? "critical" : result.delta.minBalanceCents < 0 ? "warning" : "good"}`}
            style={{ marginTop: 16 }}
          >
            <div style={{ width: "100%" }}>
              <div className="alert-title">{result.description}</div>
              <div className="alert-detail">
                {result.delta.minBalanceCents === 0 &&
                result.delta.endingBalanceCents === 0 &&
                result.delta.stressBreachBefore === result.delta.stressBreachAfter ? (
                  <>
                    Nothing moves. Your tight spot is{" "}
                    {shortDate(result.delta.minBalanceDateBefore)}, which is before this change
                    bites, and the money still lands inside the window. Try a bigger change or a
                    longer horizon to see where it starts to matter.
                  </>
                ) : (
                  <>
                    Your low point goes from {usd(result.base.base.minBalanceCents)} on{" "}
                    {shortDate(result.delta.minBalanceDateBefore)} to{" "}
                    {usd(result.result.base.minBalanceCents)} on{" "}
                    {shortDate(result.delta.minBalanceDateAfter)} &mdash; a{" "}
                    {result.delta.minBalanceCents < 0 ? "drop" : "gain"} of{" "}
                    {usd(Math.abs(result.delta.minBalanceCents))}. You end the window{" "}
                    {result.delta.endingBalanceCents < 0 ? "down" : "up"}{" "}
                    {usd(Math.abs(result.delta.endingBalanceCents))}.
                    {result.delta.breachAppeared &&
                      ` That puts you under your safety floor on ${shortDate(result.delta.breachAfter)}.`}
                    {result.delta.breachCleared && " That clears your safety-floor breach."}
                    {!result.delta.breachAppeared &&
                      result.delta.stressBreachAfter &&
                      result.delta.stressBreachBefore !== result.delta.stressBreachAfter &&
                      ` If your payers also run late, you'd go under the floor on ${shortDate(result.delta.stressBreachAfter)}.`}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Buy now or wait */}
      <section className="card">
        <div className="card-title">Purchase Timing</div>
        <div className="field-grid">
          <div>
            <label className="label">Price ($)</label>
            <input className="input num" value={wi.cost} onChange={(e) => setWi((f) => ({ ...f, cost: e.target.value }))} inputMode="decimal" />
          </div>
          <div>
            <label className="label">Cash Down ($)</label>
            <input className="input num" value={wi.down} onChange={(e) => setWi((f) => ({ ...f, down: e.target.value }))} inputMode="decimal" />
          </div>
          <div>
            <label className="label">Financed Payment ($/mo)</label>
            <input className="input num" value={wi.financePayment} onChange={(e) => setWi((f) => ({ ...f, financePayment: e.target.value }))} inputMode="decimal" />
          </div>
          <div>
            <label className="label">Rate (%)</label>
            <input className="input num" value={wi.ratePct} onChange={(e) => setWi((f) => ({ ...f, ratePct: e.target.value }))} inputMode="decimal" />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={runBuyTiming}>
            {busy ? "Working…" : "Compare Timings"}
          </button>
        </div>

        {timing && (
          <>
            <div className="alert good" style={{ marginTop: 16 }}>
              <div className="alert-title">Best timing: {timing.recommendedLabel}.</div>
            </div>
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Timing</th>
                  <th>Buy On</th>
                  <th className="num">Low Point After</th>
                  <th>Under The Floor?</th>
                </tr>
              </thead>
              <tbody>
                {timing.options.map((o: any) => (
                  <tr key={o.label}>
                    <td className="cell-name">
                      {o.label}
                      {o.label === timing.recommendedLabel && (
                        <span className="badge good" style={{ marginLeft: 8 }}>
                          Best
                        </span>
                      )}
                    </td>
                    <td>{shortDate(o.purchaseDate)}</td>
                    <td className="num">
                      {usd(o.minBalanceCents)}
                    </td>
                    <td>
                      {o.breachDate ? (
                        <span className="badge bad">{shortDate(o.breachDate)}</span>
                      ) : o.stressBreachDate ? (
                        <span className="badge warn">only if payers run late</span>
                      ) : (
                        <span className="badge good">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      </>
      )}
    </main>
  );
}
