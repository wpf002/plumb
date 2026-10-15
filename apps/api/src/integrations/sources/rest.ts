import type { AdapterContext, CanonicalBatch, SourceAdapter, SourceCategory } from "./types.js";
import { cents, daysAgo, period, rng } from "./sample.js";

/**
 * Most vertical systems are a bearer-token REST or GraphQL API with a few list
 * endpoints. A spec names the endpoints and maps each record into a canonical
 * object; this factory turns the spec into a SourceAdapter with paging,
 * credentials, and a category-appropriate preview sample.
 */

type Kind = keyof CanonicalBatch;
type Item<K extends Kind> = NonNullable<CanonicalBatch[K]>[number];

export interface Resource<K extends Kind = Kind> {
  kind: K;
  /** Path relative to the base URL, or a GraphQL query when `graphql` is set. */
  path: string;
  graphql?: boolean;
  /** Pull the record array out of a response page. */
  list: (json: any) => any[];
  map: (r: any) => Item<K> | Item<K>[] | null;
  /** Next page URL or cursor; null when done. */
  next?: (json: any, page: number) => string | null;
}

export interface RestSpec {
  key: string;
  name: string;
  category: SourceCategory;
  phase: 2 | 3;
  /** Credential names; read from the company's connection, then from env `${KEY}_${NAME}` upper-cased. */
  credentials: string[];
  baseUrl: (c: Record<string, string>) => string;
  headers: (c: Record<string, string>) => Record<string, string>;
  resources: Resource[];
  /** Set when the vendor has no open API; the adapter stays in preview and points to CSV import. */
  noPublicApi?: boolean;
}

const envName = (key: string, cred: string) => `${key}_${cred}`.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();

function credsFor(spec: RestSpec, ctx: AdapterContext): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const c of spec.credentials) {
    const v = ctx.credentials?.[c] ?? process.env[envName(spec.key, c)];
    if (!v) return null;
    out[c] = v;
  }
  return out;
}

export function restAdapter(spec: RestSpec): SourceAdapter {
  return {
    key: spec.key,
    name: spec.name,
    category: spec.category,
    phase: spec.phase,
    env: spec.credentials.map((c) => envName(spec.key, c)),
    provides: [...new Set(spec.resources.map((r) => r.kind))],
    live: (ctx) => !spec.noPublicApi && credsFor(spec, ctx) !== null,
    csvOnly: !!spec.noPublicApi,
    credentialFields: spec.noPublicApi ? [] : spec.credentials,
    async fetch(ctx) {
      const c = credsFor(spec, ctx)!;
      const base = spec.baseUrl(c);
      // Paths may carry credential placeholders such as {tenantId}.
      const fill = (p: string) => p.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(c[k] ?? ""));
      const batch: CanonicalBatch = {};
      for (const res of spec.resources) {
        const items: unknown[] = [];
        let url: string | null = res.graphql ? base : `${base}${fill(res.path)}`;
        for (let page = 0; url && page < 200; page++) {
          const r: Response = await fetch(url, {
            method: res.graphql ? "POST" : "GET",
            headers: { Accept: "application/json", ...(res.graphql && { "Content-Type": "application/json" }), ...spec.headers(c) },
            ...(res.graphql && { body: JSON.stringify({ query: res.path }) }),
          });
          if (!r.ok) throw new Error(`${spec.name} ${res.kind} failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
          const json = await r.json();
          for (const rec of res.list(json)) {
            const m = res.map(rec);
            if (Array.isArray(m)) items.push(...m);
            else if (m) items.push(m);
          }
          const nxt = res.next?.(json, page) ?? null;
          url = nxt ? (nxt.startsWith("http") ? nxt : `${base}${fill(nxt)}`) : null;
        }
        (batch as Record<string, unknown[]>)[res.kind] = [...(((batch as Record<string, unknown[]>)[res.kind]) ?? []), ...items];
      }
      return batch;
    },
    sample: (ctx) => sampleFor(spec, ctx),
  };
}

// ---- preview samples by category ---------------------------------------------

const CUSTOMERS = ["Cedar Ridge HOA", "Greenview Medical", "Lakeside Church", "Rogers-Healy GC", "Northwest ISD", "Patel Residence", "Hill Country Dental"];
const PEOPLE = ["Danny Ruiz", "Marcus Lee", "Ana Ortiz", "Tyler Brooks", "Jen Walsh"];

function sampleFor(spec: RestSpec, ctx: AdapterContext): CanonicalBatch {
  const r = rng(`${spec.key}:${ctx.companyId}`);
  const kinds = new Set(spec.resources.map((x) => x.kind));
  const b: CanonicalBatch = {};
  if (kinds.has("customers")) b.customers = CUSTOMERS.map((name, i) => ({ externalId: `c${i}`, name }));
  if (kinds.has("jobs"))
    b.jobs = Array.from({ length: 8 }, (_, i) => {
      const contract = cents(6_000 + r() * 90_000);
      return { externalId: `j${i}`, name: `${CUSTOMERS[i % 7]} ${["Service Upgrade", "Remodel", "Install", "Retrofit"][i % 4]}`, customerExternalId: `c${i % 7}`, customerName: CUSTOMERS[i % 7], status: i < 3 ? ("CLOSED" as const) : i < 7 ? ("ACTIVE" as const) : ("AWARDED" as const), contractCents: contract, estimatedCostCents: Math.round(contract * (0.62 + r() * 0.15)), startDate: daysAgo(120 - i * 12), endDate: daysAgo(60 - i * 12), percentComplete: i < 3 ? 1 : Math.round(r() * 90) / 100 };
    });
  if (kinds.has("invoices"))
    b.invoices = Array.from({ length: 10 }, (_, i) => ({ externalId: `i${i}`, customerExternalId: `c${i % 7}`, customerName: CUSTOMERS[i % 7], jobExternalId: kinds.has("jobs") ? `j${i % 8}` : null, issueDate: daysAgo(8 + i * 10), dueDate: daysAgo(8 + i * 10 - 30), amountCents: cents(900 + r() * 24_000), paidDate: i > 2 && r() > 0.3 ? daysAgo(i * 10 - 20) : null }));
  if (kinds.has("bills")) b.bills = Array.from({ length: 6 }, (_, i) => ({ externalId: `b${i}`, vendorName: ["Ferguson", "Graybar", "Sunbelt Rentals"][i % 3], billDate: daysAgo(6 + i * 12), amountCents: cents(500 + r() * 8_000), paidDate: i > 1 ? daysAgo(i * 12 - 20) : null }));
  if (kinds.has("payroll") || kinds.has("timeEntries")) {
    const now = new Date();
    if (kinds.has("payroll"))
      b.payroll = [1, 2].flatMap((m) => PEOPLE.map((name, i) => ({ employeeExternalId: `e${i}`, employeeName: name, period: period(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1))), grossPayCents: cents((160 + r() * 12) * (24 + i * 3)), regularHours: 160, overtimeHours: Math.round(r() * 12) })));
    if (kinds.has("timeEntries")) b.timeEntries = Array.from({ length: 20 }, (_, i) => ({ employeeExternalId: `e${i % 5}`, employeeName: PEOPLE[i % 5], jobExternalId: null, date: daysAgo(i), hours: 7 + Math.round(r() * 3), overtimeHours: r() > 0.8 ? 2 : 0 }));
  }
  if (kinds.has("transactions")) b.transactions = Array.from({ length: 25 }, (_, i) => ({ externalId: `t${i}`, accountExternalId: spec.key, date: daysAgo(i * 2), amountCents: cents(120 + r() * 900), description: "Card payment", kind: "CHARGE" as const }));
  if (kinds.has("opportunities"))
    b.opportunities = Array.from({ length: 6 }, (_, i) => ({ externalId: `o${i}`, description: `${CUSTOMERS[(i + 2) % 7]} ${["Bid", "Proposal", "Estimate"][i % 3]}`, customerName: CUSTOMERS[(i + 2) % 7], valueCents: cents(15_000 + r() * 180_000), probabilityPct: [25, 40, 50, 60, 75, 30][i], expectedStart: daysAgo(-20 - i * 15), expectedClose: daysAgo(-5 - i * 10), status: "OPEN" as const }));
  if (kinds.has("vehicles")) b.vehicles = ["2020 Ford F-150 Work Truck #2", "2024 Ford F-150 Work Truck #3", "Bobcat S650 Skid Steer"].map((name, i) => ({ externalId: `v${i}`, name, odometerMiles: 40_000 + Math.round(r() * 60_000), utilizationPct: 55 + Math.round(r() * 35), fuelCostAnnualCents: cents(4_000 + r() * 6_000), maintenanceCostAnnualCents: cents(900 + r() * 2_500), downtimeDaysAnnual: Math.round(r() * 8) }));
  if (kinds.has("accounts")) b.accounts = [{ externalId: spec.key, name: `${spec.name} Balance`, type: "processor", balanceCents: cents(1_850), asOf: new Date() }];
  return b;
}

// ---- small mapping helpers ----------------------------------------------------------

export const d = (v: unknown) => (v ? new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v)) : null);
export const toCents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
export const status = (s: unknown): "BIDDING" | "AWARDED" | "ACTIVE" | "CLOSED" => {
  const x = String(s ?? "").toLowerCase();
  if (/(complete|closed|done|finished|paid|archived)/.test(x)) return "CLOSED";
  if (/(progress|active|scheduled|dispatched|working|started)/.test(x)) return "ACTIVE";
  if (/(approved|awarded|won|sold|signed)/.test(x)) return "AWARDED";
  return "BIDDING";
};
