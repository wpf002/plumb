"use client";

import { TaxView } from "./tax-view";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd } from "../ui";

const TABS = [
  { key: "income", label: "Profit & Loss" },
  { key: "balance", label: "Balance Sheet" },
  { key: "cash-flow", label: "Cash Flow" },
  { key: "budget", label: "Budget vs Actual" },
  { key: "tax", label: "Tax" },
] as const;

const VIEWS = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "annual", label: "Annual" },
  { key: "ytd", label: "YTD" },
  { key: "t12", label: "T12" },
] as const;

const COMPARE = [
  { key: "none", label: "No Comparison" },
  { key: "prior_year", label: "Prior Year" },
  { key: "prior_period", label: "Prior Period" },
  { key: "budget", label: "Budget" },
] as const;

type Tab = (typeof TABS)[number]["key"];

const BUDGET_LINES: Record<string, string> = {
  REVENUE: "Revenue",
  DIRECT_COST: "Direct Costs",
  GROSS_PROFIT: "Gross Profit",
  OPEX: "Operating Expenses",
  NET_INCOME: "Net Income",
  CAPEX: "Capital Spending",
};
const BUDGET_ORDER = Object.keys(BUDGET_LINES);
const COST_LINES = new Set(["DIRECT_COST", "OPEX", "CAPEX"]);

function Cell({ v, strong }: { v: number | null | undefined; strong?: boolean }) {
  if (v === null || v === undefined) return <td className="num muted">—</td>;
  return (
    <td className={`num${v < 0 ? " neg" : ""}`} style={strong ? { fontWeight: 700 } : undefined}>
      {usd(v)}
    </td>
  );
}

function Variance({ now, base }: { now: number; base: number | null | undefined }) {
  if (base === null || base === undefined) return <td className="num muted">—</td>;
  const d = now - base;
  const p = base === 0 ? null : (d / Math.abs(base)) * 100;
  return (
    <td className={`num ${d >= 0 ? "pos" : "neg"}`}>
      {p === null ? usd(d) : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`}
    </td>
  );
}

function StatementTable({ data, tab }: { data: any; tab: Tab }) {
  const s = data.statement;
  const comp = data.comparison;
  const budget = data.budget;
  const compareOn = !!comp || !!budget;
  let lastSection = "";
  return (
    <div className="statement-scroll">
      <table className="table statement">
        <thead>
          <tr>
            <th className="statement-label">Line</th>
            {s.columns.map((c: any) => (
              <th key={c.label} className="num" colSpan={compareOn ? 2 : 1}>
                {c.label}
              </th>
            ))}
            {tab === "income" && !compareOn && <th className="num">% Rev</th>}
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l: any) => {
            const header = l.section !== lastSection && l.kind === "line";
            lastSection = l.section;
            const base = (i: number) =>
              comp ? comp.lines.find((x: any) => x.key === l.key)?.values[i] : budget?.[l.key]?.[i];
            return [
              header ? (
                <tr key={`${l.key}-h`} className="statement-section">
                  <td colSpan={1 + s.columns.length * (compareOn ? 2 : 1) + (tab === "income" && !compareOn ? 1 : 0)}>{l.section}</td>
                </tr>
              ) : null,
              <tr key={l.key} className={l.kind === "subtotal" ? "statement-subtotal" : undefined}>
                <td className="statement-label">{l.label}</td>
                {l.values.map((v: number, i: number) =>
                  compareOn
                    ? [<Cell key={`v${i}`} v={v} strong={l.kind === "subtotal"} />, <Variance key={`d${i}`} now={v} base={base(i)} />]
                    : [<Cell key={`v${i}`} v={v} strong={l.kind === "subtotal"} />]
                )}
                {tab === "income" && !compareOn && (
                  <td className="num muted">{l.pctOfRevenue ? `${l.pctOfRevenue.at(-1).toFixed(1)}%` : ""}</td>
                )}
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Download a CSV the API builds (lender or tax package). */
async function downloadCsv(path: string) {
  const res = await apiFetch(`/companies/${getCompanyId()}/${path}`, { cache: "no-store" });
  if (!res.ok) return;
  const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "export.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Statements() {
  const [tab, setTab] = useState<Tab>("income");
  const [view, setView] = useState<string>("annual");
  const [compare, setCompare] = useState<string>("none");
  const [taxYear, setTaxYear] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = getCompanyId();
    if (!id) return;
    setError(null);
    const path =
      tab === "tax"
        ? `/companies/${id}/tax-package${taxYear ? `?year=${taxYear}` : ""}`
        : tab === "budget"
        ? `/companies/${id}/budget-vs-actual`
        : `/companies/${id}/statements/${tab}?view=${view}&compare=${tab === "income" ? compare : compare === "prior_year" ? "prior_year" : "none"}`;
    const res = await apiFetch(path, { cache: "no-store" });
    const j = await res.json();
    if (!res.ok) setError(j.message ?? `Failed (${res.status})`);
    else setData(j);
  }, [tab, view, compare, taxYear]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const noLedger = data && data.hasLedger === false;

  return (
    <main className="container container-wide">
      <div className="page-head">
        <div>
          <h1>Statements</h1>
        </div>
        <div className="toolbar-right" style={{ alignItems: "center" }}>

          <button className="btn btn-ghost btn-xs" onClick={() => downloadCsv("lender-package?format=csv")}>
            Lender Package
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab${t.key === tab ? " active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === "tax" && data?.summary && (
          <div className="toolbar-right">
            <select className="input input-sm" value={data.year} onChange={(e) => setTaxYear(Number(e.target.value))} aria-label="Tax year">
              {data.years.map((y: number) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button className="btn btn-primary btn-xs" onClick={() => downloadCsv(`tax-package?year=${data.year}&format=csv`)}>
              Download for CPA
            </button>
          </div>
        )}
        {tab !== "budget" && tab !== "tax" && (
          <div className="toolbar-right">
            <select className="input input-sm" value={view} onChange={(e) => setView(e.target.value)} aria-label="Period">
              {VIEWS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
            <select className="input input-sm" value={compare} onChange={(e) => setCompare(e.target.value)} aria-label="Comparison">
              {COMPARE.filter((c) => tab === "income" || c.key === "none" || c.key === "prior_year").map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="alert critical" style={{ marginBottom: 16 }}>
          <div className="alert-title">{error}</div>
        </div>
      )}

      {!data ? (
        <div className="card">Loading…</div>
      ) : noLedger ? (
        <section className="card">
          <p className="empty">
            No ledger data. <Link href="/integrations">Import</Link>
          </p>
        </section>
      ) : tab === "tax" ? (
        // The previous tab's data can still be in state for one render.
        data.summary ? <TaxView data={data} /> : <div className="card">Loading…</div>
      ) : tab === "budget" ? (
        <section className="card">
          <div className="row-between">
            <div className="card-title" style={{ marginBottom: 0 }}>
              Budget vs Actual
            </div>
            {data.years?.length > 0 && (
              <span className="num muted">{data.year}</span>
            )}
          </div>
          {data.lines.length === 0 ? (
            <p className="empty">No budget.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="num">Budget</th>
                  <th className="num">Actual</th>
                  <th className="num">Variance</th>
                  <th>Driver</th>
                </tr>
              </thead>
              <tbody>
                {[...data.lines].sort((a: any, b: any) => BUDGET_ORDER.indexOf(a.line) - BUDGET_ORDER.indexOf(b.line)).map((l: any) => (
                  <tr key={l.line}>
                    <td className="cell-name">{BUDGET_LINES[l.line] ?? l.line}</td>
                    <td className="num">{usd(l.budget)}</td>
                    <td className="num">{usd(l.actual)}</td>
                    <td className={`num ${(COST_LINES.has(l.line) ? -l.variance : l.variance) >= 0 ? "pos" : "neg"}`}>
                      {l.variancePct >= 0 ? "+" : ""}
                      {l.variancePct}%
                    </td>
                    <td className="muted">{l.explanation ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <>
          <section className="card">
            <StatementTable data={data} tab={tab} />
          </section>

          {tab === "balance" && data.rollForward && (
            <section className="card">
              <div className="card-title">Equity Roll-Forward</div>
              <div className="stats">
                {[
                  ["Beginning", data.rollForward.beginning],
                  ["Net Income", data.rollForward.netIncome],
                  ["Distributions", data.rollForward.distributions],
                  ["Contributions", data.rollForward.contributions],
                  ["Other Changes", data.rollForward.other],
                  ["Ending", data.rollForward.ending],
                ].map(([label, v]) => (
                  <div className="stat" key={label as string}>
                    <div className="stat-label">{label}</div>
                    <div className={`stat-value num${(v as number) < 0 ? " neg" : ""}`}>{usd(v as number)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "cash-flow" && data.profitVsCash?.length > 0 && (
            <section className="card">
              <div className="card-title">Profit vs Cash</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th className="num">Net Income</th>
                    <th className="num">Cash From Operations</th>
                    <th className="num">Gap</th>
                    <th>Largest Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {data.profitVsCash.map((p: any) => (
                    <tr key={p.label}>
                      <td className="cell-name">{p.label}</td>
                      <td className="num">{usd(p.netIncome)}</td>
                      <td className="num">{usd(p.operatingCashFlow)}</td>
                      <td className={`num ${p.gap >= 0 ? "pos" : "neg"}`}>{usd(p.gap)}</td>
                      <td className="muted">
                        {p.drivers[0] ? `${p.drivers[0].label} ${usd(p.drivers[0].cents)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </main>
  );
}
