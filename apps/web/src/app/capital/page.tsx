"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd } from "../ui";

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${v.toFixed(d)}%`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : usd(v));
const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : String(Math.round(cents / 100)));
const toCents = (s: string) => Math.round((Number(s.replace(/[$,]/g, "")) || 0) * 100);
const age = (months: number) => (months >= 24 ? `${(months / 12).toFixed(1)} yrs` : `${months} mo`);

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num${tone ? ` ${tone}` : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

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

function RepairReplace({ asset }: { asset: any }) {
  const [v, setV] = useState<Record<string, string>>({});
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
  }, [asset]);
  const { result: r, error } = useCalc("repair-replace", payload(REPAIR_FIELDS, v), Object.keys(v).length > 0);
  return (
    <section className="card">
      <div className="card-title">{asset.name}</div>
      <NumberForm fields={REPAIR_FIELDS} values={v} onChange={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
      {error && <p className="neg">{error}</p>}
      {r && (
        <div className="stats" style={{ marginTop: 16 }}>
          <Stat label="Keep / Year" value={usd(r.keepAnnualCents)} />
          <Stat label="Replace / Year" value={usd(r.replaceAnnualCents)} />
          <Stat label="Verdict" value={r.recommendation === "replace" ? "Replace" : "Keep"} tone={r.recommendation === "replace" ? "neg" : "pos"} sub={`${usd(Math.abs(r.annualDifferenceCents))} a year ${r.recommendation === "replace" ? "saved" : "cheaper to keep"}`} />
          <Stat label="Replace Above" value={usd(r.breakEvenRepairCents)} sub="repairs per year" />
        </div>
      )}
    </section>
  );
}

function FleetTab({ data, raw }: { data: any; raw: any[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!data.assets.length) return <p className="card empty">No vehicles or equipment.</p>;
  const sel = data.assets.find((a: any) => a.id === selected);
  const src = raw.find((a: any) => a.id === selected);
  return (
    <>
      <section className="card">
        <div className="stats">
          <Stat label="Book Value" value={usd(data.netBookValueCents)} sub={`${usd(data.originalCostCents)} cost`} />
          <Stat label="Market Value" value={usd(data.marketValueCents)} />
          <Stat label="Loans" value={usd(data.loanBalanceCents)} sub={data.monthlyPaymentsCents ? `${usd(data.monthlyPaymentsCents)} / month` : undefined} />
          <Stat label="Replace Next" value={data.replacementCandidate ?? "None"} />
        </div>
      </section>
      <section className="card">
        <div className="statement-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="num">Age</th>
                <th className="num">Life Used</th>
                <th className="num">Book</th>
                <th className="num">Market</th>
                <th className="num">Replace Cost</th>
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
                      {a.reasons.length > 0 && (
                        <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                          {a.reasons.join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{age(a.ageMonths)}</td>
                    <td className={`num${a.lifeUsedPct >= 100 ? " neg" : ""}`}>{pct(a.lifeUsedPct, 0)}</td>
                    <td className="num">{usd(a.bookValueCents)}</td>
                    <td className="num">{money(a.marketValueCents)}</td>
                    <td className="num" title={a.replacementCostEstimated ? "Original cost grown 3% a year" : undefined}>
                      {usd(a.replacementCostCents)}
                      {a.replacementCostEstimated && <span className="muted">*</span>}
                    </td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {sel && <RepairReplace asset={{ ...sel, ...src, bookValueCents: sel.bookValueCents, replacementCostCents: sel.replacementCostCents }} />}
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
            <Stat label="Cash Down" value={usd(r.downPaymentCents)} sub={r.cashAfterDownCents !== null ? `${usd(r.cashAfterDownCents)} cash left` : undefined} />
            <Stat label="Payment" value={usd(r.monthlyPaymentCents)} sub="per month" />
            <Stat label="Net Cash / Month" value={usd(r.monthlyCashFlowCents)} tone={r.monthlyCashFlowCents < 0 ? "neg" : "pos"} />
            <Stat label="Year 1 Cash" value={usd(r.year1CashEffectCents)} tone={r.year1CashEffectCents < 0 ? "neg" : "pos"} />
            <Stat label="Breakeven Revenue" value={money(r.breakevenMonthlyRevenueCents)} sub="per month" />
            <Stat label="Payback" value={r.paybackMonths ? `${r.paybackMonths} mo` : "—"} sub={`${usd(r.debtAddedCents)} debt added`} />
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
            <Stat label="Loaded Cost" value={usd(r.monthlyCostCents)} sub={`per month · ${pct(r.burdenPct, 0)} over wages`} />
            <Stat label="Revenue Needed" value={money(r.requiredMonthlyRevenueCents)} sub="per month at your margin" />
            {r.addedCapacityCents !== null && <Stat label="Capacity Added" value={usd(r.addedCapacityCents)} sub={`per year at ${defaults.bestFieldYear} pace`} />}
            {r.coverage !== null && <Stat label="Coverage" value={`${r.coverage.toFixed(1)}x`} sub="capacity vs revenue needed" tone={r.coverage >= 1 ? "pos" : "neg"} />}
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
              <Stat label="New Fixed Costs" value={usd(r.newFixedCostsCents)} sub={`${usd(r.monthlyPaymentCents)} / month loan`} />
              <Stat label="Breakeven Revenue" value={usd(r.breakevenRevenueCents)} sub={`${pct(r.breakevenPctOfCapacity)} of a mature crew`} />
              <Stat label="Year 1 Contribution" value={usd(r.year1ContributionCents)} tone={r.year1ContributionCents < 0 ? "neg" : "pos"} />
              <Stat label="Startup Cash Dip" value={usd(r.startupCashDipCents)} sub={r.cashAfterDipCents !== null ? `${usd(r.cashAfterDipCents)} cash left` : undefined} tone={r.cashAfterDipCents !== null && r.cashAfterDipCents < 0 ? "neg" : undefined} />
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

const TABS = [
  { key: "fleet", label: "Fleet" },
  { key: "buy", label: "Buy Equipment" },
  { key: "hire", label: "Hire" },
  { key: "crew", label: "Add Crew" },
] as const;

export default function Capital() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("fleet");
  const [fleet, setFleet] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<any>(null);

  useEffect(() => {
    const id = getCompanyId();
    if (!id) return;
    const get = (p: string) => apiFetch(`/companies/${id}${p}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    Promise.all([get("/capital/fleet"), get("/capital/defaults"), get("/assets")]).then(([f, d, a]) => {
      setFleet(f);
      setDefaults(d);
      setAssets(a?.assets ?? []);
    });
  }, []);

  return (
    <main className="container container-wide">
      <div className="page-head">
        <div>
          <h1>Capital</h1>
        </div>
        {fleet?.asOf && <span className="num muted">As of {fleet.asOf}</span>}
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
      {!fleet || !defaults ? (
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
        />
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
