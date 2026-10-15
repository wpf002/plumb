import { d, restAdapter, toCents, type RestSpec } from "./rest.js";

/**
 * Phase 3 (D17): fleet telematics, CRM pipelines, backup bank aggregators,
 * and PayPal. Same spec factory and caveat as phase 2: endpoints follow the
 * vendors' public docs and haven't been run against real accounts. Venmo
 * arrives through bank transactions and needs no integration of its own.
 */

const bearer = (c: Record<string, string>) => ({ Authorization: `Bearer ${c.token}` });
const METERS_PER_MILE = 1609.344;

const partnerOnly = (key: string, label: string, category: RestSpec["category"], kinds: RestSpec["resources"][number]["kind"][]): RestSpec => ({
  key,
  name: label,
  category,
  phase: 3,
  credentials: [],
  baseUrl: () => "",
  headers: () => ({}),
  resources: kinds.map((kind) => ({ kind, path: "", list: () => [], map: () => null })),
  noPublicApi: true,
});

const SPECS: RestSpec[] = [
  {
    key: "samsara",
    name: "Samsara",
    category: "fleet",
    phase: 3,
    credentials: ["token"],
    baseUrl: () => "https://api.samsara.com",
    headers: bearer,
    resources: [
      {
        kind: "vehicles",
        path: "/fleet/vehicles/stats?types=obdOdometerMeters,obdEngineSeconds",
        list: (j) => j.data ?? [],
        map: (r) => ({ externalId: r.id, name: r.name, odometerMiles: r.obdOdometerMeters ? Math.round(r.obdOdometerMeters.value / METERS_PER_MILE) : null, engineHours: r.obdEngineSeconds ? Math.round(r.obdEngineSeconds.value / 3600) : null }),
        next: (j) => (j.pagination?.hasNextPage ? `/fleet/vehicles/stats?types=obdOdometerMeters,obdEngineSeconds&after=${encodeURIComponent(j.pagination.endCursor)}` : null),
      },
    ],
  },
  {
    key: "fleetio",
    name: "Fleetio",
    category: "fleet",
    phase: 3,
    credentials: ["token", "accountToken"],
    baseUrl: () => "https://secure.fleetio.com/api/v1",
    headers: (c) => ({ Authorization: `Token ${c.token}`, "Account-Token": c.accountToken }),
    resources: [
      {
        kind: "vehicles",
        path: "/vehicles?per_page=100",
        list: (j) => (Array.isArray(j) ? j : j.records ?? []),
        map: (r) => ({ externalId: String(r.id), name: r.name, odometerMiles: r.current_meter_value ?? null, maintenanceCostAnnualCents: r.service_entries_cost != null ? toCents(r.service_entries_cost) : null, fuelCostAnnualCents: r.fuel_entries_cost != null ? toCents(r.fuel_entries_cost) : null }),
      },
    ],
  },
  {
    key: "motive",
    name: "Motive",
    category: "fleet",
    phase: 3,
    credentials: ["token"],
    baseUrl: () => "https://api.gomotive.com/v1",
    headers: (c) => ({ "X-Api-Key": c.token }),
    resources: [
      {
        kind: "vehicles",
        path: "/vehicles?per_page=100",
        list: (j) => (j.vehicles ?? []).map((v: any) => v.vehicle ?? v),
        map: (r) => ({ externalId: String(r.id), name: r.number ?? `${r.year ?? ""} ${r.make ?? ""} ${r.model ?? ""}`.trim() }),
        next: (j, p) => ((j.vehicles ?? []).length === 100 ? `/vehicles?per_page=100&page_no=${p + 2}` : null),
      },
    ],
  },
  partnerOnly("fordpro", "Ford Pro", "fleet", ["vehicles"]),
  {
    key: "hubspot",
    name: "HubSpot",
    category: "crm",
    phase: 3,
    credentials: ["token"],
    baseUrl: () => "https://api.hubapi.com",
    headers: bearer,
    resources: [
      {
        kind: "opportunities",
        path: "/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,closedate,hs_deal_stage_probability,hs_is_closed_won,hs_is_closed",
        list: (j) => j.results ?? [],
        map: (r) => {
          const p = r.properties ?? {};
          const won = p.hs_is_closed_won === "true";
          const closed = p.hs_is_closed === "true";
          return { externalId: r.id, description: p.dealname ?? `Deal ${r.id}`, valueCents: toCents(p.amount), probabilityPct: Math.round(Number(p.hs_deal_stage_probability ?? 0) * 100), expectedClose: d(p.closedate), status: won ? "WON" : closed ? "LOST" : "OPEN" };
        },
        next: (j) => (j.paging?.next?.after ? `/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,closedate,hs_deal_stage_probability,hs_is_closed_won,hs_is_closed&after=${j.paging.next.after}` : null),
      },
    ],
  },
  {
    key: "salesforce",
    name: "Salesforce",
    category: "crm",
    phase: 3,
    credentials: ["token", "instanceUrl"],
    baseUrl: (c) => c.instanceUrl.replace(/\/$/, ""),
    headers: bearer,
    resources: [
      {
        kind: "opportunities",
        path: `/services/data/v60.0/query?q=${encodeURIComponent("SELECT Id, Name, Amount, Probability, CloseDate, IsWon, IsClosed, Account.Name FROM Opportunity")}`,
        list: (j) => j.records ?? [],
        map: (r) => ({ externalId: r.Id, description: r.Name, customerName: r.Account?.Name ?? null, valueCents: toCents(r.Amount), probabilityPct: Number(r.Probability ?? 0), expectedClose: d(r.CloseDate), status: r.IsWon ? "WON" : r.IsClosed ? "LOST" : "OPEN" }),
        next: (j) => (j.done ? null : j.nextRecordsUrl),
      },
    ],
  },
  {
    key: "jobber_crm",
    name: "Jobber Requests & Quotes",
    category: "crm",
    phase: 3,
    credentials: ["token"],
    baseUrl: () => "https://api.getjobber.com/api/graphql",
    headers: (c) => ({ ...bearer(c), "X-JOBBER-GRAPHQL-VERSION": "2024-04-30" }),
    resources: [
      {
        kind: "opportunities",
        graphql: true,
        path: "{ quotes(first: 100) { nodes { id title quoteStatus amounts { total } client { name } } } }",
        list: (j) => j.data?.quotes?.nodes ?? [],
        map: (r) => ({ externalId: r.id, description: r.title ?? `Quote ${r.id}`, customerName: r.client?.name ?? null, valueCents: toCents(r.amounts?.total), probabilityPct: /approved|converted/i.test(r.quoteStatus) ? 100 : 40, status: /converted|approved/i.test(r.quoteStatus) ? "WON" : /archived|rejected/i.test(r.quoteStatus) ? "LOST" : "OPEN" }),
      },
    ],
  },
  {
    key: "mx",
    name: "MX",
    category: "banking",
    phase: 3,
    credentials: ["clientId", "apiKey", "userGuid"],
    baseUrl: () => "https://api.mx.com",
    headers: (c) => ({ Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.apiKey}`).toString("base64")}`, Accept: "application/vnd.mx.api.v1+json" }),
    resources: [
      {
        kind: "accounts",
        path: "/users/{userGuid}/accounts?records_per_page=100",
        list: (j) => j.accounts ?? [],
        map: (r) => ({ externalId: r.guid, name: r.name, type: /credit/i.test(r.type) ? "credit" : /saving/i.test(r.type) ? "savings" : /loan|mortgage/i.test(r.type) ? "loan" : "checking", balanceCents: toCents(r.balance) * (/credit|loan|mortgage/i.test(r.type) ? -1 : 1), asOf: new Date() }),
      },
      {
        kind: "transactions",
        path: "/users/{userGuid}/transactions?records_per_page=250",
        list: (j) => j.transactions ?? [],
        map: (r) => ({ externalId: r.guid, accountExternalId: r.account_guid, date: d(r.date)!, amountCents: toCents(r.amount) * (r.type === "DEBIT" ? -1 : 1), description: r.description, merchant: r.merchant_guid ? r.description : null, category: r.top_level_category ?? null }),
        next: (j) => (j.pagination && j.pagination.current_page < j.pagination.total_pages ? `/users/{userGuid}/transactions?records_per_page=250&page=${j.pagination.current_page + 1}` : null),
      },
    ],
  },
  partnerOnly("finicity", "Mastercard Open Finance", "banking", ["accounts", "transactions"]),
  {
    key: "paypal",
    name: "PayPal",
    category: "payments",
    phase: 3,
    credentials: ["token"],
    baseUrl: () => "https://api-m.paypal.com",
    headers: bearer,
    resources: [
      {
        kind: "transactions",
        // PayPal limits each request to a 31-day window; the latest month is read here.
        path: `/v1/reporting/transactions?start_date=${new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 19)}Z&end_date=${new Date().toISOString().slice(0, 19)}Z&fields=transaction_info&page_size=500`,
        list: (j) => j.transaction_details ?? [],
        map: (r) => {
          const t = r.transaction_info ?? {};
          const amt = toCents(t.transaction_amount?.value);
          const fee = toCents(t.fee_amount?.value);
          const rows = [{ externalId: t.transaction_id, accountExternalId: "paypal", date: d(t.transaction_initiation_date)!, amountCents: amt, description: t.transaction_subject ?? "PayPal", kind: amt < 0 ? null : ("CHARGE" as const) }];
          if (fee) rows.push({ externalId: `${t.transaction_id}:fee`, accountExternalId: "paypal", date: d(t.transaction_initiation_date)!, amountCents: fee, description: "PayPal fee", kind: "FEE" as any });
          return rows;
        },
      },
    ],
  },
];

export const PHASE3 = SPECS.map(restAdapter);
