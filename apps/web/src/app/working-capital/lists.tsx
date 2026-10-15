"use client";

import { usePaged } from "../pager";
import { shortDate, usd } from "../ui";

/** Every open invoice, most overdue first. */
export function InvoiceList({ rows }: { rows: any[] }) {
  const { rows: page, pager } = usePaged(rows, 15);
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="card-title">Open Invoices</div>
      <table className="table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th className="num">Amount</th>
            <th>Issued</th>
            <th>Due</th>
            <th className="num">Days Out</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {page.map((i) => (
            <tr key={i.id}>
              <td className="cell-name">{i.id}</td>
              <td>{i.party}</td>
              <td className="num">{usd(i.amountCents)}</td>
              <td className="muted">{shortDate(i.issueDate)}</td>
              <td className="muted">{shortDate(i.dueDate)}</td>
              <td className="num">{i.daysOutstanding}</td>
              <td>{i.daysLate > 0 && <span className={`badge ${i.daysLate > 30 ? "bad" : "warn"}`}>{i.daysLate} Days Late</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pager}
    </section>
  );
}

/** Every open bill, due soonest first, with expense type and job. */
export function BillList({ rows }: { rows: any[] }) {
  const { rows: page, pager } = usePaged(rows, 15);
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="card-title">Open Bills</div>
      <table className="table">
        <thead>
          <tr>
            <th>Vendor</th>
            <th className="num">Amount</th>
            <th>Due</th>
            <th>Type</th>
            <th>Job</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {page.map((b) => (
            <tr key={b.id}>
              <td className="cell-name">{b.vendor}</td>
              <td className="num">{usd(b.amountCents)}</td>
              <td className="muted">{shortDate(b.dueDate)}</td>
              <td className="muted">{b.category ?? "—"}</td>
              <td className="muted">{b.job ?? "—"}</td>
              <td>{b.daysLate > 0 && <span className="badge warn">{b.daysLate} Days Late</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pager}
    </section>
  );
}
