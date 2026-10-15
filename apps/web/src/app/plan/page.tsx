"use client";

import { Stat } from "../stat";
import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, readGated, shortDate, usd } from "../ui";
import { Locked } from "../plan-ui";
import { ValueTab } from "./value";
import { WhatIf } from "./what-if";

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${v.toFixed(d)}%`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : usd(v));
const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : String(Math.round(cents / 100)));
const toCents = (s: string) => Math.round((Number(s.replace(/[$,]/g, "")) || 0) * 100);
const age = (months: number) => (months >= 24 ? `${(months / 12).toFixed(1)} yrs` : `${months} mo`);


type Field = { key: string; label: string; unit: "$" | "%" | "mo" | "#" | "days" };

/** A form of numeric inputs; dollars are edited as whole dollars and sent as cents. */
function NumberForm({ fields, values, onChange }: { fields: Field[]; values: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="field-grid">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="label">
            {f.label}
            {f.unit !== "#" && <span className="muted"> ({f.unit})</span>}
          </label>
          <input className="input num" inputMode="decimal" value={values[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)} />
        </div>
      ))}
    </div>
  );
}

function payload(fields: Field[], values: Record<string, string>) {
  const out: Record<string, number> = {};
  for (const f of fields) {
    const raw = values[f.key];
    if (raw === undefined || raw.trim() === "") continue;
    out[f.key] = f.unit === "$" ? toCents(raw) : Number(raw);
  }
  return out;
}

/** Re-run a calculation shortly after the inputs stop changing. */
function useCalc(path: string, body: any, ready: boolean) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      const res = await apiFetch(`/companies/${getCompanyId()}/capital/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(j);
        setError(null);
      } else setError(j.message ?? "Check the inputs.");
    }, 300);
    return () => clearTimeout(t);
  }, [path, key, ready]);
  return { result, error };
}

const STATUS: Record<string, { cls: string; label: string }> = {
  replace: { cls: "bad", label: "Replace Soon" },
  watch: { cls: "warn", label: "Watch" },
  keep: { cls: "good", label: "Keep" },
};

const REPAIR_FIELDS: Field[] = [
  { key: "annualRepairCents", label: "Repairs / Year", unit: "$" },
  { key: "annualMaintenanceCents", label: "Maintenance / Year", unit: "$" },
  { key: "downtimeDaysAnnual", label: "Days Down / Year", unit: "days" },
  { key: "downtimeCostPerDayCents", label: "Lost Profit / Day Down", unit: "$" },
  { key: "marketValueCents", label: "Trade-In Value", unit: "$" },
  { key: "replacementCostCents", label: "Replacement Cost", unit: "$" },
  { key: "newUsefulLifeMonths", label: "New Asset Life", unit: "mo" },
  { key: "newSalvagePct", label: "Salvage", unit: "%" },
  { key: "financeRatePct", label: "Finance Rate", unit: "%" },
];

const COST_FIELDS: Field[] = [
  { key: "fuelCostAnnualCents", label: "Fuel / Year", unit: "$" },
  { key: "insuranceCostAnnualCents", label: "Insurance / Year", unit: "$" },
  { key: "utilizationPct", label: "Utilization", unit: "%" },
];

function RepairReplace({ asset, onSaved }: { asset: any; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setV({
      annualRepairCents: dollars(asset.annualRepairCents ?? 0),
      annualMaintenanceCents: dollars(asset.annualMaintenanceCents ?? 0),
      downtimeDaysAnnual: String(asset.downtimeDaysAnnual ?? 0),
      downtimeCostPerDayCents: "0",
      marketValueCents: dollars(asset.marketValueCents ?? asset.bookValueCents),
      replacementCostCents: dollars(asset.replacementCostCents),
      newUsefulLifeMonths: String(asset.usefulLifeMonths ?? 84),
      newSalvagePct: "10",
      financeRatePct: "8",
    });
    setCosts({
      fuelCostAnnualCents: dollars(asset.annualFuelCents),
      insuranceCostAnnualCents: dollars(asset.annualInsuranceCents),
      utilizationPct: asset.utilizationPct == null ? "" : String(asset.utilizationPct),
    });
    setSaved(false);
  }, [asset]);

  // Repairs, upkeep, downtime, replacement cost, and running costs stay on the asset.
  async function save() {
    const r = payload(REPAIR_FIELDS, v);
    const c = payload(COST_FIELDS, costs);
    await apiFetch(`/companies/${getCompanyId()}/assets/${asset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repairCostAnnualCents: r.annualRepairCents ?? null,
        maintenanceCostAnnualCents: r.annualMaintenanceCents ?? null,
        downtimeDaysAnnual: r.downtimeDaysAnnual ?? null,
        replacementCostCents: r.replacementCostCents ?? null,
        fuelCostAnnualCents: c.fuelCostAnnualCents ?? null,
        insuranceCostAnnualCents: c.insuranceCostAnnualCents ?? null,
        utilizationPct: c.utilizationPct ?? null,
      }),
    });
    setSaved(true);
    onSaved();
  }
  const { result: r, error } = useCalc("repair-replace", payload(REPAIR_FIELDS, v), Object.keys(v).length > 0);
  return (
    <section className="card">
      <div className="card-title">{asset.name}</div>
      <NumberForm fields={REPAIR_FIELDS} values={v} onChange={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
      <div style={{ marginTop: 16 }}>
        <NumberForm fields={COST_FIELDS} values={costs} onChange={(k, val) => setCosts((p) => ({ ...p, [k]: val }))} />
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn btn-primary btn-xs" onClick={save}>
          Save Costs
        </button>
        {saved && <span className="badge good">Saved</span>}
      </div>
      {error && <p className="neg">{error}</p>}
      {r && (
        <div className="stats" style={{ marginTop: 16 }}>
          <Stat label="Keep / Year" value={usd(r.keepAnnualCents)} />
          <Stat label="Replace / Year" value={usd(r.replaceAnnualCents)} />
          <Stat label="Verdict" value={r.recommendation === "replace" ? "Replace" : "Keep"} tone={r.recommendation === "replace" ? "neg" : "pos"} />
          <Stat label="Replace Above" value={usd(r.breakEvenRepairCents)} />
        </div>
      )}
    </section>
  );
}

const runningCost = (a: any) => {
  const parts = [a.annualMaintenanceCents, a.annualRepairCents, a.annualFuelCents, a.annualInsuranceCents].filter((x) => x != null);
  return parts.length ? usd(parts.reduce((t: number, x: number) => t + x, 0)) : "—";
};

function FleetTab({ data, raw, onSaved }: { data: any; raw: any[]; onSaved: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!data.assets.length) return <p className="card empty">No vehicles or equipment.</p>;
  const sel = data.assets.find((a: any) => a.id === selected);
  const src = raw.find((a: any) => a.id === selected);
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Book Value" value={usd(data.netBookValueCents)} />
          <Stat label="Market Value" value={usd(data.marketValueCents)} />
          <Stat label="Loans" value={usd(data.loanBalanceCents)} />
          <Stat label="Replace Next" value={data.replacementCandidate ?? "None"} />
        </div>
      </section>
      <section className="card">
        <div className="statement-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Purchased</th>
                <th className="num">Cost</th>
                <th className="num">Book</th>
                <th className="num">Market</th>
                <th className="num">Loan</th>
                <th className="num">Payment</th>
                <th className="num">Running / Yr</th>
                <th className="num">Use</th>
                <th className="num">Life Used</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a: any) => {
                const s = STATUS[a.status];
                return (
                  <tr key={a.id} className={`row-click${a.id === selected ? " row-selected" : ""}`} onClick={() => setSelected(a.id === selected ? null : a.id)}>
                    <td className="cell-name" style={{ minWidth: 220 }}>
                      {a.name}
                      
                    </td>
                    <td className="muted nowrap" title={age(a.ageMonths)}>{shortDate(a.purchaseDate)}</td>
                    <td className="num">{usd(a.costCents)}</td>
                    <td className="num">{usd(a.bookValueCents)}</td>
                    <td className="num">{money(a.marketValueCents)}</td>
                    <td className="num">{a.loanBalanceCents ? usd(a.loanBalanceCents) : "—"}</td>
                    <td className="num">{a.monthlyPaymentCents ? usd(a.monthlyPaymentCents) : "—"}</td>
                    <td className="num" title="Maintenance, repairs, fuel, and insurance">{runningCost(a)}</td>
                    <td className="num">{a.utilizationPct == null ? "—" : pct(a.utilizationPct, 0)}</td>
                    <td className={`num${a.lifeUsedPct >= 100 ? " neg" : ""}`}>{pct(a.lifeUsedPct, 0)}</td>
                    <td>
                      <span className={`badge ${s.cls}`} title={a.reasons.join(", ")}>
                        {s.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {sel && <RepairReplace asset={{ ...src, ...sel }} onSaved={onSaved} />}
    </>
  );
}

const BUY_FIELDS: Field[] = [
  { key: "priceCents", label: "Price", unit: "$" },
  { key: "downPct", label: "Down Payment", unit: "%" },
  { key: "ratePct", label: "Rate", unit: "%" },
  { key: "termMonths", label: "Term", unit: "mo" },
  { key: "monthlyRevenueCents", label: "New Revenue / Month", unit: "$" },
  { key: "grossMarginPct", label: "Gross Margin", unit: "%" },
  { key: "monthlyOperatingCents", label: "Operating Cost / Month", unit: "$" },
  { key: "usefulLifeMonths", label: "Useful Life", unit: "mo" },
];

function BuyTab({ defaults }: { defaults: any }) {
  const [v, setV] = useState<Record<string, string>>({
    priceCents: "60000",
    downPct: "20",
    ratePct: "8",
    termMonths: "60",
    monthlyRevenueCents: "10000",
    grossMarginPct: defaults.grossMarginPct?.toFixed(1) ?? "30",
    monthlyOperatingCents: "600",
    usefulLifeMonths: "84",
  });
  const { result: r, error } = useCalc("purchase", payload(BUY_FIELDS, v), true);
  return (
    <>
      <section className="card">
        <NumberForm fields={BUY_FIELDS} values={v} onChange={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
        {error && <p className="neg">{error}</p>}
      </section>
      {r && (
        <section className="card">
          <div className="stats">
            <Stat label="Cash Down" value={usd(r.downPaymentCents)} />
            <Stat label="Payment" value={usd(r.monthlyPaymentCents)} />
            <Stat label="Net Cash / Month" value={usd(r.monthlyCashFlowCents)} tone={r.monthlyCashFlowCents < 0 ? "neg" : "pos"} />
            <Stat label="Year 1 Cash" value={usd(r.year1CashEffectCents)} tone={r.year1CashEffectCents < 0 ? "neg" : "pos"} />
            <Stat label="Breakeven Revenue" value={money(r.breakevenMonthlyRevenueCents)} />
            <Stat label="Payback" value={r.paybackMonths ? `${r.paybackMonths} mo` : "—"} />
          </div>
        </section>
      )}
    </>
  );
}

const HIRE_FIELDS: Field[] = [
  { key: "count", label: "People", unit: "#" },
  { key: "annualWageCents", label: "Wage / Year", unit: "$" },
  { key: "payrollTaxPct", label: "Payroll Taxes", unit: "%" },
  { key: "workersCompPct", label: "Workers' Comp", unit: "%" },
  { key: "benefitsMonthlyCents", label: "Benefits / Month", unit: "$" },
  { key: "vehicleMonthlyCents", label: "Vehicle / Month", unit: "$" },
  { key: "toolsMonthlyCents", label: "Tools / Month", unit: "$" },
  { key: "grossMarginPct", label: "Gross Margin", unit: "%" },
];

function HireTab({ defaults }: { defaults: any }) {
  const [v, setV] = useState<Record<string, string>>({
    count: "1",
    annualWageCents: dollars(defaults.avgFieldWageCents ?? 5_000_000),
    payrollTaxPct: String(defaults.payrollTaxPct),
    workersCompPct: String(defaults.workersCompPct),
    benefitsMonthlyCents: "0",
    vehicleMonthlyCents: "0",
    toolsMonthlyCents: "0",
    grossMarginPct: defaults.grossMarginPct?.toFixed(1) ?? "30",
  });
  const { result: r, error } = useCalc("hire", payload(HIRE_FIELDS, v), true);
  return (
    <>
      <section className="card">
        <NumberForm fields={HIRE_FIELDS} values={v} onChange={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
        {error && <p className="neg">{error}</p>}
      </section>
      {r && (
        <section className="card">
          <div className="stats">
            <Stat label="Loaded Cost" value={usd(r.monthlyCostCents)} />
            <Stat label="Revenue Needed" value={money(r.requiredMonthlyRevenueCents)} />
            {r.addedCapacityCents !== null && <Stat label="Capacity Added" value={usd(r.addedCapacityCents)} />}
            {r.coverage !== null && <Stat label="Coverage" value={`${r.coverage.toFixed(1)}x`} tone={r.coverage >= 1 ? "pos" : "neg"} />}
          </div>
        </section>
      )}
    </>
  );
}

const CREW_FIELDS: Field[] = [
  { key: "equipmentCents", label: "Equipment", unit: "$" },
  { key: "downPct", label: "Down Payment", unit: "%" },
  { key: "ratePct", label: "Rate", unit: "%" },
  { key: "termMonths", label: "Term", unit: "mo" },
  { key: "insuranceAnnualCents", label: "Insurance / Year", unit: "$" },
  { key: "fuelMaintenanceAnnualCents", label: "Fuel & Upkeep / Year", unit: "$" },
  { key: "burdenedPayrollAnnualCents", label: "Crew Payroll / Year", unit: "$" },
  { key: "matureCapacityCents", label: "Mature Crew Revenue", unit: "$" },
  { key: "grossMarginPct", label: "Gross Margin", unit: "%" },
  { key: "ramp1", label: "Year 1 Ramp", unit: "%" },
  { key: "ramp2", label: "Year 2 Ramp", unit: "%" },
  { key: "ramp3", label: "Year 3 Ramp", unit: "%" },
];

function CrewTab({ defaults }: { defaults: any }) {
  const [v, setV] = useState<Record<string, string>>({
    equipmentCents: "140000",
    downPct: "15",
    ratePct: "8",
    termMonths: "60",
    insuranceAnnualCents: "9600",
    fuelMaintenanceAnnualCents: "14000",
    burdenedPayrollAnnualCents: "300000",
    matureCapacityCents: dollars(defaults.matureCrewCapacityCents ?? 100_000_000),
    grossMarginPct: (defaults.jobMarginPct ?? defaults.grossMarginPct ?? 30).toFixed(1),
    ramp1: "45",
    ramp2: "60",
    ramp3: "72",
  });
  const p = payload(CREW_FIELDS, v);
  const body = { ...p, ramp: [p.ramp1, p.ramp2, p.ramp3].filter((x) => x !== undefined).map((x) => x / 100) };
  delete (body as any).ramp1;
  delete (body as any).ramp2;
  delete (body as any).ramp3;
  const { result: r, error } = useCalc("crew", body, true);
  return (
    <>
      <section className="card">
        <NumberForm fields={CREW_FIELDS} values={v} onChange={(k, val) => setV((s) => ({ ...s, [k]: val }))} />
        {error && <p className="neg">{error}</p>}
      </section>
      {r && (
        <>
          <section className="card">
            <div className="stats">
              <Stat label="New Fixed Costs" value={usd(r.newFixedCostsCents)} />
              <Stat label="Breakeven Revenue" value={usd(r.breakevenRevenueCents)} />
              <Stat label="Year 1 Contribution" value={usd(r.year1ContributionCents)} tone={r.year1ContributionCents < 0 ? "neg" : "pos"} />
              <Stat label="Startup Cash Dip" value={usd(r.startupCashDipCents)} tone={r.cashAfterDipCents !== null && r.cashAfterDipCents < 0 ? "neg" : undefined} />
            </div>
          </section>
          <section className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="num">Ramp</th>
                  <th className="num">Revenue</th>
                  <th className="num">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {r.years.map((y: any) => (
                  <tr key={y.year}>
                    <td className="cell-name">Year {y.year}</td>
                    <td className="num">{pct(y.rampPct, 0)}</td>
                    <td className="num">{usd(y.revenueCents)}</td>
                    <td className={`num${y.contributionCents < 0 ? " neg" : ""}`}>{usd(y.contributionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

const ACQ_FIELDS: Field[] = [
  { key: "priceCents", label: "Price", unit: "$" },
  { key: "targetRevenueCents", label: "Target Revenue", unit: "$" },
  { key: "targetEbitdaCents", label: "Target EBITDA", unit: "$" },
  { key: "downPct", label: "Down Payment", unit: "%" },
  { key: "ratePct", label: "Rate", unit: "%" },
  { key: "termMonths", label: "Term", unit: "mo" },
  { key: "synergyPct", label: "Synergies", unit: "%" },
];

function AcquisitionTab() {
  const [v, setV] = useState<Record<string, string>>({ priceCents: "1200000", targetRevenueCents: "2000000", targetEbitdaCents: "300000", downPct: "20", ratePct: "9", termMonths: "120", synergyPct: "0" });
  const { result: r, error } = useCalc("acquisition", payload(ACQ_FIELDS, v), true);
  if (error && /plan/i.test(error)) return <Locked info={{ message: error, plan: "BUSINESS" }} />;
  return (
    <>
      <section className="card">
        <NumberForm fields={ACQ_FIELDS} values={v} onChange={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
        {error && <p className="neg">{error}</p>}
      </section>
      {r && (
        <section className="card">
          <div className="stats">
            <Stat label="Multiple Paid" value={r.multiplePaid === null ? "—" : `${r.multiplePaid.toFixed(1)}x`} />
            <Stat label="Cash at Close" value={usd(r.downPaymentCents)} />
            <Stat label="Cash Left" value={usd(r.cashAfterCloseCents)} tone={r.cashAfterCloseCents < 0 ? "neg" : undefined} />
            <Stat label="Monthly Payment" value={usd(r.monthlyPaymentCents)} />
            <Stat label="Combined EBITDA" value={usd(r.combinedEbitdaCents)} />
            <Stat label="Debt Coverage" value={r.combinedDscr === null ? "—" : `${r.combinedDscr.toFixed(2)}x`} tone={r.combinedDscr !== null && r.combinedDscr < 1.25 ? "neg" : undefined} />
            <Stat label="Payback" value={r.paybackYears === null ? "—" : `${r.paybackYears} yrs`} />
            <Stat label="Value Added" value={usd(r.valueAddedCents)} tone={r.valueAddedCents < 0 ? "neg" : "pos"} />
          </div>
        </section>
      )}
    </>
  );
}

const TABS = [
  { key: "what-if", label: "Scenarios" },
  { key: "value", label: "Valuation" },
  { key: "fleet", label: "Fleet" },
  { key: "buy", label: "Equipment Purchase" },
  { key: "hire", label: "Hiring" },
  { key: "crew", label: "Crew Expansion" },
  { key: "acquisition", label: "Acquisition" },
] as const;

export default function Plan() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("what-if");
  const [fleet, setFleet] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<any>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const id = getCompanyId();
    if (!id) return;
    const get = (p: string) => apiFetch(`/companies/${id}${p}`, { cache: "no-store" }).then(readGated);
    Promise.all([get("/capital/fleet"), get("/capital/defaults"), get("/assets")]).then(([f, d, a]) => {
      setFleet(f);
      setDefaults(d);
      setAssets(a?.assets ?? []);
    });
  }, [reload]);

  return (
    <main className="container container-wide">
      <div className="page-head">
        <div>
          <h1>Planning</h1>
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
      {tab === "what-if" ? (
        <WhatIf />
      ) : tab === "acquisition" ? (
        <AcquisitionTab />
      ) : tab === "value" ? (
        <ValueTab />
      ) : !fleet || !defaults ? (
        <div className="card">Loading…</div>
      ) : tab === "fleet" ? (
        <FleetTab
          data={fleet}
          raw={assets.map((a) => ({
            id: a.id,
            usefulLifeMonths: a.usefulLifeMonths,
            annualRepairCents: a.repairCostAnnualCents,
            annualMaintenanceCents: a.maintenanceCostAnnualCents,
            downtimeDaysAnnual: a.downtimeDaysAnnual,
          }))}
          onSaved={() => setReload((x) => x + 1)}
        />
      ) : defaults.__locked ? (
        <Locked info={defaults.__locked} />
      ) : tab === "buy" ? (
        <BuyTab defaults={defaults} />
      ) : tab === "hire" ? (
        <HireTab defaults={defaults} />
      ) : (
        <CrewTab defaults={defaults} />
      )}
    </main>
  );
}
