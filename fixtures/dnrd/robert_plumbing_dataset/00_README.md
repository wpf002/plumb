# DNRD Test Dataset — TEST ACCOUNT 3: Robert Petty Plumbing & HVAC ("Petty Plumbing & HVAC, Inc.")

Synthetic, internally-consistent 4-year (Jan 2022 - Dec 2025) dataset for a 51-employee, multi-segment
Tulsa, OK residential/commercial plumbing & HVAC company, built to test DNRD's segment-trend analysis,
recurring-revenue tracking, technician-productivity, AR-aging, and business-valuation/exit-readiness
features ("what is my company worth, and should I sell?").

## How this dataset was built
- **Five revenue engines**, combined into one income statement: Residential Service and Commercial
  Service (ticket-based, top-down by category with realistic seasonality and price inflation — see
  `20_service_ticket_detail.csv`), Maintenance Agreements (recurring, customer-level, with escalation
  and new-signup growth — `20b_maintenance_agreement_detail.csv`), and Residential Install / Commercial
  Install (percentage-of-completion projects, same POC engine as the other DNRD test accounts —
  `07_projects.csv` / `08_project_monthly_progress.csv`).
- Segment trends were deliberately engineered and then verified against the actual generated output:
  Residential Service declining (-18% over 4 years), Residential Install more than doubling (+117%),
  Commercial Service roughly flat/noisy, Commercial Install essentially flat (+6%), and Maintenance
  Agreements the fastest-growing line (6.5% -> 14.7% of total revenue).
- COGS direct labor is bottom-up from actual payroll by crew (not assumed); install materials/
  subcontractor/equipment costs come from project-level POC cost splits; service materials are a %
  of ticket revenue (labor is already captured via payroll).
- The balance sheet balances every month by construction (`check_balance_error` = 0.00 throughout in
  `04_balance_sheet_monthly.csv`), via the same cash-flow identity and LOC-driven cash-buffer
  simulation used in the Steve and Joe datasets.
- EBITDA margin was calibrated to compress from 14.7% (2022) to 12.2% (2024) before partially
  recovering to 13.7% (2025) — "still profitable, but not as attractive as it used to be," per the
  brief — while revenue grew every year. This is a genuine, traceable effect of COGS growing faster
  than revenue in the model, not a hand-picked number.
- 64 of 372 install projects (17%) were allowed to run over their estimated cost by more than 4%
  (via a random overrun factor in the project generator), producing a concrete, data-grounded
  "margin fade" finding distinct from the macro segment-mix story.
- Two commercial AR invoices were deliberately aged into 2026 (a disputed change-order balance for
  COM-014 and a slow-paying property manager, COM-006) so the Dec-2025 AR aging snapshot has real
  31-60/61-90/90+ buckets rather than everything "Current."
- The company owns its shop/warehouse **with a mortgage** (unlike Steve, who owns outright, and Joe,
  who leases) — a deliberate variation across the four DNRD test accounts.

## File guide
| File | Contents |
|---|---|
| 01_business_profile.csv | Company overview |
| 02_chart_of_accounts.csv | GL account structure (4 revenue segments + maintenance agreements) |
| 03-05 | Income statement / balance sheet / cash flow, monthly, 48 months |
| 06_customers.csv | 220 residential + 25 commercial customers; tracked lifetime revenue & concentration is computed from maintenance-agreement + install-project relationships (service-ticket revenue is modeled top-down across hundreds of small jobs, not tied to named customers) |
| 07_projects.csv / 08_project_monthly_progress.csv | 372 install projects (334 residential, 38 commercial), POC detail, with built-in cost overruns on a subset |
| 09_employees.csv / 09b_payroll_monthly_detail.csv | 51 employees across 12 role groups (management, admin, sales, 5 field crews, supervision) |
| 10_equipment_fleet.csv / 10b_property.csv | Fleet (4 vehicle categories + 3 equipment categories); owned shop/warehouse **with a mortgage** |
| 11_debt_master.csv + amortization schedules | 3 vehicle/equipment loans, 1 commercial mortgage, 1 line of credit |
| 12-14 | AR invoices/aging (incl. deliberately-aged slow payers), AP bills/balance |
| 15_pipeline.csv / 15b_signed_backlog.csv | Open bids and signed backlog (forward-looking into 2026) |
| 16_budget_vs_actual_annual.csv | Annual budget vs. actual |
| 17_valuation_data.csv | EBITDA, normalized EBITDA, SDE, multiple ranges, enterprise/equity/real-estate value (separated) |
| 18_scenario_assumptions.md | 4 scenarios: "what's my company worth," "exit residential service," "double down on residential install," "what would increase valuation before a sale" |
| 19_ai_insights.md | 10 data-grounded insights |
| 20_service_ticket_detail.csv / 20b_maintenance_agreement_detail.csv | Ticket-based service revenue detail; recurring maintenance-agreement detail |

## Known modeling simplifications
- Residential/commercial *service-ticket* revenue is generated top-down by category (realistic
  seasonality, price inflation, ticket-count/avg-ticket detail) rather than tied to individual named
  customers — there are too many small jobs per year for per-customer tracking to be meaningful. This
  is why customer-level concentration analysis (`06_customers.csv`, `17_valuation_data.csv`) is scoped
  to maintenance-agreement and install-project relationships, which is where real concentration risk
  lives for this type of business.
- Crew/technician capacity is not an explicit hours-capacity table (unlike Joe's dataset) — technician
  productivity is instead evidenced through revenue-per-field-employee trends (see Insight #5) and
  headcount growth by hire date.
- Inventory and prepaid expenses are simplified rolling balances, not full sub-ledgers.
- The proposed additional Residential Install headcount in Scenario 3 does not exist in the historical
  data — it is a forward scenario only, fully quantified in `18_scenario_assumptions.md`.
