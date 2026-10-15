# DNRD Test Dataset — TEST ACCOUNT 2: Landscaper Joe ("Greenscape Outdoor Living")

Synthetic, internally-consistent 4-year (Jan 2022 - Dec 2025) dataset for a growing Dallas-area
residential/commercial landscaping company, built to test DNRD's project-profitability, capacity/
utilization, and expansion-decision features ("should Joe add a second project crew?").

## How this dataset was built
- Two revenue engines: recurring maintenance (billed monthly per customer contract, with seasonality,
  price escalation, and real churn events) and project/installation work (percentage-of-completion,
  same engine as the other DNRD test accounts).
- COGS direct labor is bottom-up from actual payroll by crew (Maintenance A, Maintenance B, Project
  Crew), not assumed.
- The balance sheet balances every month by construction (`check_balance_error` = 0.00 throughout in
  `04_balance_sheet_monthly.csv`), via the same cash-flow identity and LOC-driven cash-buffer simulation
  used in the Steve dataset — here the $100,000 line of credit was never drawn, which is itself a
  meaningful signal (financing capacity in reserve) referenced in the insights and crew-expansion scenario.
- Crew utilization (`20c`, `20d`) is derived from actual modeled hours/revenue against defined crew
  capacity, not hand-picked — it shows the project crew near/at capacity while maintenance crews have room,
  which is the data-grounded basis for the crew-expansion recommendation in `18_scenario_assumptions.md`.

## File guide
| File | Contents |
|---|---|
| 01_business_profile.csv | Company overview |
| 02_chart_of_accounts.csv | GL account structure |
| 03-05 | Income statement / balance sheet / cash flow, monthly, 48 months |
| 06_customers.csv | 67 customers (55 residential, 12 commercial), lifetime revenue, concentration, AR |
| 07_projects.csv / 08_project_monthly_progress.csv | 73 install/renovation projects, POC detail |
| 09_employees.csv / 09b_payroll_monthly_detail.csv | 15 employees (2 maintenance crews + project crew) |
| 10_equipment_fleet.csv / 10b_property.csv | Fleet (trucks, mowers, mini excavator, skid steer); leased yard |
| 11_debt_master.csv + amortization schedules | Vehicle/equipment loans, undrawn LOC |
| 12-14 | AR invoices/aging, AP bills/balance |
| 15_pipeline.csv / 15b_signed_backlog.csv / 15c_lost_opportunities.csv | Open bids, backlog, and — critically — bids turned away for lack of crew capacity |
| 16_budget_vs_actual_annual.csv | Annual budget vs. actual |
| 18_scenario_assumptions.md | Full "should Joe add a 2nd project crew?" quantified build |
| 19_ai_insights.md | 10 data-grounded insights |
| 20_recurring_revenue_detail.csv / 20b / 20c / 20d | Recurring revenue detail, monthly summary, maintenance crew utilization, project crew utilization |

## Known modeling simplifications
- Inventory and prepaid expenses are simplified rolling balances, not full sub-ledgers.
- Crew capacity (hours/revenue per month) is a modeling assumption disclosed in `gen_joe_08...py` logic
  (see utilization tables) — treat the utilization *trend*, not the absolute %, as the signal.
- The proposed second crew does not exist in the historical data — it is a forward scenario only,
  fully quantified in `18_scenario_assumptions.md`.
