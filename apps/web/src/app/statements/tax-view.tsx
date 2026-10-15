"use client";

import { usd } from "../ui";

/** The CPA's year-end package: summary, suggested tax lines, contractors, payroll, assets. */
export function TaxView({ data }: { data: any }) {
  const s = data.summary;
  return (
    <>
      <section className="card">
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Gross Receipts</div>
            <div className="stat-value num">{usd(s.revenueCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Net Income</div>
            <div className={`stat-value num${s.netIncomeCents < 0 ? " neg" : ""}`}>{usd(s.netIncomeCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Payroll</div>
            <div className="stat-value num">{usd(s.payrollCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Contractors</div>
            <div className="stat-value num">{usd(s.contractorCents)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Owner Distributions</div>
            <div className="stat-value num">{usd(s.distributionsCents)}</div>
          </div>
        </div>
      </section>
      <div className="grid-2">
        <section className="card">
          <div className="row-between">
            <div className="card-title" style={{ marginBottom: 0 }}>
              By Tax Line
            </div>
            <span className="badge neutral" title="Suggested from account names. Your CPA confirms the mapping and makes tax adjustments.">
              Suggested
            </span>
          </div>
          <table className="table">
            <tbody>
              {data.taxLines.map((l: any) => (
                <tr key={l.line}>
                  <td className="cell-name">{l.line}</td>
                  <td className="num">{usd(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div>
          <section className="card">
            <div className="card-title">Contractors</div>
            {data.contractors.length === 0 ? (
              <p className="empty">No subcontractor payments.</p>
            ) : (
              <table className="table">
                <tbody>
                  {data.contractors.map((c: any) => (
                    <tr key={c.vendor}>
                      <td className="cell-name">{c.vendor}</td>
                      <td className="num">{usd(c.paidCents)}</td>
                      <td>{c.form1099 && <span className="badge info">1099-NEC</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card">
            <div className="card-title">Assets and Depreciation</div>
            <table className="table">
              <tbody>
                <tr>
                  <td className="cell-name">Purchased This Year</td>
                  <td className="num">{usd(s.assetPurchasesCents)}</td>
                </tr>
                <tr>
                  <td className="cell-name">Book Depreciation</td>
                  <td className="num">{usd(s.depreciationCents)}</td>
                </tr>
                <tr>
                  <td className="cell-name">Loan Interest</td>
                  <td className="num">{usd(s.interestCents)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </>
  );
}
