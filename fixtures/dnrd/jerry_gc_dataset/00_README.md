# DNRD Test Dataset — TEST ACCOUNT 4: General Contractor Jerry ("Jerry Holloway Construction, LLC")

Synthetic, internally-consistent 4-year (Jan 2022 - Dec 2025) dataset for a 12-employee Franklin, TN
residential general contractor (remodels + semi-custom/custom new construction), built to test DNRD's
WIP-schedule, overbilling/underbilling, margin-fade detection, and capacity/cash-planning features.

## How this dataset was built
- **72 projects** (60 remodels, 12 custom homes) with a **full monthly WIP schedule**
  (`08_project_monthly_wip.csv`): cost incurred (month + cumulative), approved/pending change orders,
  revised contract value, estimated total cost (current, re-estimated over time), estimated cost to
  complete, committed costs, % complete, revenue recognized, amount billed, retainage held,
  overbilling, underbilling, and projected gross profit/margin — for every active project, every month.
- Cost re-estimation is modeled as a genuine **forward-looking re-target**: when a project's estimated
  total cost changes mid-stream, the cost-to-complete for all remaining months is rescaled to the new
  estimate (not just a cosmetic note), so the actual cost incurred and the final project margin both
  reflect the change for real — this is what makes the margin-fade and standout-profitable examples
  below mathematically genuine rather than hand-typed.
- **One deliberate margin-fade project** (`CUST-062`, Custom Home - Semi-Custom): starts around 19%
  projected gross margin, takes a structural-issue cost step-up (~13%) followed by a material-price/
  change-order dispute (~9% more, only partially covered by an approved CO, with a disputed CO still
  pending), and finishes at approximately **2.5% gross margin**.
- **One deliberate standout-profitable project** (`REM-046`, Remodel - Large): a mid-project
  re-estimate comes in *under* budget (bulk material discount, efficient execution, no change orders)
  and the project finishes at approximately **29.7% gross margin** against a ~25% category average.
- COGS direct labor is bottom-up from actual payroll (not assumed); materials/subcontractor/other
  direct costs come from each project's WIP cost incurred, split by project-type cost percentages.
- The balance sheet balances every month by construction (`check_balance_error` = 0.00 throughout in
  `04_balance_sheet_monthly.csv`), including WIP-specific balance sheet lines: **retainage
  receivable**, **costs & earnings in excess of billings (underbilling, an asset)**, and **billings in
  excess of costs & earnings (overbilling, a liability)**.
- Revenue is deliberately **lumpy** ($3.21M / $4.86M / $2.87M / $3.16M across 2022-2025) because
  custom-home starts cluster unevenly on only 12 homes across 48 months — this produces a genuine net
  loss in 2024 (fixed overhead on a 12-person crew doesn't flex down with a thinner project mix), which
  is a real, traceable modeling outcome, not an injected number.
- Several months show **positive net income with sharply negative operating cash flow** (e.g.
  Nov-2023), driven by cost incurred on overlapping projects running ahead of the next milestone
  billing — a clean, data-grounded profit-vs-cash-flow example as the brief specifically asked for.
- The company leases its office/storage space (no owned real estate) — a deliberate variation across
  the four DNRD test accounts (Steve owns outright, Robert owns with a mortgage, Joe leases, Jerry also
  leases but with a much smaller footprint appropriate to a GC vs. a trades shop).

## File guide
| File | Contents |
|---|---|
| 01_business_profile.csv | Company overview |
| 02_chart_of_accounts.csv | GL account structure, incl. WIP-specific asset/liability accounts |
| 03-05 | Income statement / balance sheet / cash flow, monthly, 48 months |
| 07_projects.csv | 72 projects (master record): contract, change orders, cost splits, final outcome, performance_flag (`margin_fade` / `standout_profitable` / `normal`) |
| 08_project_monthly_wip.csv | **The full WIP schedule** — every field listed above, every project, every active month |
| 09_employees.csv / 09b_payroll_monthly_detail.csv | 12 employees (owner, 2 PM/superintendents, office manager, estimator, 7-person field crew) |
| 10_equipment_fleet.csv / 10b_property.csv | Trucks, trailers, site equipment; leased office/storage (no owned real estate) |
| 11_debt_master.csv + amortization schedules | 3 vehicle/equipment loans + an undrawn line of credit |
| 12_ar_invoices.csv / 12b / 12c / 13 | AR invoices & aging, plus retainage receivable (held on custom homes until closeout) |
| 14a-14c | Vendor list, AP bills, AP balance |
| 15_pipeline.csv / 15b_signed_backlog.csv | Open bids and signed backlog (forward-looking into 2026) |
| 16_budget_vs_actual_annual.csv | Annual budget vs. actual (GC revenue is explicitly harder to budget precisely than the other 3 accounts) |
| 18_scenario_assumptions.md | 4 scenarios: hire another crew, materials +10%, two customers pay 30 days late, how many more projects can be safely taken on |
| 19_ai_insights.md | 10 data-grounded insights |

## Known modeling simplifications
- Subcontractor-level detail (specific electrical/plumbing/HVAC sub invoices) is folded into the
  `subcontractor_cost` WIP field and AP vendor categories rather than broken out into named sub
  contracts per project.
- The line of credit was never drawn in this dataset's actual history (see Insight #3 / Scenario 3) —
  intentional, so that "what if a cash squeeze actually required it" is a forward scenario rather than
  already having happened.
- Customer records are a flat list per project (`customer_name` on `07_projects.csv`) rather than a
  separate customers table with lifetime value, since nearly every customer in this business is a
  one-time homeowner rather than a repeat relationship (unlike the recurring-revenue businesses in the
  other 3 DNRD test accounts).
