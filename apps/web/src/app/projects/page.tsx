"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId } from "../ui";
import { BacklogView, ChangeOrdersView, EstimatesView, PipelineView, ProfitabilityView, RetainageView, WipView } from "./job-views";
import { PayersTab } from "./payers-tab";

const TABS = [
  { key: "profit", label: "Profitability", path: "jobs", View: ProfitabilityView },
  { key: "estimates", label: "Estimates", path: "jobs/estimates", View: EstimatesView },
  { key: "wip", label: "WIP", path: "jobs/wip", View: WipView },
  { key: "change-orders", label: "Change Orders", path: "jobs/change-orders", View: ChangeOrdersView },
  { key: "retainage", label: "Retainage", path: "jobs/retainage", View: RetainageView },
  { key: "backlog", label: "Backlog", path: "jobs/backlog", View: BacklogView },
  { key: "pipeline", label: "Pipeline", path: "jobs/pipeline", View: PipelineView },
  { key: "payers", label: "Payers", path: null, View: null },
] as const;

type Key = (typeof TABS)[number]["key"];

export default function Jobs() {
  const [tab, setTab] = useState<Key>("profit");
  const [data, setData] = useState<Record<string, any>>({});
  const current = TABS.find((t) => t.key === tab)!;

  useEffect(() => {
    const id = getCompanyId();
    if (!id || !current.path || data[tab]) return;
    apiFetch(`/companies/${id}/${current.path}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData((prev) => ({ ...prev, [tab]: d })));
  }, [tab, current.path, data]);

  const View = current.View as any;
  return (
    <main className="container container-wide">
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
        </div>
        {data.wip?.asOf && <span className="num muted">As of {data.wip.asOf}</span>}
      </div>
      <div className="toolbar">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab${t.key === tab ? " active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "payers" ? <PayersTab /> : !data[tab] ? <div className="card">Loading…</div> : <View data={data[tab]} />}
    </main>
  );
}
