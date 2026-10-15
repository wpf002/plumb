"use client";

import { Stat } from "../stat";
import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, readGated, usd } from "../ui";
import { Locked } from "../plan-ui";

const range = (r: [number, number]) => `${usd(r[0])} – ${usd(r[1])}`;
const mult = (m: [number, number]) => `${m[0].toFixed(1)}–${m[1].toFixed(1)}x`;


function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = score >= 70 ? "var(--good)" : score >= 50 ? "var(--warn)" : "var(--danger)";
  return (
    <svg viewBox="0 0 84 84" width="84" height="84" role="img" aria-label={`Exit readiness ${score} of 100`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
      <circle cx="42" cy="42" r={r} fill="none" stroke={tone} strokeWidth="8" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 42 42)" strokeLinecap="round" />
      <text x="42" y="48" textAnchor="middle" className="ring-label" fontSize="22">
        {score}
      </text>
    </svg>
  );
}

export function ValueTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/companies/${getCompanyId()}/valuation`, { cache: "no-store" })
      .then(readGated)
      .then((j) => (j ? setData(j) : setError("Needs a full year of books.")))
      .catch(() => setError("Could not load."));
  }, []);

  if (error) return <p className="card empty">{error}</p>;
  if (!data) return <div className="card">Loading…</div>;
  if (data.__locked) return <Locked info={data.__locked} />;
  const v = data.valuation;
  const r = data.readiness;
  const oc = v.ownerComp;

  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="EBITDA Value" value={range(v.ebitdaRange)} />
          <Stat label="SDE Value" value={range(v.sdeRange)} />
          <Stat label="Owner Equity" value={range(v.equityRange)} />
          {v.realEstate && <Stat label="Real Estate" value={usd(v.realEstate.netEquityCents)} />}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-title">{v.year} Earnings</div>
          <table className="table statement">
            <tbody>
              <tr>
                <td>Revenue</td>
                <td className="num">{usd(v.revenueCents)}</td>
              </tr>
              <tr>
                <td>Reported EBITDA</td>
                <td className="num">
                  {usd(v.reportedEbitdaCents)} <span className="muted">({v.ebitdaMarginPct.toFixed(1)}%)</span>
                </td>
              </tr>
              <tr>
                <td title={`Owner's overhead pay ${usd(oc.opexUnburdenedCents)} vs ${usd(oc.marketSalaryCents)} market manager salary`}>Owner Pay Above Market</td>
                <td className="num">{usd(oc.addbackCents)}</td>
              </tr>
              {v.oneTimeAddbacksCents > 0 && (
                <tr>
                  <td>One-Time Expenses</td>
                  <td className="num">{usd(v.oneTimeAddbacksCents)}</td>
                </tr>
              )}
              <tr className="statement-subtotal">
                <td>Normalized EBITDA</td>
                <td className="num">{usd(v.normalizedEbitdaCents)}</td>
              </tr>
              <tr>
                <td>Owner Pay in Overhead</td>
                <td className="num">{usd(oc.opexBurdenedCents)}</td>
              </tr>
              {oc.perksCents > 0 && (
                <tr>
                  <td>Owner Perks</td>
                  <td className="num">{usd(oc.perksCents)}</td>
                </tr>
              )}
              <tr className="statement-subtotal">
                <td>SDE</td>
                <td className="num">{usd(v.sdeCents)}</td>
              </tr>
            </tbody>
          </table>
          
        </section>

        <section className="card">
          <div className="row-between">
            <div className="card-title" style={{ marginBottom: 0 }}>
              Exit Readiness
            </div>
            <ScoreRing score={r.score} />
          </div>
          <table className="table">
            <tbody>
              {r.factors.map((f: any) => (
                <tr key={f.key}>
                  <td className="cell-name">
                    {f.name}
                  </td>
                  <td style={{ width: "40%" }}>
                    <div className="aging-bar" style={{ margin: 0 }}>
                      <span style={{ width: `${f.score * 10}%`, background: f.score >= 7 ? "var(--good)" : f.score >= 5 ? "var(--warn)" : "var(--danger)" }} />
                    </div>
                  </td>
                  <td className="num">{f.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <div className="card-title">Value Drivers</div>
        <ol className="action-list">
          {r.topActions.map((a: string) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </section>
    </>
  );
}
