"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, getCompanyId } from "./ui";

const LABEL: Record<string, string> = {
  brief: "Weekly Brief",
  denny: "Ask Denny",
  health: "Financial Health",
  attention: "Needs Attention",
  cash: "Cash",
  collisions: "Weeks Worth Watching",
  obligations: "Fixed Obligations",
};

/** Pick and order the dashboard's sections; saved per person. */
export function DashboardCustomize({ widgets, available }: { widgets: string[]; available: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<string[]>(widgets);
  const hidden = available.filter((w) => !list.includes(w));

  const move = (i: number, d: -1 | 1) =>
    setList((l) => {
      const n = [...l];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  async function save() {
    await apiFetch(`/companies/${getCompanyId()}/dashboard-layout`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ widgets: list }) });
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button className="btn btn-ghost btn-xs" onClick={() => setOpen(true)}>
        Customize
      </button>
    );
  return (
    <div className="customize-panel card">
      <div className="card-title">Sections</div>
      {list.map((w, i) => (
        <div key={w} className="customize-row">
          <span>{LABEL[w] ?? w}</span>
          <span>
            <button className="btn btn-ghost btn-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </button>
            <button className="btn btn-ghost btn-xs" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ↓
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => setList((l) => l.filter((x) => x !== w))}>
              Hide
            </button>
          </span>
        </div>
      ))}
      {hidden.map((w) => (
        <div key={w} className="customize-row muted">
          <span>{LABEL[w] ?? w}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setList((l) => [...l, w])}>
            Show
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary btn-xs" onClick={save}>
          Save
        </button>
        <button className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
