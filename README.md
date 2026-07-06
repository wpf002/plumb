# Plumb

Financial command center for small commercial subcontractors. Not accounting
software — the **decision layer** that sits on top of QuickBooks and tells an
owner-operator whether the business is healthy, which jobs are bleeding, and
whether to bid the next one.

> Name is a placeholder (plumb line = true/accurate; a trade tool). Rename freely.

## Why this exists

The obvious wedge — "cash flow forecasting for subcontractors" — is already
occupied by funded startups (Siteline, Adaptive). Plumb's bet is narrower:

1. **The very bottom of the market.** 5–30 employee owner-operators for whom
   Adaptive (~$1k/mo) is too heavy and Siteline (pay-app/AIA billing) is the
   wrong shape — especially subs who bill owners *directly* (ISDs, cities,
   banks) with no formal pay-app workflow.
2. **The bid/capacity decision, not the billing pipeline.** Everyone forecasts
   cash and WIP. Nobody nails *"should I bid this job right now"* against
   committed labor, cash trajectory, and recent margin trend. That's the
   differentiated engine here.

Validate before scaling: run a real sub's 12 months of data through the engine
by hand, confirm which number makes them lean in, then build toward it.

## Architecture

TypeScript pnpm monorepo (Turborepo). Money is **always integer cents** — a
locked invariant, no floats anywhere.

```
apps/
  web/      Next.js 14 owner dashboard (health, cash, margins)
  api/      Fastify 5 — thin routes over the engine
packages/
  shared/   money primitives + domain types
  engine/   the value: margin, cashflow, wip, bid, health  (pure, deterministic, tested)
  db/       Prisma 7, schema + seed (phases, cost codes, budgets, WIP, QBO)
  qbo/      QuickBooks Online sync — OAuth2, API client, mappers, pull orchestrator
```

The engine is pure functions with zero I/O. Everything is deterministic and
unit-tested — auditable over impressive.

### The engine

- **margin** — original vs projected-final margin by burn rate, change-order
  impact, per-category overruns vs budget (material/labor cost-increase impact),
  at-risk flag.
- **wip** — earned revenue vs billed-to-date; over/under-billing per job and
  portfolio (the working-capital position from billing timing).
- **cashflow** — daily running balance over 30/60/90/120 days, plus a
  payment-delay **stress scenario** (receivables shifted late) and breach
  detection against a cash safety floor.
- **bid** — the wedge. Scores a prospective bid on capacity utilization by
  month (fills an idle month? overextends the crew?), cash headroom, and recent
  margin trend → `BID_AGGRESSIVE | BID_NORMAL | BID_SELECTIVE | PASS` with
  auditable reasons.
- **health** — weighted 0–100 owner rollup (cash 40 / margin 30 / capacity 15 /
  receivables 15) with plain-English alerts.

## Quickstart

```bash
./bootstrap.sh      # toolchain check, .env, local Postgres, install, db push, seed
# copy the printed company id into NEXT_PUBLIC_COMPANY_ID in .env
pnpm --filter @plumb/api dev     # :4300
pnpm --filter @plumb/web dev     # :4200
pnpm --filter @plumb/engine test # engine unit tests
```

## API

| Method | Route                                | Purpose                         |
| ------ | ------------------------------------ | ------------------------------- |
| GET    | `/companies/:id/health`              | Owner health rollup + alerts    |
| GET    | `/companies/:id/forecast?horizon=90` | Cash base + stress scenario     |
| GET    | `/companies/:id/projects`            | Per-project margin + variances  |
| GET    | `/companies/:id/wip`                 | Over/under-billing report       |
| POST   | `/companies/:id/bid`                 | Evaluate a prospective bid      |
| GET    | `/companies/:id/qbo/connect`         | QBO OAuth authorize URL         |
| GET    | `/qbo/callback`                      | QBO token exchange + first sync |
| POST   | `/companies/:id/qbo/sync`            | Re-sync from QuickBooks         |

## Roadmap

- **Phase 1 (this scaffold):** engine + deterministic forecasts + seed profile.
- **Phase 2:** QuickBooks Online two-way sync (jobs, bills, invoices, payroll).
- **Phase 3:** owner onboarding — opening cash via bank feed, capacity setup,
  per-category budgets so margin overruns are category-attributed.
- **Phase 4:** alerting (email/SMS) on breach forecasts and margin-at-risk.
- **Phase 5:** bid intake — turn a bid doc into a `ProspectiveBid` automatically.

## Locked invariants

- Money in integer cents; percentages are display/decision values, never money.
- Engine functions are pure and deterministic — no dates from `Date.now()`
  inside them; `asOf` is always injected by the caller.
- No random splits, no hidden state. Every recommendation ships its reasons.
