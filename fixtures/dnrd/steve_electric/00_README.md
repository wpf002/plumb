# DNRD Test Dataset — TEST ACCOUNT 1: Steve the Electrician ("Caldwell Electric Co.")

Synthetic but internally-consistent 4-year (Jan 2022 - Dec 2025) dataset for testing DNRD's
financial planning, forecasting, valuation, and operational-insight features against a
commercial electrical contractor specializing in athletic-facility lighting.

## How this dataset was built
Generated programmatically (not hand-typed) so every table reconciles:
- Revenue is recognized project-by-project via percentage-of-completion, then rolled up —
  the income statement's revenue line is a literal sum of `08_project_monthly_progress.csv`.
- Direct labor COGS is driven bottom-up from `09b_payroll_monthly_detail.csv` (actual
  employee hours/rates/burden), not assumed — project cost splits were calibrated so the
  portfolio-level implied labor cost matches real payroll capacity.
- AR/AP balances come from invoice- and bill-level simulations with customer/vendor-specific
  payment-delay distributions (`12_ar_invoices.csv`, `14b_ap_bills.csv`), not static formulas.
- The balance sheet balances in every single month by construction (see `check_balance_error`
  column in `04_balance_sheet_monthly.csv` — it is 0.00 throughout), via a cash-flow identity
  that reconciles net income, depreciation, working-capital changes, debt, capex, and
  distributions. A revolving line of credit is drawn/repaid dynamically based on an actual
  cash-buffer simulation — it maxed out in March 2022 despite the business being profitable
  that year, which is a deliberate, real example of the profit-vs-cash-flow distinction.

## File guide
| File | Contents |
|---|---|
| 01_business_profile.csv | Company overview |
| 02_chart_of_accounts.csv | GL account structure |
| 03_income_statement_monthly.csv | Revenue, COGS, opex, EBITDA, net income — 48 months |
| 04_balance_sheet_monthly.csv | Full balance sheet — 48 months, balances every month |
| 05_cash_flow_monthly.csv | Operating/investing/financing cash flow — 48 months |
| 06_customers.csv | 15 customers, lifetime revenue, concentration, AR |
| 07_projects.csv | 93 projects (32 Musco, 33 school/municipal, 28 standalone commercial) |
| 08_project_monthly_progress.csv | Month-by-month % complete, cost, revenue per project |
| 09_employees.csv / 09b_payroll_monthly_detail.csv | 7 employees, monthly payroll detail |
| 10_equipment_fleet.csv / 10b_property.csv | Fleet, heavy equipment, tools, owned real estate |
| 11_debt_master.csv + amortization schedules | Bobcat loan, 2024 truck loan, LOC |
| 12_ar_invoices.csv / 12b_ar_monthly_balance.csv / 13_ar_aging... | AR detail & aging |
| 14a-14d | Vendors, AP bills, AP balance, AP aging |
| 15_pipeline.csv / 15b_signed_backlog.csv | Open bids and signed backlog as of Dec-2025 |
| 16_budget_vs_actual_annual.csv | Annual budget vs. actual with variance |
| 17_valuation_data.csv | EBITDA, normalized EBITDA, SDE, multiple ranges, EV/equity value |
| 18_scenario_assumptions.md | The 3 scenario questions from the brief, fully quantified |
| 19_ai_insights.md | 10 data-grounded insights DNRD should be able to surface |

## Known modeling simplifications (disclosed, not hidden)
- Payroll liabilities and prepaid expenses are modeled as simplified rolling balances rather
  than full sub-ledgers.
- "Estimated" vs "actual" project costs are generated together (not literally two independent
  estimation processes), but variance is real and economically meaningful (under/over-performance
  flags), not cosmetic.
- Property (real estate) is presented as owned outright with no mortgage, consistent with the brief.
