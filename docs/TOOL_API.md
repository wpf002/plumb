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

# Data Sources

Every outside system implements one adapter (`apps/api/src/integrations/sources/types.ts`): `fetch` reads the live API into a `CanonicalBatch`; `sample` returns preview data that is never written. `applyBatch` writes every source the same way, keyed by `source:id`, so a rerun changes nothing.

| Endpoint | Notes |
|---|---|
| `GET /companies/:id/sources` | Each source, live or preview, last sync |
| `POST /companies/:id/sources/:key/preview` | Reads (live) or samples; writes nothing |
| `POST /companies/:id/sources/:key/sync` | Owner only; live sources only |
| `PUT /companies/:id/sources/:key/connection` | Owner only; stores credentials encrypted with `PLUMB_SECRET_KEY` |
| `GET /companies/:id/recurring-transactions` | Recurring charges and deposits found in the last 13 months of feeds |

Phase 1 sources: QuickBooks Online (OAuth), Plaid (access token from the link flow, 24 months), Stripe (restricted read key; the company's own payments, refunds, fees, payouts), Gusto (token + company id). Live paths for Stripe and Gusto have not been exercised against real accounts.

Phase 2 sources (`vertical.ts`, built with the `restAdapter` spec factory): Jobber, ServiceTitan, Housecall Pro, Procore, FreshBooks, Xero, QuickBooks Time, busybusy, Deputy, Square. ADP, QuickBooks Payroll, Paychex, ClockShark, Buildertrend, STACK, and Procore Estimating offer partner-only APIs and come in through their CSV exports. Endpoints follow each vendor's public docs; none have been run against a real account.

Phase 3 sources (`phase3.ts`): Samsara, Fleetio, Motive (telematics enrich fleet assets with miles, hours, fuel, upkeep), HubSpot, Salesforce, Jobber quotes (pipeline into opportunities), MX (backup bank feed), PayPal. Ford Pro and Mastercard Open Finance are partner-only. Venmo shows up in bank transactions.

# MCP Server (Claude Connector, ChatGPT App)

`POST /mcp` speaks MCP over Streamable HTTP with JSON responses (no SSE). Authenticate with `Authorization: Bearer plb_...`; the key fixes the company and the scopes. Supports `initialize`, `ping`, `tools/list`, and `tools/call`; write tools are annotated as such and read tools as read-only.

```json
{ "mcpServers": { "dnrd": { "type": "http", "url": "https://<api-host>/mcp", "headers": { "Authorization": "Bearer plb_..." } } } }
```

Clients that only support OAuth (claude.ai custom connectors, the ChatGPT app directory) need an OAuth authorization server in front of this endpoint; that isn't built yet.

# Benchmarks and Lender Package

- `GET /companies/:id/operations/benchmarks`: the company against other DNRD companies on this install, anonymized, shown only with three or more peers.
- `GET /companies/:id/lender-package?format=csv|json`: three years of results, covenant ratios, aging, loans, and backlog.
