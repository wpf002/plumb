"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd, shortDate, C } from "../ui";

// One line per job, answering the two questions an owner actually has: is this
// one making money, and when does it turn into cash.
function marginBadge(m: any) {
  if (m.atRisk) return { cls: "bad", label: "At risk" };
  if (m.marginErosionPct > 0) return { cls: "warn", label: "Slipping" };
  return { cls: "good", label: "On track" };
}

export default function Projects() {
  const [rows, setRows] = useState<any[] | null>(null);

  useEffect(() => {
    const id = getCompanyId();
    if (!id) return;
    apiFetch(`/companies/${id}/projects`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (!rows) {
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
          <h1>Jobs</h1>
          <p>Every open job: margin against the bid, and the next time it bills.</p>
        </div>
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <p className="empty">No open jobs. Sync QuickBooks or add a project to get started.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Client</th>
                <th className="num">Contract</th>
                <th className="num">Margin (Bid → Now)</th>
                <th>Next Billing</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ project, margin, billing }) => {
                const b = marginBadge(margin);
                return (
                  <tr key={project.id}>
                    <td className="cell-name">
                      <Link href={`/projects/${project.id}`}>{project.name}</Link>
                      {billing?.totalSlipDays > 0 && (
                        <div style={{ fontSize: 12, color: C.red, fontWeight: 400 }}>
                          {billing.totalSlipDays} days of billing slip
                        </div>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)" }}>
                      {project.client}
                      <div style={{ fontSize: 12, color: "var(--faint)" }}>
                        {project.clientType === "GC" ? "through a GC" : "owner direct"}
                      </div>
                    </td>
                    <td className="num">{usd(project.contractValueCents)}</td>
                    <td className="num">
                      {margin.originalMarginPct.toFixed(1)}% →{" "}
                      <b style={{ color: margin.marginErosionPct > 0 ? C.red : C.green }}>
                        {margin.projectedFinalMarginPct.toFixed(1)}%
                      </b>
                      <div style={{ fontSize: 12, color: "var(--faint)" }}>
                        {usd(margin.adjustedContractCents - margin.projectedFinalCostCents)}{" "}
                        projected profit
                      </div>
                    </td>
                    <td>
                      {billing?.nextMilestone ? (
                        <>
                          {shortDate(billing.nextMilestone.expectedDate)}
                          <div style={{ fontSize: 12, color: "var(--faint)" }}>
                            {billing.nextMilestone.name} · {usd(billing.nextMilestone.amountCents)}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: "var(--faint)" }}>no schedule</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${b.cls}`}>{b.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
