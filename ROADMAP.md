# DNRD Roadmap

Source of truth: **DNRD Financial Reporting, Data & Integration Requirements**
(2026-10-05), with the four DNRD test accounts as acceptance data. The August
Plumb spec and competitive analysis still apply where DNRD doesn't override them.
The previous roadmap (Plumb phases 1–15, all shipped) is archived at
[docs/ROADMAP_PLUMB_2026-08.md](docs/ROADMAP_PLUMB_2026-08.md).

Every numbered section of the requirements doc (§1–§38), the subscription model,
the integration strategy, the data architecture decision, and the AI security
model is assigned to a phase. See [Traceability](#traceability).

---

## Where we start

Plumb already ships about a third of DNRD. Reuse, don't rewrite.

| DNRD area | Plumb today | Gap |
|---|---|---|
| Cash forecast | Daily forecast 30–365d, base + payer stress, scheduled obligations, milestones | No weekly 13-week view, no upside/downside cases, no LOC utilization |
| Job profitability | `engine/margin`, budgets by category, change orders (approve/reject) | No committed costs, no estimate-vs-actual history, no underbid analysis |
| WIP / retainage | `engine/wip`, `engine/retainage` | No earned/billed/collected triple, no balance-sheet WIP lines |
| Balance sheet | Assets, liabilities, net worth | No AR/AP/inventory/prepaid/payroll/tax lines, no equity section |
| Recurring revenue | `ServiceContract`, MRR, renewals, concentration | No churn, renewal rate, service frequency, margin |
| Scenarios | 8 mutations, cash-only results, buy-vs-wait | Results don't recalc profit, debt, capacity, working capital, valuation |
| AI | Fact-grounded narration with `verifyNarration`, collision detection | No Q&A (Ask Denny), no tool layer, no scoped permissions |
| Data quality | `engine/confidence`, reconciliation | Fine as is |
| Integrations | QBO read + invoice write-back, Plaid/Gusto/FreshBooks dry-run | No CSV import, no Stripe, no vertical systems |
| Statements | none | P&L, full balance sheet, historical cash flow all missing |
| Ops analytics | none | Crews, labor, service calls, customers, service lines all missing |
| Valuation | none | Missing |

Existing models: `Company Project Phase BudgetLine CostEntry ChangeOrder CashEvent
CashSnapshot LaborCommitment Milestone Payer Asset Liability RecurringExpense
ServiceContract QboConnection SyncLog` plus auth.

---

## Acceptance data

The four test accounts are the definition of done. Each phase lists the findings
it must reproduce.

| Account | Trade | Rev 2025 | Staff | Distinct data |
|---|---|---|---|---|
| `steve_electric` | Commercial electric, KY | $2.29M | 7 | Musco concentration, LOC maxed Mar 2022 while profitable, AP aging, valuation |
| `joe_landscaping` | Landscaping, TX | $2.45M | 15 | Recurring + projects, crew utilization, lost opportunities, undrawn LOC |
| `robert_plumbing_dataset` | Plumbing/HVAC, OK | $8.2M | 51 | 5 revenue segments, service tickets, maintenance agreements, 372 projects, mortgage, valuation |
| `jerry_gc_dataset` | Residential GC, TN | $3.09M | 12 | Full monthly WIP schedule, retainage, over/underbilling, 2024 net loss |

Facts that shape the import design (checked against the files):

- 48 months each, Jan 2022–Dec 2025. Balance sheets balance every month (`check_balance_error` = 0.00).
- Statement files (`03`, `04`, `05`) have **different columns per account**: revenue and COGS lines are wide, account-specific columns (`revenue_musco`, `revenue_school_municipal`…). They must map to the account's `02_chart_of_accounts.csv`, not to hardcoded fields.
- `07_projects.csv` has **four different shapes**. Steve and Joe carry line-item estimate and actual. Robert carries totals only plus pending change orders. Jerry carries percentage cost splits, retainage, and final billed.
- Progress comes as `08_project_monthly_progress.csv` (3 accounts) or a full `08_project_monthly_wip.csv` (Jerry).
- Optional files exist in only one account: service tickets, maintenance agreements, recurring detail, crew utilization, lost opportunities, retainage receivable, AP aging, valuation (2 accounts).
- Each account ships `19_ai_insights.md` (10 findings, 40 total) and `18_scenario_assumptions.md` (quantified scenarios). These are the answer key.

---

## Principles carried into every phase

From the requirements doc:

- **DNRD owns its data model.** QuickBooks, Jobber, ServiceTitan, and Procore map *into* DNRD objects. None of them define the schema.
- **Record → Understand → Forecast → Advise.** Every screen should answer one of the four.
- **Sit above existing systems.** No CRM, scheduling, invoicing, or GL replacement.
- **Owner language next to every metric.** "Current Ratio: 1.3" also reads "Tight but Manageable."
- **Profit and cash are separate numbers** and the product says so wherever they diverge.
- **AI gets scoped data only.** Per question, never the whole database.

From Plumb (unchanged):

- Money in integer cents. Engine functions pure, `asOf` injected.
- The engine computes, the model narrates. No figure originates in an LLM.
- Projections never double-count actuals.

---

## Phases

### D1 — Foundations: migrations, rename, design system

Prerequisite for everything else. The data-model change in D2 is too large to ship through `prisma db push`.

- **Prisma migrations.** Baseline the current schema, switch every environment from `db push` to `prisma migrate deploy`, and add the deploy step to `apps/api/Dockerfile`. The last production push needed hand-written SQL for `Company.trade`.
- **Rename Plumb → DNRD** in the UI, page titles, digest emails, docs, and the AI system prompt. Package names (`@plumb/*`) and the repo name stay until there's a reason to churn them.
- **New design system.** Derive the palette from the DNRD name and domain, pick a display + text type pairing, define tokens in `globals.css` before touching components. The current blueprint-navy/safety-orange system belongs to Plumb.
- **UI copy pass across existing screens.** Strip explanatory paragraphs (`.hint` blocks are on nearly every page), Title Case all buttons, nav, headings, and column headers, and keep nav items to one or two nouns.

**Done when:** a migration runs in CI and on deploy; no screen says "Plumb"; no screen carries a paragraph of explanation.

### D2 — Canonical data model

Doc section: *Most Important Data Architecture Decision.* All 27 objects, mapped onto what exists.

| DNRD object | Plumb today | Action |
|---|---|---|
| Business | `Company` | Rename concept, keep model |
| Entity, Branch | — | New. `Company` → many `Entity` → many `Branch`. Single-entity default. |
| Customer | `Payer` (partial), `Project.client` string | New `Customer`. Fold `Payer` lateness fields into it. |
| Vendor, Subcontractor | `CostEntry.vendorName` string | New `Vendor` with `isSubcontractor`, terms, category |
| Project, Job, Service Call | `Project` only | `Project` (bid/POC work), `Job` (service work order), `ServiceCall` (ticket) |
| Contract, Recurring Contract | `ServiceContract` | Keep as Recurring Contract. `Contract` for project contract terms. |
| Estimate | `Project.originalBidCost`, `BudgetLine` | New `Estimate` with line items: labor hours/$, materials, subs, equipment, permits, other, markup, target margin |
| Change Order | `ChangeOrder` | Add `REQUESTED` state, time impact, `performedBeforeApproval` |
| Invoice, Payment | `CashEvent` (mixed) | New `Invoice` and `Payment`. `CashEvent` stays as the forecast ledger. |
| Employee, Crew, Time Entry | `LaborCommitment` only | New. Employee (pay type, rate, burden, COGS allocation %), Crew, TimeEntry (hours, OT, project/job, code) |
| Material | `CostEntry` category | New `Material` line for job costing |
| Asset, Vehicle | `Asset` | Add vehicle/equipment detail: maintenance, fuel, insurance, utilization, downtime |
| Loan | `Liability` | Add collateral, maturity, original amount, amortization import |
| Transaction | — | New GL-level `Transaction` with `GlAccount` (chart of accounts) |
| Opportunity | — | New. Value, margin, probability, start, close, `lostReason` |
| Forecast, Budget | `BudgetLine` (job level) | New company-level `Budget` by account/period and stored `ForecastSnapshot` for forecast-vs-actual |

Also: `GlAccount` with account type (Asset/Liability/Equity/Revenue/COGS/Opex) and a `serviceLine` tag so revenue can roll up by service line (§17).

**Done when:** every row above exists as a migration, existing features run on the new models.

### D3 — CSV / Excel import

Phase 1 of the doc's integration roadmap and the only way the test accounts get in.

- Upload a folder or zip; detect each file by name prefix (`01_`…`20d_`).
- **Column mapping layer.** Canonical field names with known synonyms (`start_period` / `start_month`, `change_orders` / `change_orders_approved`), plus a per-import mapping screen for anything unrecognized.
- **Chart-of-accounts mapping** for wide statement files: each `03`/`04`/`05` column maps to a `GlAccount`, with suggestions from the account names.
- **Derived fields** where an account omits them. Jerry's line items come from percentage splits; Robert's totals import without line items and are flagged as such.
- Idempotent re-import by source id. Import report: rows read, created, updated, skipped, and why.
- Manual transaction import (CSV of bank or card lines).
- Load all four test accounts as the demo companies.

**Done when:** all four accounts import with zero unmapped required columns, and imported monthly revenue, COGS, net income, cash, AR, and AP match the source statements to the cent for all 48 months.

### D4 — Acceptance harness

Built before the analytics so every later phase is measured against it.

- A test per finding in each `19_ai_insights.md`: 40 assertions, each tied to a specific computed number (e.g. Steve "LOC hit its $150,000 limit in March 2022"; Jerry "CUST-062 finishes at ~2.5% gross margin"; Robert "64 of 372 install projects ran >4% over estimate").
- A test per scenario in each `18_scenario_assumptions.md`.
- Statement reconciliation tests from D3.
- A scoreboard command that reports pass/fail per account, so progress across D5–D13 is visible.

**Done when:** the harness runs in CI. Most assertions fail at this point; that's the point.

### D5 — Financial statements

§3, §4, §5, §34.

- **P&L.** Revenue lines (project, service, maintenance, install, repair, change-order, material markup, equipment reimbursement, other); direct costs (labor, burden, materials, subs, equipment rental, permits, supplies, job fuel, disposal, freight, commissions); opex (office/admin payroll, rent, utilities, insurance, vehicle, marketing, software, legal, accounting, repairs, property tax, fuel, depreciation, interest). Views: monthly, quarterly, YTD, annual, trailing 12. Comparisons: prior period, prior year, budget, forecast.
- **Balance sheet.** Cash, AR, inventory, prepaid, deposits, WIP (cost and earnings in excess of billings), vehicles, equipment, tools, real estate, accumulated depreciation; AP, cards, vehicle/equipment loans, LOC, payroll and tax liabilities, leases, other debt (incl. billings in excess); owner equity, retained earnings, contributions, distributions.
- **Historical cash flow.** Operating (collections, payroll, materials, vendors, subs, opex), investing (vehicles, equipment, real estate, improvements, sales), financing (proceeds, repayments, LOC draws, contributions, distributions). A profit-vs-cash panel on every view.
- **Budget vs actual.** Revenue, labor, materials, payroll, opex, capex, gross profit, EBITDA, with the largest variances explained in one line each.

**Acceptance:** Steve #2 and #3, Jerry #2 and #3, Joe #9, Robert #1.

### D6 — Health dashboard and working capital

§2, §24, §25, §26, §27.

- **Dashboard.** All 25 metrics: cash, available credit, AR, AP, monthly and YTD revenue, gross profit and margin, operating profit, EBITDA, normalized EBITDA, net income, payroll burden, current debt, annual debt service, working capital, current ratio, signed backlog, weighted pipeline, projected 30- and 90-day cash, projected year-end revenue and profit. Concerns surfaced: jobs at risk, overdue receivables, margin deterioration, payroll pressure, capacity constraints, equipment or debt concerns. Each metric paired with an owner-language reading.
- This replaces the current dashboard's six-section stack. Rework the layout; don't append.
- **AR.** Aging buckets (current, 1–30, 31–60, 61–90, 90+) and a collections priority score from amount, lateness, cash impact, and customer payment history.
- **AP.** Vendor, bill, amount, due, expense type, project. AP timing feeds the forecast.
- **Working capital.** Current assets and liabilities, working capital, current ratio, quick ratio, in plain language.
- **Debt.** Lender, type, original, balance, payment, rate, maturity, collateral. Total debt, annual debt service, monthly burden, debt-to-equity, debt-service coverage.

**Acceptance:** Steve #4, Robert #7 and #8, Jerry #8, Joe #7.

### D7 — Forecasting

§6, §7, §8, §35.

- **13-week cash forecast** (flagship). Weekly buckets: beginning cash, inflows, outflows, ending cash, lowest point, LOC utilization, reserve target, projected shortfall. Inputs: bank balances, open invoices and due dates, expected collections, recurring receipts, progress billings, payroll, sub payments, material purchases, AP, debt and vehicle payments, taxes, insurance, rent, capex, owner distributions. Output sentence: "Cash falls below your $75,000 reserve the week of Nov 9," followed by the cause.
- Built on the existing schedule-expansion layer. Adds AP, payroll, and distributions as generators, and a weekly rollup next to `rollupMonthly`.
- **12-month forecast.** Monthly inflow, opex, payroll, debt service, equipment purchases, ending cash. Base, upside, and downside cases.
- **Revenue forecast.** Project method: signed jobs, start dates, contract value, percent complete, billing schedules, backlog, weighted pipeline. Service method: maintenance contracts, historical volume, average ticket, seasonality, scheduled installs, memberships, renewal rates. Output: signed, likely, pipeline, recurring, monthly, annual.
- **Forecast vs actual.** Store a `ForecastSnapshot` weekly; compare revenue, cash, job margin, backlog, and payroll forecasts to actuals.

**Acceptance:** Steve #10, Joe #8, Jerry #1 and #9.

### D8 — Project financials

§9–§16. Extends `engine/margin`, `engine/wip`, `engine/retainage`, change orders, milestones.

- **Job profitability.** Original estimate, contract, approved COs, revised contract, estimated and actual labor/materials/subs, equipment, permits, other, projected total cost, projected gross profit and margin. Original margin vs current projected margin with the cause.
- **Estimate vs actual** on completed jobs: hours, labor $, materials, subs, equipment, gross profit. Aggregate by job type to answer "which job types are consistently underbid."
- **WIP.** Contract, approved COs, revised value, estimated total cost, cost to date, committed cost, cost to complete, percent complete, earned, billed, collected, gross profit, projected margin, over/underbilling. Surfaces margin fade, materially underbilled jobs, jobs consuming cash, jobs near completion with open COs.
- **Over/underbilling dashboard** with cash implication per job.
- **Change orders.** Requested, pending, approved, rejected; value, cost, margin, time impact. Flags unapproved work in progress, low-margin COs, unbilled CO revenue, scope creep.
- **Retainage.** By job: withheld, release date, outstanding, collected. Total held and next-90-day releases.
- **Backlog.** Signed backlog, remaining revenue, start, completion, margin, labor hours, monthly recognition. Months of coverage at current burn; over/under capacity.
- **Pipeline.** Opportunity, customer, value, margin, probability, start, close. Total, weighted, expected revenue and GP. Combined backlog + pipeline view. Lost opportunities with reason.

**Acceptance:** Jerry #4, #5, #6, #7; Steve #5 and #6; Robert #6; Joe #2, #6.

### D9 — Operations analytics

§17–§23.

- **Service lines.** Revenue, GP, margin, growth, labor utilization per line, from `GlAccount.serviceLine`.
- **Customer profitability.** Revenue, direct cost, GP, payment speed, callbacks/rework, COs, discounts, account burden. Flags high-revenue, low-value customers.
- **Crew profitability.** Revenue, hours, payroll, overtime, materials, jobs, average margin, utilization per crew. Flags high performers, low productivity, chronic hour overruns.
- **Labor productivity.** Estimated, actual, billable, productive, overtime hours; revenue and GP per labor hour; job types that overrun labor.
- **Capacity planning.** Available vs committed hours by month from employees, crews, leave, backlog, expected hires. Pending-project what-if: "November 96%, 118% if both pending projects close." Generalizes the existing `engine/bid` crew load.
- **Recurring revenue.** MRR, ARR, active contracts, renewal rate, churn, average contract value, gross margin, service frequency. Recurring separated from project revenue everywhere.
- **Service call economics.** Calls, average ticket, hours, material, tech cost, GP, conversion to replacement/project work, revenue per tech and per call, travel time, callback rate.

**Acceptance:** Robert #2, #3, #4, #5; Joe #1, #3, #4, #5; Jerry #10.

### D10 — Fleet and capital decisions

§28–§31.

- **Fleet & equipment.** Purchase price and date, current value, loan balance, payment, maintenance, repairs, fuel, insurance, utilization; trucks, vans, excavators, skid steers, forklifts, lifts, trailers, specialty equipment.
- **Repair vs keep vs replace** from repair history, downtime, maintenance, market value, replacement cost, financing, operational need.
- **Equipment purchase analysis.** Down payment, monthly payment, cash effect, debt effect, expected utilization, incremental revenue. Extends `compareBuyTiming`.
- **Hiring analysis.** Wages, payroll taxes, workers' comp, insurance, benefits, equipment, vehicle, tools, incremental capacity. Output: "This hire needs ~$14,500/month in incremental revenue at your current gross margin."

**Acceptance:** Steve #9; Joe #10 and its crew-expansion scenario.

### D11 — Scenarios v2

§36. Extends `engine/scenario`.

- New mutations: material costs +10%, lose biggest customer, add a crew, add a PM, add a location.
- Every scenario recalculates cash, revenue, profit, debt, capacity, working capital, and valuation. Today it recalculates cash only.

**Acceptance:** every `18_scenario_assumptions.md` scenario across the four accounts reproduces its stated outputs.

### D12 — Valuation and exit readiness

§32, §33.

- Revenue, EBITDA, normalized EBITDA, owner salary, distributions, discretionary and one-time expenses, recurring revenue, concentration, backlog, debt, cash, equipment, real estate, owner dependence, growth.
- Output: EBITDA-based range, SDE where relevant, asset value, enterprise value, equity value, operating company separated from real estate.
- **Exit readiness score** (0–100) across reporting quality, owner dependence, concentration, recurring revenue, management depth, EBITDA quality, backlog, process maturity, debt, growth. Top three actions that would raise value.

**Acceptance:** Steve #1, #7, #8; Robert #9, #10. Outputs match `17_valuation_data.csv` for Steve and Robert.

### D13 — AI brief and Ask Denny

§37, §38, AI security model.

- **Weekly/monthly brief** in the doc's format: health rating, plan variance, margin trend, cash runway, overdue AR, projects below margin, crew capacity, recommended actions. Reuses `buildFacts` + `verifyNarration`.
- **Ask Denny.** Natural-language questions answered through the D14 tool layer, never raw tables. Ships with the nine example questions as tests.
- **Scoped facts per question.** "Can I afford another truck" receives cash, forecast, debt, truck cost, financing, utilization, incremental revenue. Nothing else.
- **Permissions.** Read (summaries, financials, jobs, customers), Analyze (scenarios, forecasts), Write (budgets, scenarios, notes). Payments, transfers, and account changes unsupported.

**Acceptance:** the brief for each test account cites the account's own top findings; every Denny answer passes `verifyNarration`.

### D14 — Internal API and tool layer

AI Integrations section. One tool surface for Ask Denny, the ChatGPT app, and the Claude connector.

- Tools: `get_cash_position`, `get_cash_forecast`, `get_job_profitability`, `get_wip`, `get_backlog`, `get_receivables`, `get_capacity`, `get_equipment`, `get_business_valuation`, `run_scenario`.
- Each tool declares its permission scope and returns only its own slice.
- Exposed internally first (D13); externally as a remote MCP server in D17.

### D15 — Integrations, phase 1

- **QuickBooks Online**, read-oriented: chart of accounts, transactions, invoices, payments, customers, vendors, bills, expenses, AR, AP, account balances. Today's sync covers jobs, invoices, bills, purchases, and time.
- **Plaid**: checking, savings, cards, up to 24 months of transactions, balances, recurring-transaction detection. Today: balance only, dry-run.
- **Stripe**, ingest only: payments, refunds, fees, payouts. This is reading the customer's Stripe data, not DNRD billing.
- **Basic payroll import** (extends the Gusto dry-run).
- CSV and manual import from D3.

### D16 — Integrations, phase 2 (vertical)

Jobber, ServiceTitan, Housecall Pro, Procore, Buildertrend, FreshBooks (live path), Xero, payroll (Gusto, ADP, QuickBooks Payroll, Paychex), time tracking (QuickBooks Time, ClockShark, busybusy, Deputy), Square, estimating (STACK, Procore Estimating, Buildertrend, ServiceTitan). Each maps into D2 objects through the same adapter interface the CSV importer uses.

### D17 — Integrations, phase 3

Fleet and telematics (Samsara, Fleetio, Motive, Ford Pro), CRM (HubSpot, Salesforce, Jobber CRM, ServiceTitan pipeline), advanced estimating, public API, ChatGPT app and Claude connector over the D14 tools, multi-entity integrations, benchmarking, lender and accountant connections. Lower priority: Mastercard Open Finance/Finicity and MX as Plaid backups, PayPal. Venmo detected through bank transactions, no dedicated integration.

### D18 — Multi-entity and Business-tier features

Multiple entities, branches, and companies; consolidated reporting; advanced permissions; accountant/bookkeeper access; custom dashboards; data-warehouse exports; larger user counts. Add-ons scoped later: lender reporting, fractional-CFO dashboard, acquisition analysis, benchmarking, premium onboarding.

### D19 — Tax preparation package

Annual P&L, categorized expenses, payroll totals, contractor payments, asset purchases, depreciation, loan interest, owner distributions, as tax-ready exports for a CPA. No TurboTax connection.

### D20 — Plan entitlements

Feature flags for the three tiers. Not billing: payment collection waits until the product is ready to ship.

| Essentials | Pro | Business |
|---|---|---|
| Accounting + banking integration, dashboard, P&L, balance sheet, historical cash flow, AR/AP, debt, asset/fleet register, basic job profitability, basic service lines, customers, basic health score, CSV import, limited Ask Denny | Essentials + 13-week and 12-month forecasts, backlog, pipeline, WIP, over/underbilling, COs, retainage, advanced job profitability, estimate vs actual, crews, labor, recurring revenue, capacity, equipment ROI, hiring, scenarios, AI brief, expanded Ask Denny, premium integrations | Pro + multi-entity/branch, consolidated reporting, advanced permissions, accountant access, custom dashboards, advanced forecasting and capacity, valuation, exit readiness, advanced AI, API, custom integrations, warehouse exports |

Never gated: P&L, basic cash position, balance sheet, AR, debt overview, basic job profitability.

---

## Order and dependencies

```
D1 ─ D2 ─ D3 ─ D4 ─┬─ D5 ─ D6 ─ D7
                   ├─ D8
                   ├─ D9 ─ D10
                   └─ D11 (needs D5–D10) ─ D12 ─ D13 ─ D14
D15 after D2.  D16 after D15.  D17 after D14.  D18–D20 last.
```

D5–D10 can run in any order once the harness exists. D7 before D11 because scenarios recalc on the forecast.

---

## Open decisions

| Decision | Conflict | Default until decided |
|---|---|---|
| AI tone | Competitive analysis says advisory. DNRD's brief example is directive ("Delay the truck purchase until December"). | Advisory, behind a setting |
| Pricing | Competitive analysis: $99–149 / $249–299 / $399+ by employee count. DNRD: $39–79 / $99–199 / $249–499+ by feature. | DNRD tiers |
| Forecast horizon | Plumb: daily 30–365. DNRD: 13-week weekly + 12-month monthly. | Ship DNRD's, keep daily as a drill-down |
| Product name | Repo and packages are `plumb`. | Rename the UI only (D1) |
| Demo data | Synthetic seed vs four richer test accounts | Foley seed retired; the four test accounts are the demo data under demo@dnrd.test |

---

## Traceability

| Requirement | Phase |
|---|---|
| §1 Product purpose and positioning | Principles, D1 |
| §2 Financial health dashboard | D6 |
| §3 P&L | D5 |
| §4 Balance sheet | D5 |
| §5 Historical cash flow | D5 |
| §6 13-week cash forecast | D7 |
| §7 12-month forecast | D7 |
| §8 Revenue forecast | D7 |
| §9 Job profitability | D8 |
| §10 Estimate vs actual | D8 |
| §11 WIP | D8 |
| §12 Over/underbilling | D8 |
| §13 Change orders | D8 |
| §14 Retainage | D8 |
| §15 Backlog | D8 |
| §16 Pipeline | D8 |
| §17 Revenue by service line | D9 |
| §18 Customer profitability | D9 |
| §19 Crew profitability | D9 |
| §20 Labor productivity | D9 |
| §21 Capacity planning | D9 |
| §22 Recurring revenue | D9 |
| §23 Service call economics | D9 |
| §24 Accounts receivable | D6 |
| §25 Accounts payable | D6 |
| §26 Working capital | D6 |
| §27 Debt dashboard | D6 |
| §28 Fleet & equipment | D10 |
| §29 Repair vs replace | D10 |
| §30 Equipment purchase analysis | D10 |
| §31 Hiring analysis | D10 |
| §32 Business valuation | D12 |
| §33 Exit readiness | D12 |
| §34 Budget vs actual | D5 |
| §35 Forecast vs actual | D7 |
| §36 Scenario modeling | D11 |
| §37 AI financial brief | D13 |
| §38 Ask Denny | D13 |
| Subscription tiers and gating rules | D20 |
| Integrations priority 1 (QBO, FreshBooks, Xero) | D15, D16 |
| Integrations priority 2 (Plaid, Finicity, MX) | D15, D17 |
| Integrations priority 3 (Stripe, Square, PayPal, Venmo) | D15, D16, D17 |
| Tax integrations | D19 |
| Construction management (Procore, Buildertrend) | D16 |
| Field service (ServiceTitan, Jobber, Housecall Pro) | D16 |
| Payroll and time tracking | D15, D16 |
| Estimating | D16, D17 |
| CRM | D17 |
| Fleet / telematics | D17 |
| AI integrations (ChatGPT, Claude, MCP) | D14, D17 |
| AI security model | D13, D14 |
| Integration roadmap phases 1–3 | D15–D17 |
| Internal data model (27 objects) | D2 |
| Product principle (Record → Advise) | Principles |
| Long-term position | Principles |
| Test accounts (4 × 48 months) | D3, D4 |
| `19_ai_insights.md` (40 findings) | D4, acceptance per phase |
| `18_scenario_assumptions.md` | D4, D11 |
