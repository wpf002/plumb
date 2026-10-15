"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, readGated } from "../ui";
import { Locked } from "../plan-ui";
import { BenchmarksView, CapacityView, CustomersView, LaborView, RecurringView, ServiceCallsView, ServiceLinesView } from "./ops-views";

const TABS = [
  { key: "lines", label: "Service Lines", path: "service-lines", View: ServiceLinesView },
  { key: "customers", label: "Customers", path: "customers", View: CustomersView },
  { key: "labor", label: "Crews & Labor", path: "labor", View: LaborView },
  { key: "capacity", label: "Capacity", path: "capacity", View: CapacityView },
  { key: "recurring", label: "Recurring Revenue", path: "recurring", View: RecurringView },
  { key: "calls", label: "Service Calls", path: "service-calls", View: ServiceCallsView },
  { key: "benchmarks", label: "Benchmarks", path: "benchmarks", View: BenchmarksView },
] as const;

type Key = (typeof TABS)[number]["key"];

export default function Operations() {
  const [tab, setTab] = useState<Key>("lines");
  const [data, setData] = useState<Record<string, any>>({});
  const current = TABS.find((t) => t.key === tab)!;

  useEffect(() => {
    const id = getCompanyId();
    if (!id || tab in data) return;
    apiFetch(`/companies/${id}/operations/${current.path}`, { cache: "no-store" })
      .then(readGated)
      .then((d) => setData((prev) => ({ ...prev, [tab]: d })));
  }, [tab, current.path, data]);

  const View = current.View as any;
  return (
    <main className="container container-wide">
      <div className="page-head">
        <div>
          <h1>Operations</h1>
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
      </div>
      {!(tab in data) ? <div className="card">Loading…</div> : data[tab]?.__locked ? <Locked info={data[tab].__locked} /> : <View data={data[tab]} />}
    </main>
  );
}
