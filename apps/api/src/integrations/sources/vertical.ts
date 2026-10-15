import { d, restAdapter, status, toCents, type RestSpec } from "./rest.js";

/**
 * Phase 2 (D16): field service, construction, accounting, payroll, time
 * tracking, payments, and estimating systems. Endpoints and fields follow each
 * vendor's public API docs; live paths have not been exercised against real
 * accounts. Vendors without an open API stay in preview and import through
 * their CSV exports.
 */

const bearer = (c: Record<string, string>) => ({ Authorization: `Bearer ${c.token}` });
const name = (...parts: unknown[]) => parts.filter(Boolean).join(" ").trim() || "Unnamed";
/** Xero's "/Date(1518685950940+0000)/" timestamps. */
const xeroDate = (v: unknown) => {
  const m = String(v ?? "").match(/\/Date\((\d+)/);
  return m ? new Date(Number(m[1])) : d(v);
};

const csvOnly = (key: string, label: string, category: RestSpec["category"], kinds: RestSpec["resources"][number]["kind"][]): RestSpec => ({
  key,
  name: label,
  category,
  phase: 2,
  credentials: [],
  baseUrl: () => "",
  headers: () => ({}),
  resources: kinds.map((kind) => ({ kind, path: "", list: () => [], map: () => null })),
  noPublicApi: true,
});

const SPECS: RestSpec[] = [
  {
    key: "jobber",
    name: "Jobber",
    category: "field_service",
    phase: 2,
    credentials: ["token"],
    baseUrl: () => "https://api.getjobber.com/api/graphql",
    headers: (c) => ({ ...bearer(c), "X-JOBBER-GRAPHQL-VERSION": "2024-04-30" }),
    resources: [
      { kind: "customers", graphql: true, path: "{ clients(first: 100) { nodes { id name } } }", list: (j) => j.data?.clients?.nodes ?? [], map: (r) => ({ externalId: r.id, name: r.name }) },
      {
        kind: "jobs",
        graphql: true,
        path: "{ jobs(first: 100) { nodes { id title jobStatus total startAt endAt client { id name } } } }",
        list: (j) => j.data?.jobs?.nodes ?? [],
        map: (r) => ({ externalId: r.id, name: r.title, customerExternalId: r.client?.id, customerName: r.client?.name, status: status(r.jobStatus), contractCents: toCents(r.total), startDate: d(r.startAt), endDate: d(r.endAt) }),
      },
      {
        kind: "invoices",
        graphql: true,
        path: "{ invoices(first: 100) { nodes { id issuedDate dueDate invoiceStatus amounts { total } client { id name } } } }",
        list: (j) => j.data?.invoices?.nodes ?? [],
        map: (r) => ({ externalId: r.id, customerExternalId: r.client?.id, customerName: r.client?.name, issueDate: d(r.issuedDate)!, dueDate: d(r.dueDate), amountCents: toCents(r.amounts?.total), paidDate: /paid/i.test(r.invoiceStatus) ? d(r.dueDate) : null }),
      },
    ],
  },
  {
    key: "servicetitan",
    name: "ServiceTitan",
    category: "field_service",
    phase: 2,
    credentials: ["token", "tenantId", "appKey"],
    baseUrl: () => "https://api.servicetitan.io",
    headers: (c) => ({ Authorization: c.token, "ST-App-Key": c.appKey }),
    resources: [
      { kind: "customers", path: "/crm/v2/tenant/{tenantId}/customers?pageSize=500", list: (j) => j.data ?? [], map: (r) => ({ externalId: String(r.id), name: r.name }), next: (j, p) => (j.hasMore ? `/crm/v2/tenant/{tenantId}/customers?pageSize=500&page=${p + 2}` : null) },
      {
        kind: "jobs",
        path: "/jpm/v2/tenant/{tenantId}/jobs?pageSize=500",
        list: (j) => j.data ?? [],
        map: (r) => ({ externalId: String(r.id), name: r.jobNumber ? `Job ${r.jobNumber}` : `Job ${r.id}`, customerExternalId: String(r.customerId), status: status(r.jobStatus), contractCents: toCents(r.total), startDate: d(r.createdOn), endDate: d(r.completedOn) }),
        next: (j, p) => (j.hasMore ? `/jpm/v2/tenant/{tenantId}/jobs?pageSize=500&page=${p + 2}` : null),
      },
      {
        kind: "invoices",
        path: "/accounting/v2/tenant/{tenantId}/invoices?pageSize=500",
        list: (j) => j.data ?? [],
        map: (r) => ({ externalId: String(r.id), customerExternalId: r.customer ? String(r.customer.id) : null, customerName: r.customer?.name ?? null, jobExternalId: r.job ? String(r.job.id) : null, issueDate: d(r.invoiceDate)!, dueDate: d(r.dueDate), amountCents: toCents(r.total), paidDate: Number(r.balance) === 0 ? d(r.dueDate) : null }),
        next: (j, p) => (j.hasMore ? `/accounting/v2/tenant/{tenantId}/invoices?pageSize=500&page=${p + 2}` : null),
      },
      {
        kind: "opportunities",
        path: "/sales/v2/tenant/{tenantId}/estimates?pageSize=500",
        list: (j) => j.data ?? [],
        map: (r) => ({ externalId: String(r.id), description: r.name ?? `Estimate ${r.id}`, valueCents: toCents(r.subtotal), probabilityPct: 50, status: /sold/i.test(r.status?.name) ? "WON" : /dismiss/i.test(r.status?.name) ? "LOST" : "OPEN" }),
        next: (j, p) => (j.hasMore ? `/sales/v2/tenant/{tenantId}/estimates?pageSize=500&page=${p + 2}` : null),
      },
    ],
  },
  {
    key: "housecallpro",
    name: "Housecall Pro",
    category: "field_service",
    phase: 2,
    credentials: ["token"],
    baseUrl: () => "https://api.housecallpro.com",
    headers: (c) => ({ Authorization: `Token ${c.token}` }),
    resources: [
      { kind: "customers", path: "/customers?page_size=100", list: (j) => j.customers ?? [], map: (r) => ({ externalId: r.id, name: r.company || name(r.first_name, r.last_name) }), next: (j) => (j.page < j.total_pages ? `/customers?page_size=100&page=${j.page + 1}` : null) },
      {
        kind: "jobs",
        path: "/jobs?page_size=100",
        list: (j) => j.jobs ?? [],
        // Housecall Pro amounts are already in cents.
        map: (r) => ({ externalId: r.id, name: r.description || `Job ${r.invoice_number ?? r.id}`, customerExternalId: r.customer?.id, customerName: r.customer ? r.customer.company || name(r.customer.first_name, r.customer.last_name) : null, status: status(r.work_status), contractCents: Number(r.total_amount ?? 0), startDate: d(r.schedule?.scheduled_start), endDate: d(r.schedule?.scheduled_end) }),
        next: (j) => (j.page < j.total_pages ? `/jobs?page_size=100&page=${j.page + 1}` : null),
      },
    ],
  },
  {
    key: "procore",
    name: "Procore",
    category: "construction",
    phase: 2,
    credentials: ["token", "companyId"],
    baseUrl: () => "https://api.procore.com",
    headers: (c) => ({ ...bearer(c), "Procore-Company-Id": c.companyId }),
    resources: [
      {
        kind: "jobs",
        path: "/rest/v1.0/projects?company_id={companyId}&per_page=100",
        list: (j) => (Array.isArray(j) ? j : []),
        map: (r) => ({ externalId: String(r.id), name: r.name, status: r.active ? "ACTIVE" : "CLOSED", contractCents: toCents(r.total_value), startDate: d(r.start_date), endDate: d(r.completion_date) }),
        next: (j, p) => (Array.isArray(j) && j.length === 100 ? `/rest/v1.0/projects?company_id={companyId}&per_page=100&page=${p + 2}` : null),
      },
    ],
  },
  csvOnly("buildertrend", "Buildertrend", "construction", ["jobs", "opportunities"]),
  {
    key: "freshbooks",
    name: "FreshBooks",
    category: "accounting",
    phase: 2,
    credentials: ["token", "accountId"],
    baseUrl: () => "https://api.freshbooks.com",
    headers: bearer,
    resources: [
      { kind: "customers", path: "/accounting/account/{accountId}/users/clients?per_page=100", list: (j) => j.response?.result?.clients ?? [], map: (r) => ({ externalId: String(r.id), name: r.organization || name(r.fname, r.lname) }), next: (j) => (j.response?.result?.page < j.response?.result?.pages ? `/accounting/account/{accountId}/users/clients?per_page=100&page=${j.response.result.page + 1}` : null) },
      {
        kind: "invoices",
        path: "/accounting/account/{accountId}/invoices/invoices?per_page=100",
        list: (j) => j.response?.result?.invoices ?? [],
        map: (r) => ({ externalId: String(r.id), customerExternalId: String(r.customerid), customerName: r.organization, issueDate: d(r.create_date)!, dueDate: d(r.due_date), amountCents: toCents(r.amount?.amount), paidDate: d(r.date_paid) }),
        next: (j) => (j.response?.result?.page < j.response?.result?.pages ? `/accounting/account/{accountId}/invoices/invoices?per_page=100&page=${j.response.result.page + 1}` : null),
      },
      {
        kind: "bills",
        path: "/accounting/account/{accountId}/expenses/expenses?per_page=100",
        list: (j) => j.response?.result?.expenses ?? [],
        map: (r) => ({ externalId: String(r.id), vendorName: r.vendor || "Expense", billDate: d(r.date)!, amountCents: toCents(r.amount?.amount), paidDate: d(r.date), category: r.category_name ?? null }),
        next: (j) => (j.response?.result?.page < j.response?.result?.pages ? `/accounting/account/{accountId}/expenses/expenses?per_page=100&page=${j.response.result.page + 1}` : null),
      },
    ],
  },
  {
    key: "xero",
    name: "Xero",
    category: "accounting",
    phase: 2,
    credentials: ["token", "tenantId"],
    baseUrl: () => "https://api.xero.com/api.xro/2.0",
    headers: (c) => ({ ...bearer(c), "xero-tenant-id": c.tenantId }),
    resources: [
      { kind: "customers", path: '/Contacts?where=IsCustomer==true', list: (j) => j.Contacts ?? [], map: (r) => ({ externalId: r.ContactID, name: r.Name }) },
      {
        kind: "invoices",
        path: '/Invoices?where=Type=="ACCREC"&page=1',
        list: (j) => j.Invoices ?? [],
        map: (r) => ({ externalId: r.InvoiceID, customerExternalId: r.Contact?.ContactID, customerName: r.Contact?.Name, issueDate: xeroDate(r.Date)!, dueDate: xeroDate(r.DueDate), amountCents: toCents(r.Total), paidDate: xeroDate(r.FullyPaidOnDate) }),
        next: (j, p) => ((j.Invoices ?? []).length === 100 ? `/Invoices?where=Type=="ACCREC"&page=${p + 2}` : null),
      },
      {
        kind: "bills",
        path: '/Invoices?where=Type=="ACCPAY"&page=1',
        list: (j) => j.Invoices ?? [],
        map: (r) => ({ externalId: r.InvoiceID, vendorName: r.Contact?.Name ?? null, billDate: xeroDate(r.Date)!, dueDate: xeroDate(r.DueDate), amountCents: toCents(r.Total), paidDate: xeroDate(r.FullyPaidOnDate) }),
        next: (j, p) => ((j.Invoices ?? []).length === 100 ? `/Invoices?where=Type=="ACCPAY"&page=${p + 2}` : null),
      },
      {
        kind: "transactions",
        path: "/BankTransactions?page=1",
        list: (j) => j.BankTransactions ?? [],
        map: (r) => ({ externalId: r.BankTransactionID, accountExternalId: r.BankAccount?.AccountID, date: xeroDate(r.Date)!, amountCents: toCents(r.Total) * (String(r.Type).startsWith("SPEND") ? -1 : 1), description: r.Contact?.Name ?? r.Reference ?? "Bank transaction", kind: /TRANSFER/.test(r.Type) ? "TRANSFER" : null }),
        next: (j, p) => ((j.BankTransactions ?? []).length === 100 ? `/BankTransactions?page=${p + 2}` : null),
      },
    ],
  },
  csvOnly("adp", "ADP", "payroll", ["payroll"]),
  csvOnly("quickbooks_payroll", "QuickBooks Payroll", "payroll", ["payroll"]),
  csvOnly("paychex", "Paychex", "payroll", ["payroll"]),
  {
    key: "quickbooks_time",
    name: "QuickBooks Time",
    category: "time",
    phase: 2,
    credentials: ["token"],
    baseUrl: () => "https://rest.tsheets.com/api/v1",
    headers: bearer,
    resources: [
      {
        kind: "timeEntries",
        path: `/timesheets?start_date=${new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)}`,
        // Users ride along in supplemental_data; attach them so each entry has a name.
        list: (j) => Object.values(j.results?.timesheets ?? {}).map((t: any) => ({ ...t, _user: j.supplemental_data?.users?.[t.user_id] })),
        map: (r) => ({ employeeExternalId: String(r.user_id), employeeName: r._user ? name(r._user.first_name, r._user.last_name) : `User ${r.user_id}`, jobExternalId: r.jobcode_id ? String(r.jobcode_id) : null, date: d(r.date)!, hours: Math.round((Number(r.duration) / 3600) * 100) / 100 }),
        next: (j, p) => (j.more ? `/timesheets?start_date=${new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)}&page=${p + 2}` : null),
      },
    ],
  },
  csvOnly("clockshark", "ClockShark", "time", ["timeEntries"]),
  {
    key: "busybusy",
    name: "busybusy",
    category: "time",
    phase: 2,
    credentials: ["token"],
    baseUrl: () => "https://graphql.busybusy.io",
    headers: (c) => ({ "key-authorization": c.token }),
    resources: [
      {
        kind: "timeEntries",
        graphql: true,
        path: "{ timeEntries(first: 500) { id startTime endTime member { id firstName lastName } project { id title } } }",
        list: (j) => j.data?.timeEntries ?? [],
        map: (r) => ({ employeeExternalId: r.member?.id, employeeName: name(r.member?.firstName, r.member?.lastName), jobExternalId: r.project?.id ?? null, date: d(r.startTime)!, hours: r.endTime ? Math.round(((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 3_600_000) * 100) / 100 : 0 }),
      },
    ],
  },
  {
    key: "deputy",
    name: "Deputy",
    category: "time",
    phase: 2,
    credentials: ["token", "install"],
    baseUrl: (c) => `https://${c.install}.deputy.com/api/v1`,
    headers: bearer,
    resources: [
      {
        kind: "timeEntries",
        path: "/resource/Timesheet",
        list: (j) => (Array.isArray(j) ? j : []),
        map: (r) => ({ employeeExternalId: String(r.Employee), employeeName: `Employee ${r.Employee}`, date: d(r.Date)!, hours: Number(r.TotalTime ?? 0), costCents: r.Cost != null ? toCents(r.Cost) : null }),
      },
    ],
  },
  {
    key: "square",
    name: "Square",
    category: "payments",
    phase: 2,
    credentials: ["token"],
    baseUrl: () => "https://connect.squareup.com/v2",
    headers: (c) => ({ ...bearer(c), "Square-Version": "2024-07-17" }),
    resources: [
      {
        kind: "transactions",
        path: "/payments?limit=100",
        list: (j) => j.payments ?? [],
        map: (r) => {
          const fee = (r.processing_fee ?? []).reduce((s: number, f: any) => s + Number(f.amount_money?.amount ?? 0), 0);
          const rows = [{ externalId: r.id, accountExternalId: "square", date: d(r.created_at)!, amountCents: Number(r.amount_money?.amount ?? 0), description: r.note ?? "Card payment", kind: "CHARGE" as const }];
          if (fee) rows.push({ externalId: `${r.id}:fee`, accountExternalId: "square", date: d(r.created_at)!, amountCents: -fee, description: "Square fee", kind: "FEE" as any });
          return rows;
        },
        next: (j) => (j.cursor ? `/payments?limit=100&cursor=${encodeURIComponent(j.cursor)}` : null),
      },
      {
        kind: "transactions",
        path: "/refunds?limit=100",
        list: (j) => j.refunds ?? [],
        map: (r) => ({ externalId: r.id, accountExternalId: "square", date: d(r.created_at)!, amountCents: -Number(r.amount_money?.amount ?? 0), description: "Refund", kind: "REFUND" }),
        next: (j) => (j.cursor ? `/refunds?limit=100&cursor=${encodeURIComponent(j.cursor)}` : null),
      },
      {
        kind: "transactions",
        path: "/payouts?limit=100",
        list: (j) => j.payouts ?? [],
        map: (r) => ({ externalId: r.id, accountExternalId: "square", date: d(r.arrival_date ?? r.created_at)!, amountCents: -Number(r.amount_money?.amount ?? 0), description: "Payout to bank", kind: "PAYOUT" }),
        next: (j) => (j.cursor ? `/payouts?limit=100&cursor=${encodeURIComponent(j.cursor)}` : null),
      },
    ],
  },
  csvOnly("stack", "STACK", "estimating", ["opportunities"]),
  csvOnly("procore_estimating", "Procore Estimating", "estimating", ["opportunities"]),
];

export const PHASE2 = SPECS.map(restAdapter);
