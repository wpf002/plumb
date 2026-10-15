# Tool API

One tool surface backs Ask Denny, the internal API, and external AI connectors.

## Auth

- Signed-in members: session cookie. Scopes come from the role (`OWNER`: read, analyze, write; `MEMBER`: read, analyze).
- API keys: `Authorization: Bearer plb_...`. Created by the owner on Integrations with chosen scopes. Keys reach `/companies/:id/tools*` only. Only a SHA-256 hash is stored.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/companies/:id/tools` | Tools the caller's scopes allow, with input schemas |
| POST | `/companies/:id/tools/:name` | Body is the tool input. Returns `{ tool, facts }` |
| GET | `/companies/:id/tool-calls` | Last 50 calls (tool, caller, ok, error) |
| GET / POST | `/companies/:id/api-keys` | Owner only. POST returns the key once |
| DELETE | `/companies/:id/api-keys/:keyId` | Owner only. Revokes |

## Tools

| Tool | Scope |
|---|---|
| get_financial_summary, get_cash_position, get_job_profitability, get_wip, get_backlog, get_receivables, get_capacity, get_equipment, get_service_lines, get_customers, get_business_valuation, list_notes | read |
| get_cash_forecast, run_scenario | analyze |
| add_note, set_budget | write |

Each tool returns only its own slice as facts (`key`, `label`, pre-formatted `value`). Payments, transfers, and account changes are not exposed.
