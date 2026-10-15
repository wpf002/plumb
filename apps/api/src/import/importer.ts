import { prisma, type Prisma } from "@plumb/db";
import { addMonths, bool, cents, date, num, periodOf, toRecords, type CsvRecord } from "./csv.js";
import { classifyBalance, classifyCashFlow, classifyIncome, humanize, type GlLine } from "./glclassify.js";

/**
 * Import a company from a CSV file set (the DNRD account export format).
 *
 * Files are recognized by their numeric prefix, so `07_projects.csv` and
 * `07_projects (2).csv` are both the projects file. Columns differ between
 * accounts — statement lines are company-specific and the projects file comes in
 * several shapes — so every reader looks fields up by a list of synonyms rather
 * than by position.
 *
 * Re-importing into the same company replaces everything the previous import
 * wrote, so the result is the same however many times it runs.
 */

export type ImportFiles = Record<string, string>;

export interface FileReport {
  file: string;
  kind: string;
  rows: number;
  written: number;
  notes: string[];
}

export interface ImportReport {
  companyId: string;
  companyName: string;
  dataAsOf: string | null;
  files: FileReport[];
  unrecognized: string[];
  warnings: string[];
}

type Kind =
  | "profile"
  | "chart"
  | "income"
  | "balance"
  | "cashflow"
  | "customers"
  | "customersBase"
  | "projects"
  | "progress"
  | "wip"
  | "employees"
  | "payroll"
  | "fleet"
  | "property"
  | "debt"
  | "amortization"
  | "arInvoices"
  | "arBalance"
  | "retainage"
  | "arAging"
  | "vendors"
  | "apBills"
  | "apBalance"
  | "apAging"
  | "pipeline"
  | "backlog"
  | "lost"
  | "budget"
  | "valuation"
  | "serviceTickets"
  | "maintenanceDetail"
  | "recurringDetail"
  | "recurringMonthly"
  | "serviceWork"
  | "projectCrewUtilization";

const PATTERNS: [RegExp, Kind][] = [
  [/^01_/, "profile"],
  [/^02_/, "chart"],
  [/^03_/, "income"],
  [/^04_/, "balance"],
  [/^05_/, "cashflow"],
  [/^06_customers_base/, "customersBase"],
  [/^06_/, "customers"],
  [/^07_/, "projects"],
  [/^08_.*wip/, "wip"],
  [/^08_/, "progress"],
  [/^09b_/, "payroll"],
  [/^09_/, "employees"],
  [/^10b_/, "property"],
  [/^10_/, "fleet"],
  [/^11_debt/, "debt"],
  [/^11[a-z]?_amort/, "amortization"],
  [/^12b_/, "arBalance"],
  [/^12c_/, "retainage"],
  [/^12_/, "arInvoices"],
  [/^13_/, "arAging"],
  [/^14a_/, "vendors"],
  [/^14b_/, "apBills"],
  [/^14c_/, "apBalance"],
  [/^14d_/, "apAging"],
  [/^15b_/, "backlog"],
  [/^15c_/, "lost"],
  [/^15_/, "pipeline"],
  [/^16_/, "budget"],
  [/^17_/, "valuation"],
  [/^20b_maintenance/, "maintenanceDetail"],
  [/^20b_recurring/, "recurringMonthly"],
  [/^20_service_ticket/, "serviceTickets"],
  [/^20_recurring/, "recurringDetail"],
  [/^20c_/, "serviceWork"],
  [/^20d_/, "projectCrewUtilization"],
];

/** Files that are reference balances for reconciliation, not data to load. */
const REFERENCE: Kind[] = ["arBalance", "arAging", "apBalance", "apAging", "recurringMonthly", "retainage", "customersBase"];

function kindOf(file: string): Kind | null {
  const base = file.split("/").pop()!.toLowerCase();
  if (!base.endsWith(".csv")) return null;
  return PATTERNS.find(([re]) => re.test(base))?.[1] ?? null;
}

/** First present, non-blank field among the synonyms. */
function pick(r: CsvRecord, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

const big = (c: number | null | undefined) => BigInt(c ?? 0);

// NAICS -> trade. Plumbing and HVAC share 238220; plumbing is the closer fit.
const NAICS_TRADE: Record<string, string> = {
  "238210": "ELECTRICAL",
  "238220": "PLUMBING",
  "561730": "LANDSCAPING",
  "236118": "GENERAL",
  "236115": "GENERAL",
  "236220": "GENERAL",
  "238160": "ROOFING",
  "238140": "MASONRY",
  "238310": "DRYWALL",
  "238110": "CONCRETE",
};

function paymentTermsDays(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/(\d+)/);
  if (m) return Number(m[1]);
  if (/due|receipt|auto/i.test(v)) return 0;
  return null;
}

function costCategory(label: string): "LABOR" | "MATERIAL" | "EQUIPMENT" | "SUBCONTRACT" | "OTHER" {
  if (/labor/i.test(label)) return "LABOR";
  if (/material/i.test(label)) return "MATERIAL";
  if (/subcontract/i.test(label)) return "SUBCONTRACT";
  if (/equipment|fuel|rental/i.test(label)) return "EQUIPMENT";
  return "OTHER";
}

function crewKind(name: string): "PROJECT" | "SERVICE" | "MAINTENANCE" | "SUPPORT" {
  if (/admin|management|sales|supervision|office/i.test(name)) return "SUPPORT";
  if (/maint/i.test(name)) return "MAINTENANCE";
  if (/service/i.test(name)) return "SERVICE";
  return "PROJECT";
}

function liabilityKind(debtType: string, loanId: string) {
  const t = `${debtType} ${loanId}`.toLowerCase();
  if (/line of credit|loc/.test(t)) return "LINE_OF_CREDIT" as const;
  if (/mortgage/.test(t)) return "MORTGAGE" as const;
  if (/sba/.test(t)) return "SBA_LOAN" as const;
  if (/lease/.test(t)) return "EQUIPMENT_LEASE" as const;
  return "TERM_LOAN" as const;
}

/** "truck2024" and "LOAN-TRUCK24" are the same loan. */
function loanToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/^11[a-z]?_amort_?/, "")
    .replace(/\.csv$/, "")
    .replace(/loan|mortgage-?\d*|[-_ ]/g, (m) => (m.startsWith("mortgage") ? "mortgage" : ""))
    .replace(/20(\d\d)/g, "$1");
}

/** Standard amortizing payment for a fixed-rate loan. */
function amortizedPayment(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export async function importAccount(opts: {
  files: ImportFiles;
  companyId?: string;
  ownerUserId?: string;
}): Promise<ImportReport> {
  const reports: FileReport[] = [];
  const warnings: string[] = [];
  const unrecognized: string[] = [];
  const byKind = new Map<Kind, { file: string; headers: string[]; records: CsvRecord[] }[]>();

  for (const [file, text] of Object.entries(opts.files)) {
    const kind = kindOf(file);
    if (!kind) {
      if (file.toLowerCase().endsWith(".csv")) unrecognized.push(file);
      continue;
    }
    const parsed = toRecords(text);
    byKind.set(kind, [...(byKind.get(kind) ?? []), { file, ...parsed }]);
  }
  const one = (k: Kind) => byKind.get(k)?.[0];
  const report = (file: string, kind: string, rows: number, written: number, notes: string[] = []) =>
    reports.push({ file, kind, rows, written, notes });

  // ---- 1. company --------------------------------------------------------
  const profile = one("profile")?.records[0] ?? {};
  const income = one("income");
  const lastPeriod = income?.records.at(-1)?.period ?? null;
  const dataAsOf = lastPeriod ? new Date(Date.UTC(+lastPeriod.slice(0, 4), +lastPeriod.slice(5, 7), 0)) : null;

  const hasRecurring = !!(one("maintenanceDetail") || one("recurringDetail") || one("serviceTickets"));
  const hasProjects = !!one("projects");
  const revenueModel = hasRecurring && hasProjects ? "BOTH" : hasRecurring ? "RECURRING" : "PROJECT";

  const companyData = {
    name: pick(profile, "dba", "business_name") ?? "Imported company",
    trade: (NAICS_TRADE[profile.naics_code ?? ""] ?? "OTHER") as Prisma.CompanyCreateInput["trade"],
    employeeCount: Math.round(num(profile.employee_count) ?? 0),
    revenueModel: revenueModel as Prisma.CompanyCreateInput["revenueModel"],
    externalId: profile.business_id || null,
    naicsCode: profile.naics_code || null,
    city: profile.location_city || null,
    state: profile.location_state || null,
    foundedYear: num(profile.founded_year),
    ownerName: profile.owner_name || null,
    ownerAge: num(profile.owner_age),
    legalStructure: profile.legal_structure || null,
    accountingMethod: profile.accounting_method || null,
    fiscalYearEnd: profile.fiscal_year_end || null,
    ownerSalaryCents: cents(profile.owner_salary_2025) === null ? null : big(cents(profile.owner_salary_2025)),
    ownerDistributionsCents:
      cents(profile.owner_distributions_2025) === null ? null : big(cents(profile.owner_distributions_2025)),
    goals: profile.major_business_goals || null,
    dataSource: "IMPORT",
    dataAsOf,
    setupCompletedAt: new Date(),
  };

  let companyId = opts.companyId;
  if (companyId) {
    await clearImportedData(companyId);
    await prisma.company.update({ where: { id: companyId }, data: companyData });
  } else {
    const c = await prisma.company.create({ data: companyData });
    companyId = c.id;
    await prisma.entity.create({
      data: { companyId, name: profile.business_name || companyData.name, isPrimary: true },
    });
    if (opts.ownerUserId) {
      await prisma.membership.create({ data: { userId: opts.ownerUserId, companyId, role: "OWNER" } });
    }
  }
  if (one("profile")) report(one("profile")!.file, "profile", 1, 1);

  // ---- 2. chart of accounts ---------------------------------------------
  const chart = one("chart");
  if (chart) {
    const rows = chart.records.map((r, i) => ({
      companyId: companyId!,
      key: r.account_code,
      code: r.account_code,
      name: r.account_name,
      statement: "CHART" as const,
      type: chartType(r.account_type),
      sortOrder: i,
    }));
    await prisma.glAccount.createMany({ data: rows });
    report(chart.file, "chart", chart.records.length, rows.length);
  }

  // ---- 3. statements -------------------------------------------------------
  for (const [kind, statement, classify] of [
    ["income", "INCOME", classifyIncome],
    ["balance", "BALANCE", classifyBalance],
    ["cashflow", "CASH_FLOW", classifyCashFlow],
  ] as const) {
    const f = one(kind);
    if (!f) continue;
    const lines: GlLine[] = classify(f.headers);
    const ids = new Map<string, string>();
    for (const l of lines) {
      const a = await prisma.glAccount.create({
        data: {
          companyId,
          key: l.key,
          name: l.name,
          statement,
          type: l.type,
          subtype: l.subtype,
          serviceLine: l.serviceLine,
          sortOrder: l.sortOrder,
        },
      });
      ids.set(l.key, a.id);
    }
    const amounts: Prisma.GlAmountCreateManyInput[] = [];
    for (const r of f.records) {
      for (const l of lines) {
        const c = cents(r[l.key]);
        if (c === null) continue;
        amounts.push({ glAccountId: ids.get(l.key)!, period: r.period, amount: BigInt(c) });
      }
    }
    await prisma.glAmount.createMany({ data: amounts });
    report(f.file, kind, f.records.length, amounts.length, [`${lines.length} accounts`]);
  }

  // ---- 4. customers -------------------------------------------------------
  const customerIds = new Map<string, string>(); // externalId or name -> id
  const customers = one("customers");
  const asOf = dataAsOf ?? new Date();
  if (customers) {
    for (const r of customers.records) {
      const offset = num(r.relationship_start_month_offset);
      const c = await prisma.customer.create({
        data: {
          companyId,
          externalId: r.customer_id,
          name: r.customer_name || r.customer_id,
          segment: r.segment || null,
          customerType: r.customer_type || null,
          paymentTermsDays: paymentTermsDays(r.payment_terms),
          avgDaysToPay: num(r.avg_days_to_pay),
          active: !/churn|inactive/i.test(r.active_status ?? ""),
          relationshipStart: offset === null ? null : addMonths(asOf, offset),
        },
      });
      customerIds.set(r.customer_id, c.id);
      if (r.customer_name) customerIds.set(r.customer_name, c.id);
    }
    report(customers.file, "customers", customers.records.length, customers.records.length);
  }
  async function customerFor(idOrName: string | undefined, nameHint?: string): Promise<string | null> {
    const key = idOrName || nameHint;
    if (!key) return null;
    const hit = customerIds.get(key) ?? (nameHint ? customerIds.get(nameHint) : undefined);
    if (hit) return hit;
    const c = await prisma.customer.create({
      data: { companyId: companyId!, externalId: idOrName ?? null, name: nameHint || key },
    });
    customerIds.set(key, c.id);
    if (nameHint) customerIds.set(nameHint, c.id);
    return c.id;
  }

  // ---- 5. vendors ----------------------------------------------------------
  const vendorIds = new Map<string, string>();
  const vendors = one("vendors");
  if (vendors) {
    for (const r of vendors.records) {
      const v = await prisma.vendor.create({
        data: {
          companyId,
          externalId: r.vendor_id,
          name: r.vendor_name,
          category: r.category || null,
          termsDays: num(r.terms_days),
          isSubcontractor: /subcontract/i.test(r.category ?? ""),
        },
      });
      vendorIds.set(r.vendor_id, v.id);
    }
    report(vendors.file, "vendors", vendors.records.length, vendors.records.length);
  }

  // ---- 6. crews + employees -----------------------------------------------
  const employees = one("employees");
  const employeeIds = new Map<string, string>();
  if (employees) {
    const crewIds = new Map<string, string>();
    for (const name of new Set(employees.records.map((r) => r.crew).filter(Boolean))) {
      const crew = await prisma.crew.create({ data: { companyId, name, kind: crewKind(name) } });
      crewIds.set(name, crew.id);
    }
    for (const r of employees.records) {
      const e = await prisma.employee.create({
        data: {
          companyId,
          externalId: r.employee_id,
          name: r.name,
          position: r.position || null,
          payType: /salary/i.test(r.pay_type) ? "SALARY" : "HOURLY",
          baseAnnualCents: cents(r.base_annual_2022) === null ? null : big(cents(r.base_annual_2022)),
          hourlyRateCents: cents(r.hourly_rate_2022),
          crewId: r.crew ? crewIds.get(r.crew) ?? null : null,
          hireDate: date(r.hire_date),
          cogsAllocationPct: num(r.cogs_allocation_pct) ?? 0,
        },
      });
      employeeIds.set(r.employee_id, e.id);
    }
    report(employees.file, "employees", employees.records.length, employees.records.length, [
      `${crewIds.size} crews`,
    ]);
  }

  const payroll = one("payroll");
  if (payroll) {
    const rows: Prisma.TimeEntryCreateManyInput[] = [];
    for (const r of payroll.records) {
      const employeeId = employeeIds.get(r.employee_id);
      if (!employeeId) continue;
      rows.push({
        companyId,
        employeeId,
        period: r.month,
        regularHours: num(r.regular_hours) ?? 0,
        overtimeHours: num(r.overtime_hours) ?? 0,
        regularPay: big(cents(r.regular_pay)),
        overtimePay: big(cents(r.overtime_pay)),
        grossPay: big(cents(r.gross_pay)),
        cogsAllocationPct: num(r.cogs_allocation_pct),
      });
    }
    await prisma.timeEntry.createMany({ data: rows });
    report(payroll.file, "payroll", payroll.records.length, rows.length);
  }

  // ---- 7. projects -----------------------------------------------------------
  const projectIds = new Map<string, string>();
  const projects = one("projects");
  if (projects) {
    let derivedLines = 0;
    let totalsOnly = 0;
    for (const r of projects.records) {
      const start = date(pick(r, "start_period", "start_month")) ?? asOf;
      const endRaw = date(pick(r, "end_period", "end_month"));
      const duration = num(r.duration_months);
      const end = endRaw ?? addMonths(start, Math.max(1, duration ?? 1));
      const original = cents(r.original_contract_value) ?? 0;
      const revised = cents(pick(r, "revised_contract_value", "final_revised_contract")) ?? original;
      const estTotal = cents(pick(r, "estimated_total_cost", "estimated_total_cost_initial")) ?? 0;
      const targetPct =
        num(r.target_margin_pct) ??
        (num(r.target_gross_margin_initial) !== null ? num(r.target_gross_margin_initial)! * 100 : null) ??
        (original > 0 ? ((original - estTotal) / original) * 100 : 0);
      const customerId = await customerFor(r.customer_id, r.customer_name);
      const customer = customerId
        ? await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, segment: true, customerType: true, paymentTermsDays: true } })
        : null;
      const isGc = /\bgc\b|contractor/i.test(`${customer?.segment ?? ""} ${customer?.customerType ?? ""}`);
      const status = /complete/i.test(r.status) ? "CLOSED" : "ACTIVE";

      const p = await prisma.project.create({
        data: {
          companyId,
          externalId: r.project_id,
          name: r.project_name || `${r.project_type || r.project_category || "Project"} ${r.project_id}`,
          client: customer?.name ?? r.customer_name ?? r.customer_id ?? "Unknown",
          clientType: isGc ? "GC" : "OWNER_DIRECT",
          customerId,
          status,
          billingType: "FIXED_PRICE",
          netDays: num(r.terms_days) ?? customer?.paymentTermsDays ?? 30,
          contractValue: BigInt(original),
          originalBidCost: BigInt(estTotal),
          billedToDate: big(cents(r.final_billed)),
          targetMarginPct: targetPct,
          retainagePct: (num(r.retainage_pct) ?? 0) * (num(r.retainage_pct)! > 1 ? 1 : 100),
          percentComplete: status === "CLOSED" ? 1 : null,
          startDate: start,
          endDate: end,
          category: r.project_type || r.project_category || r.category || null,
          segment: r.segment || r.category || null,
          performanceFlag: r.performance_flag || null,
        },
      });
      projectIds.set(r.project_id, p.id);

      // Estimate and actual by cost category. Three shapes in the wild:
      // explicit line items, percentage splits of a total, or totals only.
      const lineKeys = Object.keys(r).filter((k) => /^estimated_/.test(k) && !/total|cost_initial/.test(k));
      const budgets: Prisma.BudgetLineCreateManyInput[] = [];
      const costs: Prisma.CostEntryCreateManyInput[] = [];
      if (lineKeys.length > 0) {
        for (const k of lineKeys) {
          const label = k.replace(/^estimated_/, "");
          const est = cents(r[k]) ?? 0;
          const act = cents(r[`actual_${label}`]) ?? 0;
          budgets.push({ projectId: p.id, category: costCategory(label), budgetedCost: BigInt(est) });
          if (act) costs.push({ projectId: p.id, category: costCategory(label), amount: BigInt(act), incurredDate: end, source: "IMPORT", note: label });
        }
      } else if (r.materials_pct) {
        derivedLines++;
        const finalCost = cents(r.final_cost) ?? 0;
        for (const [label, pctKey] of [["labor", "labor_pct"], ["materials", "materials_pct"], ["subcontractor", "subcontractor_pct"], ["other", "other_pct"]] as const) {
          const share = num(r[pctKey]) ?? 0;
          if (!share) continue;
          budgets.push({ projectId: p.id, category: costCategory(label), budgetedCost: BigInt(Math.round(estTotal * share)) });
          if (finalCost) costs.push({ projectId: p.id, category: costCategory(label), amount: BigInt(Math.round(finalCost * share)), incurredDate: end, source: "IMPORT", note: `${label} (derived from split)` });
        }
      } else {
        totalsOnly++;
        budgets.push({ projectId: p.id, category: "OTHER", budgetedCost: BigInt(estTotal) });
        const act = cents(r.actual_total_cost) ?? 0;
        if (act) costs.push({ projectId: p.id, category: "OTHER", amount: BigInt(act), incurredDate: end, source: "IMPORT", note: "total (no line items in source)" });
      }
      // Budgets are job-level (no phase); merge duplicate categories.
      const merged = new Map<string, bigint>();
      for (const b of budgets) merged.set(b.category as string, (merged.get(b.category as string) ?? 0n) + BigInt(b.budgetedCost as bigint));
      await prisma.budgetLine.createMany({
        data: [...merged].map(([category, budgetedCost]) => ({ projectId: p.id, category: category as any, budgetedCost })),
      });
      if (costs.length) await prisma.costEntry.createMany({ data: costs });

      // Change orders: the approved delta between original and revised, plus any pending.
      const approved = cents(pick(r, "change_orders", "change_orders_approved")) ?? revised - original;
      const pending = cents(r.change_orders_pending) ?? 0;
      const cos: Prisma.ChangeOrderCreateManyInput[] = [];
      if (approved) cos.push({ projectId: p.id, contractDelta: BigInt(approved), costDelta: 0n, status: "APPROVED", date: start, approvedAt: start, reason: "Imported approved change orders" });
      if (pending) cos.push({ projectId: p.id, contractDelta: BigInt(pending), costDelta: 0n, status: "PENDING", date: end, reason: "Imported pending change orders" });
      if (cos.length) await prisma.changeOrder.createMany({ data: cos });
    }
    const notes = [`${projects.records.length} projects`];
    if (derivedLines) notes.push(`${derivedLines} with cost lines derived from percentage splits`);
    if (totalsOnly) notes.push(`${totalsOnly} with totals only (source has no line items)`);
    report(projects.file, "projects", projects.records.length, projects.records.length, notes);
  }

  // ---- 8. monthly progress / WIP ------------------------------------------
  for (const kind of ["progress", "wip"] as const) {
    const f = one(kind);
    if (!f) continue;
    const rows: Prisma.ProjectPeriodCreateManyInput[] = [];
    const lastPct = new Map<string, number>();
    for (const r of f.records) {
      const projectId = projectIds.get(r.project_id);
      if (!projectId) continue;
      const pct = (num(r.pct_complete) ?? 0) / 100;
      lastPct.set(projectId, pct);
      const opt = (k: string) => (cents(r[k]) === null ? null : BigInt(cents(r[k])!));
      rows.push({
        projectId,
        period: r.month,
        pctComplete: pct,
        costMonth: big(cents(pick(r, "cost_incurred_month"))),
        costCumulative: big(cents(pick(r, "cumulative_cost", "cost_incurred_cumulative"))),
        revenueMonth: big(cents(pick(r, "revenue_recognized_month"))),
        revenueCumulative: big(cents(pick(r, "cumulative_revenue", "revenue_recognized_cumulative"))),
        billedMonth: opt("amount_billed_month"),
        billedCumulative: opt("amount_billed_cumulative"),
        retainageHeldCumulative: opt("retainage_held_cumulative"),
        changeOrdersApprovedCumulative: opt("change_orders_approved_cumulative"),
        changeOrdersPending: opt("change_orders_pending"),
        revisedContract: opt("revised_contract_value"),
        estimatedTotalCost: opt("estimated_total_cost_current"),
        estimatedCostToComplete: opt("estimated_cost_to_complete"),
        committedCost: opt("committed_costs"),
        overbilling: opt("overbilling"),
        underbilling: opt("underbilling"),
        projectedGrossProfit: opt("projected_gross_profit"),
      });
    }
    await prisma.projectPeriod.createMany({ data: rows });
    for (const [projectId, pct] of lastPct) {
      await prisma.project.update({ where: { id: projectId }, data: { percentComplete: Math.min(1, pct) } });
    }
    report(f.file, kind, f.records.length, rows.length);
  }

  // ---- 9. signed backlog --------------------------------------------------
  const backlog = one("backlog");
  if (backlog) {
    let created = 0;
    for (const r of backlog.records) {
      const remaining = (num(r.pct_remaining) ?? 100) / 100;
      const existing = projectIds.get(r.project_id);
      if (existing) {
        await prisma.project.update({
          where: { id: existing },
          data: { percentComplete: 1 - remaining, status: "ACTIVE" },
        });
        continue;
      }
      const contract = cents(r.contract_value) ?? 0;
      const completion = date(r.expected_completion) ?? addMonths(asOf, 3);
      const customerId = await customerFor(r.customer_id, r.customer_name);
      const p = await prisma.project.create({
        data: {
          companyId,
          externalId: r.project_id,
          name: r.description || r.project_type || r.project_id,
          client: r.customer_name || r.customer_id || "Unknown",
          clientType: "OWNER_DIRECT",
          customerId,
          status: remaining >= 1 ? "AWARDED" : "ACTIVE",
          contractValue: BigInt(contract),
          originalBidCost: 0n,
          targetMarginPct: 0,
          percentComplete: 1 - remaining,
          startDate: asOf,
          endDate: completion,
          category: r.project_type || null,
        },
      });
      projectIds.set(r.project_id, p.id);
      created++;
    }
    report(backlog.file, "backlog", backlog.records.length, backlog.records.length, [`${created} new signed jobs`]);
  }

  // ---- 10. AR invoices + payments ------------------------------------------
  const ar = one("arInvoices");
  if (ar) {
    const rows: Prisma.InvoiceCreateManyInput[] = [];
    for (const r of ar.records) {
      const issue = date(r.invoice_period)!;
      const terms = num(r.terms_days) ?? 30;
      const collected = date(r.collection_period);
      // Paid at the start of the collection month, never before issue: this is
      // the rule that reproduces the source's month-end AR balances.
      const paid = collected ? new Date(Math.max(collected.getTime(), issue.getTime())) : null;
      rows.push({
        companyId,
        externalId: r.invoice_id,
        customerId: (await customerFor(r.customer_id, r.customer)) ?? undefined,
        projectId: r.project_id ? projectIds.get(r.project_id) ?? null : null,
        source: r.source ? (/recurring|maintenance/i.test(r.source) ? "RECURRING" : /service/i.test(r.source) ? "SERVICE" : "PROJECT") : "PROJECT",
        segment: r.segment || r.category || null,
        issueDate: issue,
        dueDate: new Date(issue.getTime() + terms * 86_400_000),
        termsDays: terms,
        amount: big(cents(r.invoice_amount)),
        paidDate: paid,
        status: paid ? "PAID" : "OPEN",
      });
    }
    await prisma.invoice.createMany({ data: rows });
    const paid = await prisma.invoice.findMany({
      where: { companyId, status: "PAID" },
      select: { id: true, amount: true, paidDate: true },
    });
    await prisma.payment.createMany({
      data: paid.map((i) => ({ invoiceId: i.id, amount: i.amount, receivedDate: i.paidDate! })),
    });
    report(ar.file, "arInvoices", ar.records.length, rows.length, [`${paid.length} payments`]);
  }

  // ---- 11. AP bills -----------------------------------------------------------
  const ap = one("apBills");
  if (ap) {
    const rows: Prisma.BillCreateManyInput[] = ap.records.map((r) => {
      const billDate = date(r.bill_period)!;
      const terms = num(r.terms_days) ?? 30;
      const paidOn = date(r.payment_period);
      const paid = paidOn ? new Date(Math.max(paidOn.getTime(), billDate.getTime())) : null;
      return {
        companyId: companyId!,
        externalId: r.bill_id,
        vendorId: vendorIds.get(r.vendor_id) ?? null,
        projectId: r.project_id ? projectIds.get(r.project_id) ?? null : null,
        category: r.category || null,
        billDate,
        dueDate: new Date(billDate.getTime() + terms * 86_400_000),
        termsDays: terms,
        amount: big(cents(r.bill_amount)),
        paidDate: paid,
        status: paid ? "PAID" : "OPEN",
      };
    });
    await prisma.bill.createMany({ data: rows });
    report(ap.file, "apBills", ap.records.length, rows.length);
  }

  // ---- 12. fleet + property -----------------------------------------------
  const assetIds = new Map<string, string>(); // loan_id -> asset id
  const fleet = one("fleet");
  if (fleet) {
    for (const r of fleet.records) {
      const a = await prisma.asset.create({
        data: {
          companyId,
          externalId: r.asset_id,
          name: r.asset,
          category: /vehicle|truck|van/i.test(r.type) ? "VEHICLE" : /tool/i.test(r.type) ? "EQUIPMENT" : "EQUIPMENT",
          assetType: r.type || null,
          unitCount: Math.max(1, Math.round(num(r.unit_count) ?? 1)),
          purchaseDate: date(r.purchase_date) ?? asOf,
          purchaseCost: big(cents(r.original_cost)),
          usefulLifeMonths: num(r.useful_life_months),
          salvageValue: big(cents(r.salvage)),
          currentValue: cents(r.current_market_value_2025) === null ? null : big(cents(r.current_market_value_2025)),
          valueAsOf: cents(r.current_market_value_2025) === null ? null : asOf,
        },
      });
      if (r.loan_id) assetIds.set(r.loan_id, a.id);
    }
    report(fleet.file, "fleet", fleet.records.length, fleet.records.length);
  }
  const property = one("property");
  if (property) {
    let rent = 0;
    for (const r of property.records) {
      const monthlyRent = cents(r.monthly_rent_2022);
      if (monthlyRent) {
        // Leased space is a recurring cost, escalated from the 2022 rate to today.
        const years = Math.max(0, asOf.getUTCFullYear() - 2022);
        const esc = Math.pow(1 + (num(r.rent_escalation_annual_pct) ?? 0), years);
        await prisma.recurringExpense.create({
          data: {
            companyId,
            name: `Rent — ${r.address}`,
            category: "OVERHEAD",
            amount: BigInt(Math.round(monthlyRent * esc)),
            frequency: "MONTHLY",
            startDate: date(r.lease_start) ?? new Date(Date.UTC(2022, 0, 1)),
          },
        });
        rent++;
        continue;
      }
      const land = cents(r.land_cost) ?? 0;
      const building = cents(r.building_cost) ?? 0;
      const a = await prisma.asset.create({
        data: {
          companyId,
          externalId: r.property_id,
          name: r.address,
          category: "REAL_ESTATE",
          assetType: "Building + land",
          purchaseDate: date(r.purchase_date) ?? asOf,
          purchaseCost: BigInt(land + building),
          currentValue: cents(r.current_combined_real_estate_value_2025) === null ? null : big(cents(r.current_combined_real_estate_value_2025)),
          valueAsOf: asOf,
        },
      });
      if (r.loan_id) assetIds.set(r.loan_id, a.id);
    }
    report(property.file, "property", property.records.length, property.records.length, rent ? [`${rent} leases as recurring rent`] : []);
  }

  // ---- 13. debt -------------------------------------------------------------
  const debt = one("debt");
  if (debt) {
    const schedules = (byKind.get("amortization") ?? []).map((f) => ({ token: loanToken(f.file.split("/").pop()!), rows: f.records }));
    const bsLatest = await latestBalanceLines(companyId);
    for (const r of debt.records) {
      const kind = liabilityKind(r.debt_type, r.loan_id);
      const principal = cents(r.original_principal) ?? 0;
      const rate = num(r.interest_rate) ?? 0;
      const term = num(r.term_months);
      const origination = date(r.origination_date);
      const schedule = schedules.find((s) => s.token === loanToken(r.loan_id));
      const asOfPeriod = periodOf(asOf);
      const schedRow = schedule?.rows.filter((x) => x.month <= asOfPeriod).at(-1);

      let balance = 0;
      let payment = cents(r.monthly_payment) ?? 0;
      if (kind === "LINE_OF_CREDIT") {
        balance = bsLatest.get("line_of_credit") ?? 0;
        payment = 0;
      } else if (schedRow) {
        balance = cents(schedRow.balance) ?? 0;
        payment = cents(schedRow.payment) ?? payment;
      } else if (term && origination) {
        payment = payment || Math.round(amortizedPayment(principal, rate, term));
        balance = principal; // walked forward below
        const months = Math.max(0, (asOf.getUTCFullYear() - origination.getUTCFullYear()) * 12 + asOf.getUTCMonth() - origination.getUTCMonth());
        for (let i = 0; i < months && balance > 0; i++) balance -= payment - Math.round((balance * rate) / 12);
        balance = Math.max(0, balance);
      }
      const maturity = date(r.maturity_date) ?? (origination && term ? addMonths(origination, term) : null);

      await prisma.liability.create({
        data: {
          companyId,
          externalId: r.loan_id,
          name: `${r.debt_type} — ${r.collateral || r.lender}`,
          lender: r.lender || null,
          kind,
          originalPrincipal: BigInt(kind === "LINE_OF_CREDIT" ? 0 : principal),
          currentBalance: BigInt(balance),
          creditLimit: kind === "LINE_OF_CREDIT" ? BigInt(principal) : null,
          interestRatePct: Math.round(rate * 100 * 1000) / 1000,
          paymentAmount: BigInt(payment),
          paymentFrequency: "MONTHLY",
          nextPaymentDate: kind === "LINE_OF_CREDIT" ? null : addMonths(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1)), 1),
          termMonths: term,
          originationDate: origination,
          maturityDate: maturity,
          payoffDate: maturity,
          collateral: r.collateral || null,
          assetId: assetIds.get(r.loan_id) ?? null,
          active: balance > 0 || kind === "LINE_OF_CREDIT",
        },
      });
    }
    report(debt.file, "debt", debt.records.length, debt.records.length, [`${schedules.length} amortization schedules matched by loan id`]);
    for (const f of byKind.get("amortization") ?? []) {
      const matched = debt.records.some((r) => loanToken(r.loan_id) === loanToken(f.file.split("/").pop()!));
      report(f.file, "amortization", f.records.length, 0, [matched ? "balance and payment read at the as-of month" : "no matching loan id"]);
    }
  }

  // ---- 14. pipeline + lost ---------------------------------------------------
  const pipeline = one("pipeline");
  if (pipeline) {
    for (const r of pipeline.records) {
      await prisma.opportunity.create({
        data: {
          companyId,
          externalId: r.opportunity_id,
          customerId: await customerFor(r.customer_id, undefined),
          description: r.description,
          projectType: r.project_type || null,
          estimatedValue: big(cents(r.estimated_value)),
          probabilityPct: num(r.probability_pct) ?? 0,
          expectedStart: date(r.expected_start),
          status: "OPEN",
        },
      });
    }
    report(pipeline.file, "pipeline", pipeline.records.length, pipeline.records.length);
  }
  const lost = one("lost");
  if (lost) {
    await prisma.opportunity.createMany({
      data: lost.records.map((r) => ({
        companyId: companyId!,
        externalId: r.lost_opportunity_id,
        description: r.description,
        segment: r.segment || null,
        estimatedValue: big(cents(r.estimated_value)),
        probabilityPct: 0,
        status: "LOST" as const,
        lostReason: r.reason || null,
        lostYear: num(r.year),
      })),
    });
    report(lost.file, "lost", lost.records.length, lost.records.length);
  }

  // ---- 15. budget + valuation ----------------------------------------------
  const budget = one("budget");
  if (budget) {
    const rows: Prisma.BudgetCreateManyInput[] = [];
    for (const r of budget.records) {
      const year = Number(r.year);
      for (const [line, b, a] of [
        ["REVENUE", "revenue_budget", "revenue_actual"],
        ["DIRECT_COST", "direct_cost_budget", "direct_cost_actual"],
        ["OPEX", "opex_budget", "opex_actual"],
        ["CAPEX", "capex_budget", "capex_actual"],
        ["NET_INCOME", "profit_goal", "net_income_actual"],
      ] as const) {
        if (cents(r[b]) === null) continue;
        rows.push({ companyId: companyId!, year, line, budget: big(cents(r[b])), actual: cents(r[a]) === null ? null : big(cents(r[a])) });
      }
    }
    await prisma.budget.createMany({ data: rows });
    report(budget.file, "budget", budget.records.length, rows.length);
  }
  const valuation = one("valuation");
  if (valuation) {
    const r = valuation.records[0];
    await prisma.valuationInput.create({
      data: { companyId, asOf: date(r.valuation_as_of) ?? asOf, data: r as Prisma.InputJsonValue },
    });
    report(valuation.file, "valuation", 1, 1);
  }

  // ---- 16. service + recurring detail ---------------------------------------
  const tickets = one("serviceTickets");
  if (tickets) {
    await prisma.serviceCallPeriod.createMany({
      data: tickets.records.map((r) => ({
        companyId: companyId!,
        period: r.month,
        segment: r.segment,
        category: r.category,
        ticketCount: Math.round(num(r.ticket_count) ?? 0),
        avgTicketCents: big(cents(r.avg_ticket)),
        revenue: big(cents(r.revenue)),
      })),
    });
    report(tickets.file, "serviceTickets", tickets.records.length, tickets.records.length);
  }
  for (const [kind, recurringKind] of [["maintenanceDetail", "MAINTENANCE"], ["recurringDetail", "RECURRING"]] as const) {
    const f = one(kind);
    if (!f) continue;
    const rows: Prisma.RecurringRevenueEntryCreateManyInput[] = [];
    for (const r of f.records) {
      rows.push({
        companyId,
        customerId: await customerFor(r.customer_id, undefined),
        segment: r.segment || null,
        period: r.month,
        amount: big(cents(pick(r, "maintenance_revenue", "recurring_revenue"))),
        kind: recurringKind,
      });
    }
    await prisma.recurringRevenueEntry.createMany({ data: rows });
    report(f.file, kind, f.records.length, rows.length);
  }

  // Crew capacity history, where the source tracks it.
  const serviceWork = one("serviceWork");
  if (serviceWork) {
    const crews = await prisma.crew.findMany({ where: { companyId, kind: "MAINTENANCE" } });
    // One combined maintenance-capacity series; attach it to a synthetic crew so
    // capacity planning has a single row to read.
    const target =
      crews.length === 1
        ? crews[0]
        : await prisma.crew.create({ data: { companyId, name: "All Maintenance Crews", kind: "MAINTENANCE" } });
    await prisma.crewCapacityPeriod.createMany({
      data: serviceWork.records.map((r) => ({
        crewId: target.id,
        period: r.month,
        capacityHours: num(r.maintenance_crew_capacity_hours),
        usedHours: num(r.estimated_service_hours),
        utilizationPct: num(r.maintenance_crew_utilization_pct),
      })),
    });
    report(serviceWork.file, "serviceWork", serviceWork.records.length, serviceWork.records.length);
  }
  const projectUtil = one("projectCrewUtilization");
  if (projectUtil) {
    const crew =
      (await prisma.crew.findFirst({ where: { companyId, kind: "PROJECT" } })) ??
      (await prisma.crew.create({ data: { companyId, name: "Project Crew", kind: "PROJECT" } }));
    await prisma.crewCapacityPeriod.createMany({
      data: projectUtil.records.map((r) => ({
        crewId: crew.id,
        period: r.period,
        utilizationPct: num(r.project_crew_utilization_pct),
      })),
    });
    report(projectUtil.file, "projectCrewUtilization", projectUtil.records.length, projectUtil.records.length);
  }

  // ---- 17. opening cash at the as-of date ------------------------------------
  const bs = await latestBalanceLines(companyId);
  if (bs.has("cash") && dataAsOf) {
    await prisma.cashSnapshot.create({
      data: { companyId, asOf: dataAsOf, balance: BigInt(bs.get("cash")!), source: "IMPORT" },
    });
  }
  const loc = bs.get("line_of_credit") ?? 0;
  if (loc > 0) warnings.push(`Line of credit drawn at the as-of date: ${(loc / 100).toFixed(2)}.`);

  // Reference files are acknowledged so nothing looks silently dropped.
  for (const k of REFERENCE) {
    for (const f of byKind.get(k) ?? []) report(f.file, `${k} (reference)`, f.records.length, 0, ["used for reconciliation only"]);
  }

  const result: ImportReport = {
    companyId,
    companyName: companyData.name,
    dataAsOf: dataAsOf?.toISOString().slice(0, 10) ?? null,
    files: reports,
    unrecognized,
    warnings,
  };
  await prisma.importRun.create({
    data: {
      companyId,
      source: "CSV",
      status: unrecognized.length ? "PARTIAL" : "OK",
      report: result as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
  return result;
}

function chartType(t: string) {
  const s = t.toLowerCase();
  if (s.startsWith("asset")) return "ASSET" as const;
  if (s.startsWith("liab")) return "LIABILITY" as const;
  if (s.startsWith("equity")) return "EQUITY" as const;
  if (s.startsWith("revenue") || s.startsWith("income")) return "REVENUE" as const;
  if (s.startsWith("cogs") || s.includes("cost of")) return "COGS" as const;
  return "OPEX" as const;
}

/** Balance-sheet line -> amount (cents) at the latest imported period. */
async function latestBalanceLines(companyId: string): Promise<Map<string, number>> {
  const accounts = await prisma.glAccount.findMany({
    where: { companyId, statement: "BALANCE" },
    include: { amounts: { orderBy: { period: "desc" }, take: 1 } },
  });
  return new Map(accounts.map((a) => [a.key, Number(a.amounts[0]?.amount ?? 0n)]));
}

/** Everything a CSV import writes, so a re-import replaces rather than duplicates. */
async function clearImportedData(companyId: string) {
  const projectIds = (await prisma.project.findMany({ where: { companyId }, select: { id: true } })).map((p) => p.id);
  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { invoice: { companyId } } }),
    prisma.invoice.deleteMany({ where: { companyId } }),
    prisma.bill.deleteMany({ where: { companyId } }),
    prisma.timeEntry.deleteMany({ where: { companyId } }),
    prisma.projectPeriod.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.costEntry.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.budgetLine.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.changeOrder.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.milestone.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.laborCommitment.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.cashEvent.deleteMany({ where: { companyId } }),
    prisma.project.deleteMany({ where: { companyId } }),
    prisma.opportunity.deleteMany({ where: { companyId } }),
    prisma.recurringRevenueEntry.deleteMany({ where: { companyId } }),
    prisma.serviceCallPeriod.deleteMany({ where: { companyId } }),
    prisma.crewCapacityPeriod.deleteMany({ where: { crew: { companyId } } }),
    prisma.employee.deleteMany({ where: { companyId } }),
    prisma.crew.deleteMany({ where: { companyId } }),
    prisma.customer.deleteMany({ where: { companyId } }),
    prisma.vendor.deleteMany({ where: { companyId } }),
    prisma.liability.deleteMany({ where: { companyId } }),
    prisma.asset.deleteMany({ where: { companyId } }),
    prisma.recurringExpense.deleteMany({ where: { companyId } }),
    prisma.budget.deleteMany({ where: { companyId } }),
    prisma.valuationInput.deleteMany({ where: { companyId } }),
    prisma.glAccount.deleteMany({ where: { companyId } }),
    prisma.cashSnapshot.deleteMany({ where: { companyId } }),
  ]);
}

export { humanize, loanToken, kindOf };
