# Plumb — Roadmap

Financial command center for small commercial subcontractors. The decision layer
on top of QuickBooks, not another accounting system.

**The one promise:** *In 15 minutes a week, know whether your subcontracting
business is healthy, which jobs are at risk, and what your cash position looks
like over the next 90 days.*

---

## Who it's for

Small commercial subcontractors — electrical, HVAC, plumbing, roofing, masonry,
drywall, concrete, and specialty trades. Owner-operated. Excellent at the trade
and at project management, no CFO, no real financial-planning process. Today they
run on QuickBooks + a bookkeeper + spreadsheets + bank balances + gut.

- **Revenue:** $1M–$25M, early sweet spot $2M–$10M.
- **Headcount:** 5–100 employees, wedge at 5–30.
- **They bill both ways:** directly to owners (ISDs, cities, banks, colleges) and
  through GCs. The owner-direct half has no formal pay-app workflow — which is
  exactly where the funded competitors (Siteline) don't fit.

## The core problem

Subcontractors know if they made money *after the fact*. They can't answer, in
real time: how healthy am I now, which jobs are profitable, when is cash coming
in vs going out, do I have enough booked work, and should I bid the next job.
Construction makes this brutal — you pay labor and materials, float costs,
absorb delays and change orders, and wait on progress payments and retainage
before cash lands. A subcontractor can be profitable on paper and still hit a
cash crunch.

The questions Plumb exists to answer, directly:
- How healthy is the business right now?
- How much cash comes in / goes out over 30 / 60 / 90 / 120 days?
- Which jobs are profitable, and which are trending below bid margin?
- Are material costs, labor overruns, delays, or change orders hurting a job?
- Is there enough booked work to carry the next few months?
- Should I bid more, hire, slow down, buy equipment, or protect cash?
- What happens if a GC / school / city / bank pays 30 days late?
- How does retainage affect near-term cash?
- Will I have a cash crunch even though I'm profitable on paper?

## Positioning

Primary: **"CFO visibility for subcontractors, without hiring a CFO."**
Alternates: *"Know your cash, margins, and workload before it becomes a problem."*
· *"Financial planning for trade contractors who run on QuickBooks but decide
from their gut."*

Category framing (avoid "construction accounting software" — that's a red ocean):
Subcontractor Financial Planning · Trade Contractor CFO Dashboard · Job Margin +
Cash Flow Intelligence · Financial Command Center for Small Commercial Contractors.

---

## The six modules (from the original concept) → where they live

| # | Module | Status | Lives in |
|---|--------|--------|----------|
| 1 | Project setup (contract, bid, labor/material/other budgets, margin target, terms, retainage, customer/GC) | Built | `Project` + `BudgetLine` + `Phase` |
| 2 | Job-cost tracking (invoices, receipts, bills, payroll/labor hours, material, travel/equipment, change orders, by project *and phase/cost code*) | Built (manual) + QBO wired | `CostEntry`, `ChangeOrder`, `packages/qbo` |
| 3 | Margin tracker (original / current / projected margin, over-budget areas, change-order + material-increase impact) | Built | `engine/margin` |
| 4 | Cash-flow forecast (30/60/90/120, cash in/out, payroll, vendor, retainage, tax/insurance/loan, worst-case delay) | Built | `engine/cashflow` |
| 5 | Workload & bidding (booked work by month, under/over-covered months, bid aggressive/normal/selective/pass) | Built | `engine/bid` + `LaborCommitment` |
| 6 | Owner alerts (cash-threshold breach date, margin-at-risk, under-booked month, material % over, invoice-this-milestone) | Partial | `engine/health` |

Plus **WIP over/under-billing** (`engine/wip`) — a table stake the original brief
didn't name but every serious competitor ships; it's also the bridge between
margin and cash (bill timing drives the forecast).

---

## Build phases

**Phase 1 — Engine + deterministic forecasts (DONE).**
margin / cashflow / wip / bid / health, all pure and unit-tested. Money in
integer cents. Seed models a reference electrical sub (Foley Electric).

**Phase 2 — QuickBooks Online sync (DONE — this scaffold).**
OAuth2, API client with token refresh, pure mappers, idempotent pull
orchestrator. QBO Customer:Job → Project; Invoice → inbound cash + billedToDate;
Bill/Purchase → job cost + outbound cash; TimeActivity → labor hours. This is the
**price of admission** — the decision layer is garbage-in without clean cost and
cash-timing data. Remaining in this phase: schedule the sync (node-cron), harden
the account/item → category mapping with a per-company override table, and add
QBO **write-back** (create invoice) once read sync is proven.

**Phase 3 — Owner onboarding.**
Opening cash via bank feed (Plaid) replacing the manual `CashSnapshot`; crew
capacity setup; per-category/phase budgets so every overrun is attributed;
retainage schedule per contract feeding the cash forecast.

**Phase 4 — Alerts + weekly digest.**
Email/SMS on forecast breach, margin-at-risk, under-booked month, and
"invoice this milestone this week to avoid a crunch." This is what delivers the
15-min-a-week promise — the owner shouldn't have to log in to get the signal.

**Phase 5 — Bid intake.**
Turn a bid into a `ProspectiveBid` without manual entry: parse an estimate
(CSV/PDF export from the estimating tool the sub already uses) into contract
value, estimated cost, target margin, and labor hours by month, then run
`evaluateBid` automatically so "should I bid this?" fires the moment the
estimate exists.

**Phase 6 — More integrations.**
FreshBooks (alt to QBO for smaller shops), payroll systems (Gusto/ADP) for true
labor cost + hours, and tax tools (TurboTax/tax-pro export) for tax obligation
timing in the cash forecast.

---

## Competitive bar (what to match, where to win)

**Must match (table stakes):**
- Two-way QuickBooks Online sync — non-negotiable; Knowify and Adaptive both do
  it. (Phase 2, read done; write-back to finish.)
- Cost by phase + cost code, not flat categories. (Schema done; needs UI.)
- WIP over/under-billing. (`engine/wip` done.)
- Change-order approval flow. (Data model + `approvedAt` done; needs workflow UI.)
- Onboarding under ~30 minutes. (Design constraint for Phase 3.)

**Where Plumb wins:**
- **Bid/no-bid decision engine.** Nobody occupies this. Knowify/JobTread help you
  *build* a bid; Adaptive *forecasts*. None answer "should I take this job given
  my committed crew and worst-case cash." That's `evaluateBid` — keep it central.
- **Payment-delay stress as a headline number.** They forecast cash; Plumb
  forecasts the *breach date*. Sharper and more owner-legible.
- **Price + simplicity at the floor.** Adaptive starts ~$1k/mo; Knowify runs a
  per-user model (~$3k/yr in seat fees for 10 users) with a dated UI. Flat-rate,
  no per-seat, one health score + three alerts.
- **Owner framing, not accountant framing.** The winning user is the owner who
  won't open an ERP.

Competitors to keep watching: Siteline (subs, pay-app/AR, $18.4M raised),
Adaptive (AI construction finance, $19M raised), Knowify, JobTread, Procore
Financials, FOUNDATION, QuickBooks for Construction, FieldPulse, Buildertrend,
Sage, Jonas.

---

## Pricing (working model)

Flat monthly, no per-seat, three tiers:
- **Solo** (~$79/mo): health score, cash forecast, margin tracker, manual entry.
- **Connected** (~$199/mo): + QBO sync, WIP, alerts, bid engine.
- **Command** (~$399/mo): + bank feed, payroll/tax integrations, multi-entity.

Deliberately undercuts Adaptive ($1k) and dodges Knowify's per-user creep. Land
on Connected; Solo is the trial-killer for the 5-person shop.

## Go-to-market

Your unfair advantage is **distribution, not the product** — a warm design
partner (your dad) and his DFW trade network. That's what the funded competitors
burn millions to acquire.
1. Land your dad as design partner + first case study.
2. Referral into his direct network (other trades on the same GC jobs) and his
   supply houses / trade associations (IEC, ABC, local chapters).
3. Bookkeeper/CPA channel — construction-specialized bookkeepers who set up
   QBO for contractors are a repeatable referral source (they already do
   JobTread + QBO setups).
4. Content on the specific pain: "profitable on paper, broke in the bank."

**Model recommendation:** build it as a **QBO-add-on-adjacent, service-assisted
SaaS** — not standalone (you need QBO's data), not a pure consulting play. Start
service-assisted: onboard the first handful of subs by hand so you learn the real
decision they care about before over-building.

---

## Validate before scaling (do this first, in parallel with Phase 3)

Cheap and decisive, one weekend:
1. Pull your dad's last 12 months of QBO export + a couple of bid docs.
2. Run them through the engine (or by hand in a sheet): health score, 90-day
   cash base + stress, margin vs bid per job, WIP over/under, capacity by month.
3. Show him and 3–5 subs in his network. Watch which number makes them lean in.
   - Leans on "when's my cash tight" → Siteline/Adaptive own that; reconsider.
   - Leans on "should I bid the next one" or "which job is quietly bleeding" →
     that's the wedge; build toward it with proof in hand.

## Customer-discovery questions (for the interviews)

- How do you decide today whether to bid a job? What do you look at?
- Have you ever won work you couldn't staff, or taken a job that lost money you
  didn't catch until the end?
- When did you last get surprised by a cash crunch? What caused it?
- How do you track whether a job is beating or missing its bid margin — and when
  do you find out?
- How much of your AR is late right now, and how do you know?
- What do you use QuickBooks for, and what does it *not* tell you?
- If a tool told you one thing each week, what would you want it to be?

## Riskiest assumptions (kill these early)

1. **Owners will connect QuickBooks.** If they won't grant QBO access, the whole
   decision layer starves. Test in the first 3 interviews.
2. **The bid decision is the wedge, not cash forecasting.** If everyone only cares
   about "when's cash tight," you're competing head-on with funded incumbents.
3. **This segment will pay and adopt.** Trades are notoriously low-adoption; the
   bottom of the market is why Siteline/Adaptive went *up*, not down.
4. **Data is clean enough.** Job costing quality in a 5-person shop's QBO may be
   too messy for accurate margins without setup help (hence service-assisted).
5. **Distribution actually compounds.** One warm design partner ≠ a channel;
   prove the referral step works before building for scale.

---

## Locked invariants

- Money in integer cents; percentages are display/decision values, never money.
- Engine functions are pure and deterministic; `asOf` is injected, never
  `Date.now()` inside the engine.
- Every recommendation ships its reasons. Auditable over impressive.
- QBO sync is idempotent by source id; re-running never double-counts.
