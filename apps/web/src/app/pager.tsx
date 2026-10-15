"use client";

import { useEffect, useState } from "react";

/** Client-side paging for long tables. Resets to the first page when the rows change. */
export function usePaged<T>(rows: T[], size = 20) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => setPage(0), [rows.length]);
  const current = Math.min(page, pages - 1);
  return {
    rows: rows.slice(current * size, current * size + size),
    pager:
      pages > 1 ? (
        <div className="pager">
          <span className="muted">
            {current * size + 1}–{Math.min(rows.length, current * size + size)} of {rows.length}
          </span>
          <span className="pager-buttons">
            <button className="btn btn-ghost btn-xs" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <button className="btn btn-ghost btn-xs" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </button>
          </span>
        </div>
      ) : null,
  };
}
