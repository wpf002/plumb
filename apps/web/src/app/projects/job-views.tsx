"use client";

import Link from "next/link";
import { shortDate, usd } from "../ui";

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${v.toFixed(d)}%`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : usd(v));

const FLAG: Record<string, { cls: string; label: string }> = {
  on_track: { cls: "good", label: "On Track" },
  at_risk: { cls: "warn", label: "At Risk" },
  over: { cls: "bad", label: "Over Budget" },
  under: { cls: "bad", label: "Under Target" },
  outperform: { cls: "good", label: "Beat Target" },
};

const STATUS: Record<string, string> = { ACTIVE: "Active", AWARDED: "Awarded", CLOSED: "Closed", BIDDING: "Bidding" };

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num${tone ? ` ${tone}` : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function ProfitabilityView({ data }: { data: any }) {
  const names = new Map<string, string>(data.jobs.map((j: any) => [j.externalId ?? j.id, j.name]));
  const p = data.performance;
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Jobs Scored" value={String(p.count)} />
          <Stat label="Under Target" value={String(p.under.count)} sub={p.under.count ? `avg ${pct(p.under.avgActualMarginPct)} margin` : undefined} tone={p.under.count ? "neg" : undefined} />
          <Stat label="Beat Target" value={String(p.over.count)} />
          <Stat label="Worst Miss" value={p.under.count ? `${p.under.maxGapPts.toFixed(1)} pts` : "—"} />
        </div>
      </section>

      <section className="card">
        <div className="card-title">By Job Type</div>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Jobs</th>
              <th className="num">Contract</th>
              <th className="num">Avg Margin</th>
              <th className="num">Labor</th>
              <th className="num">Materials</th>
            </tr>
          </thead>
          <tbody>
            {data.byType.map((t: any) => {
              const mix = data.costMix.find((m: any) => m.category === t.type);
              return (
                <tr key={t.type}>
                  <td className="cell-name">{t.type}</td>
                  <td className="num">{t.count}</td>
                  <td className="num">{usd(t.contractCents)}</td>
                  <td className="num">{pct(t.avgMarginPct)}</td>
                  <td className="num">{pct(mix?.laborPct)}</td>
                  <td className="num">{pct(mix?.materialsPct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {(data.fade.length > 0 || data.standouts.length > 0) && (
        <div className={data.fade.length > 0 && data.standouts.length > 0 ? "grid-2" : undefined}>
          {data.fade.length > 0 && (
            <section className="card">
              <div className="card-title">Margin Fade</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th className="num">Peak</th>
                    <th className="num">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fade.map((f: any) => (
                    <tr key={f.externalId}>
                      <td className="cell-name">{names.get(f.externalId) ?? f.externalId}</td>
                      <td className="num">{pct(f.peakProjectedMarginPct)}</td>
                      <td className="num neg">{pct(f.finalMarginPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {data.standouts.length > 0 && (
            <section className="card">
              <div className="card-title">Standouts</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th className="num">Margin</th>
                    <th className="num">Type Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.standouts.map((s: any) => (
                    <tr key={s.externalId}>
                      <td className="cell-name">{names.get(s.externalId) ?? s.externalId}</td>
                      <td className="num pos">{pct(s.finalMarginPct)}</td>
                      <td className="num">{pct(s.categoryAvgMarginPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      <section className="card">
        <div className="card-title">All Jobs</div>
        {data.jobs.length === 0 ? (
          <p className="empty">No jobs.</p>
        ) : (
          <div className="statement-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th className="num">Contract</th>
                  <th className="num">Gross Profit</th>
                  <th className="num">Target</th>
                  <th className="num">Margin</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.slice(0, 100).map((j: any) => {
                  const f = FLAG[j.flag];
                  return (
                    <tr key={j.id}>
                      <td className="cell-name" style={{ minWidth: 220 }}>
                        <Link href={`/projects/${j.id}`}>{j.name}</Link>
                        {j.type && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{j.type}</div>}
                      </td>
                      <td>{j.customer}</td>
                      <td className="muted">
                        {STATUS[j.status] ?? j.status}
                        {j.status !== "CLOSED" && ` · ${Math.round(j.percentComplete * 100)}%`}
                      </td>
                      <td className="num">{usd(j.revisedContractCents)}</td>
                      <td className={`num${j.projectedGrossProfitCents < 0 ? " neg" : ""}`}>{usd(j.projectedGrossProfitCents)}</td>
                      <td className="num">{j.targetMarginPct ? pct(j.targetMarginPct) : "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {pct(j.projectedMarginPct)}
                      </td>
                      <td>{f && <span className={`badge ${f.cls}`}>{f.label}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

const CAT: Record<string, string> = { LABOR: "Labor", MATERIAL: "Materials", SUBCONTRACT: "Subcontractors", EQUIPMENT: "Equipment", OTHER: "Other" };

export function EstimatesView({ data }: { data: any }) {
  if (data.jobs === 0) return <p className="card empty">No finished jobs with estimates.</p>;
  const gpGap = data.actualGrossProfitCents - data.estimatedGrossProfitCents;
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Finished Jobs" value={String(data.jobs)} />
          <Stat label="Ran 4%+ Over" value={`${data.overruns.count} of ${data.overruns.total}`} tone={data.overruns.count ? "neg" : undefined} />
          <Stat label="Excess Cost" value={usd(data.overruns.grossProfitErodedCents)} />
          <Stat label="Profit vs Bid" value={usd(gpGap)} tone={gpGap < 0 ? "neg" : "pos"} sub={`${usd(data.estimatedGrossProfitCents)} bid → ${usd(data.actualGrossProfitCents)}`} />
        </div>
      </section>

      <section className="card">
        <div className="card-title">By Cost Line</div>
        <table className="table">
          <thead>
            <tr>
              <th>Line</th>
              <th className="num">Estimated</th>
              <th className="num">Actual</th>
              <th className="num">Variance</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l: any) => (
              <tr key={l.category}>
                <td className="cell-name">{CAT[l.category] ?? l.category}</td>
                <td className="num">{usd(l.estimatedCents)}</td>
                <td className="num">{usd(l.actualCents)}</td>
                <td className={`num${l.variancePct > 2 ? " neg" : ""}`}>{l.variancePct === null ? "—" : `${l.variancePct > 0 ? "+" : ""}${l.variancePct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-title">By Job Type</div>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Jobs</th>
              <th className="num">Median Variance</th>
              <th className="num">Jobs Over</th>
              <th className="num">Profit vs Bid</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.types.map((t: any) => (
              <tr key={t.type}>
                <td className="cell-name">{t.type}</td>
                <td className="num">{t.jobs}</td>
                <td className={`num${t.medianCostVariancePct > 3 ? " neg" : ""}`}>{`${t.medianCostVariancePct > 0 ? "+" : ""}${t.medianCostVariancePct.toFixed(1)}%`}</td>
                <td className="num">{pct(t.overrunSharePct, 0)}</td>
                <td className={`num${t.actualGrossProfitCents < t.estimatedGrossProfitCents ? " neg" : ""}`}>{usd(t.actualGrossProfitCents - t.estimatedGrossProfitCents)}</td>
                <td>{t.consistentlyUnderbid && <span className="badge bad" title="Median job runs 3%+ over estimate, or 30%+ of jobs run over">Underbid</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function WipView({ data }: { data: any }) {
  const t = data.totals;
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Contract" value={usd(t.contract)} />
          <Stat label="Earned" value={usd(t.earned)} />
          {data.billingKnown && <Stat label="Billed" value={usd(t.billed)} />}
          {data.billingKnown && <Stat label="Underbilled" value={usd(t.underbilled)} tone={t.underbilled > t.overbilled ? "neg" : undefined} sub={`${usd(t.overbilled)} overbilled`} />}
          {t.retainage > 0 && <Stat label="Retainage" value={usd(t.retainage)} />}
        </div>
      </section>
      <section className="card">
        {data.rows.length === 0 ? (
          <p className="empty">No jobs in progress.</p>
        ) : (
          <div className="statement-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th className="num">Contract</th>
                  <th className="num">Complete</th>
                  <th className="num">Cost to Date</th>
                  <th className="num">Cost to Finish</th>
                  <th className="num">Earned</th>
                  <th className="num">Billed</th>
                  <th className="num">Collected</th>
                  <th className="num">Over / Under</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="cell-name" style={{ minWidth: 220 }}>
                      <Link href={`/projects/${r.id}`}>{r.name}</Link>
                      {r.flags.length > 0 && (
                        <div className="neg" style={{ fontSize: 12, fontWeight: 400 }}>
                          {r.flags.join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="num">{usd(r.revisedContractCents)}</td>
                    <td className="num">{Math.round(r.percentComplete * 100)}%</td>
                    <td className="num">{money(r.costToDateCents)}</td>
                    <td className="num">{money(r.costToCompleteCents)}</td>
                    <td className="num">{usd(r.earnedCents)}</td>
                    <td className="num">{money(r.billedCents)}</td>
                    <td className="num">{money(r.collectedCents)}</td>
                    <td className={`num${r.overUnderCents < 0 ? " neg" : r.overUnderCents > 0 ? " pos" : ""}`}>{money(r.overUnderCents)}</td>
                    <td className="num">
                      {pct(r.projectedMarginPct)}
                      {r.originalMarginPct - r.projectedMarginPct >= 1 && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          bid {pct(r.originalMarginPct)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

const CO_STATUS: Record<string, string> = { APPROVED: "Approved", PENDING: "Pending", REQUESTED: "Requested", REJECTED: "Rejected" };

export function ChangeOrdersView({ data }: { data: any }) {
  const statuses = Object.entries(data.byStatus) as [string, any][];
  const showMargin = data.recent.some((c: any) => c.marginPct !== null);
  if (statuses.length === 0) return <p className="card empty">No change orders.</p>;
  return (
    <>
      <section className="card">
        <div className="stats">
          {statuses.map(([s, v]) => (
            <Stat key={s} label={CO_STATUS[s] ?? s} value={usd(v.valueCents)} sub={`${v.count} change orders`} />
          ))}
          {data.totals.timeImpactDays > 0 && <Stat label="Schedule Impact" value={`${data.totals.timeImpactDays} days`} />}
        </div>
      </section>

      {(data.unapprovedWork.length > 0 || data.lowMargin.length > 0 || data.scopeCreep.length > 0) && (
        <section className="card">
          <div className="card-title">Watch</div>
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Issue</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.unapprovedWork.map((u: any, i: number) => (
                <tr key={`u${i}`}>
                  <td className="cell-name">{u.project}</td>
                  <td className="neg">{u.performed ? "Work done before approval" : `${CO_STATUS[u.status] ?? u.status}, not approved`}</td>
                  <td className="num">{usd(u.valueCents)}</td>
                </tr>
              ))}
              {data.lowMargin.map((l: any, i: number) => (
                <tr key={`l${i}`}>
                  <td className="cell-name">{l.project}</td>
                  <td>Priced at {pct(l.marginPct)} margin</td>
                  <td className="num">{usd(l.valueCents)}</td>
                </tr>
              ))}
              {data.scopeCreep.map((c: any, i: number) => (
                <tr key={`c${i}`}>
                  <td className="cell-name">{c.project}</td>
                  <td>Changes add {pct(c.changesPct)} to contract</td>
                  <td className="num">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="card-title">Recent</div>
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Date</th>
              <th>Status</th>
              <th className="num">Value</th>
              {showMargin && <th className="num">Margin</th>}
            </tr>
          </thead>
          <tbody>
            {data.recent.map((c: any) => (
              <tr key={c.id}>
                <td className="cell-name">
                  {c.project}
                  {c.reason && !c.reason.startsWith("Imported") && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{c.reason}</div>}
                </td>
                <td className="muted">{shortDate(c.date)}</td>
                <td>{CO_STATUS[c.status] ?? c.status}</td>
                <td className="num">{usd(c.valueCents)}</td>
                {showMargin && <td className="num">{pct(c.marginPct)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function RetainageView({ data }: { data: any }) {
  if (data.rows.length === 0) return <p className="card empty">No retainage held.</p>;
  return (
    <section className="card">
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Held" value={usd(data.totalHeldCents)} />
        <Stat label="Due Within 90 Days" value={usd(data.next90Cents)} tone="pos" />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Job</th>
            <th className="num">Rate</th>
            <th className="num">Held</th>
            <th>Expected Release</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: any, i: number) => (
            <tr key={i}>
              <td className="cell-name">{r.project}</td>
              <td className="num">{r.ratePct ? pct(r.ratePct, 0) : "—"}</td>
              <td className="num">{usd(r.heldCents)}</td>
              <td>{shortDate(r.expectedRelease)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function BacklogView({ data }: { data: any }) {
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Signed Backlog" value={usd(data.signedCents)} sub={data.monthsOfCoverage !== null ? `${data.monthsOfCoverage} months of work` : undefined} />
          <Stat label="Weighted Pipeline" value={usd(data.weightedPipelineCents)} />
          <Stat label="Coverage" value={pct(data.coverageOfLastYearRevenuePct)} sub="of last 12 months revenue" />
          {data.capacityMonthsBooked !== null && <Stat label="Crew Booked" value={`${data.capacityMonthsBooked} mo`} />}
        </div>
      </section>
      <section className="card">
        {data.rows.length === 0 ? (
          <p className="empty">No signed work.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th className="num">Contract</th>
                <th className="num">Remaining</th>
                <th>Start</th>
                <th>Finish</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="cell-name">
                    <Link href={`/projects/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{r.customer}</td>
                  <td className="num">{usd(r.contractCents)}</td>
                  <td className="num">{usd(r.remainingCents)}</td>
                  <td className="muted">{shortDate(r.start)}</td>
                  <td className="muted">{shortDate(r.end)}</td>
                  <td className="num">{r.expectedMarginPct ? pct(r.expectedMarginPct) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export function PipelineView({ data }: { data: any }) {
  const lost = Object.entries(data.lostByYear) as [string, number][];
  const reasons = (Object.entries(data.lostReasons) as [string, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Pipeline" value={usd(data.totals.pipelineCents)} sub={`${data.open.length} open`} />
          <Stat label="Weighted" value={usd(data.totals.weightedCents)} />
          <Stat label="Expected Profit" value={usd(data.totals.expectedGrossProfitCents)} sub={`at ${pct(data.totals.historicalMarginPct)} historical margin`} />
        </div>
      </section>
      <section className="card">
        {data.open.length === 0 ? (
          <p className="empty">No open opportunities.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Customer</th>
                <th className="num">Value</th>
                <th className="num">Odds</th>
                <th className="num">Weighted</th>
                <th>Expected Start</th>
              </tr>
            </thead>
            <tbody>
              {data.open.map((o: any) => (
                <tr key={o.id}>
                  <td className="cell-name">{o.opportunity}</td>
                  <td>{o.customer ?? "—"}</td>
                  <td className="num">{usd(o.valueCents)}</td>
                  <td className="num">{pct(o.probabilityPct, 0)}</td>
                  <td className="num">{usd(o.weightedCents)}</td>
                  <td className="muted">{shortDate(o.expectedStart)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {lost.length > 0 && (
        <section className="card">
          <div className="card-title">Lost Work</div>
          <div className="stats">
            {lost.map(([year, cents]) => (
              <Stat key={year} label={year} value={usd(cents)} />
            ))}
          </div>
          {reasons.length > 0 && (
            <table className="table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Reason</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {reasons.map(([r, cents]) => (
                  <tr key={r}>
                    <td className="cell-name">{r}</td>
                    <td className="num">{usd(cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
