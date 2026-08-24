# Plumb — Roadmap

Financial planning and forecasting for small commercial subcontractors. The
decision layer on top of QuickBooks, not another accounting system.

**The one promise:** *In 15 minutes a week, know whether your subcontracting
business is healthy, which jobs are at risk, and what your cash position looks
like over the next 90 days.*

> Revised 2026-08-23 against two source documents: the **Plumb Build/Rebuild
> Spec** (running notes) and the **Plumb Competitive Landscape & Market
> Opportunity Analysis**, then built out the same day.
>
> **Phases 1–15 are shipped.** Every module in the spec and every MVP item in
> the competitive analysis is implemented; Phase 16 is the explicitly deferred
> list. §"Traceability" at the bottom maps each item in both documents to where
> it landed.

---

## Who it's for

Small commercial subcontractors — electrical, HVAC, plumbing, roofing, masonry,
drywall, concrete, and specialty trades. Owner-operated. Excellent at the trade
and at project management, no CFO, no finance staff. Today they run on
QuickBooks + a bookkeeper + spreadsheets + bank balances + gut.

- **Revenue:** $2M–$10M (tightened from the previous $1M–$25M — this is the band
  both source docs target and the band no competitor serves).
- **Headcount:** 3–50 employees, wedge at 5–30.
- **They bill both ways:** directly to owners (ISDs, cities, banks, colleges) and
  through GCs. The owner-direct half has no formal pay-app workflow — which is
  exactly where the funded competitors (Siteline) don't fit.
- **Most run two revenue models at once:** bid/project work *and* recurring
  service contracts. The product must handle both, and gate on which apply.

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
- What do I actually own, what do I owe, and what is this business worth?
- Should I buy that truck now or wait until next season?
- Will I have a cash crunch even though I'm profitable on paper?

## Positioning

**Lead with cash flow** (the competitive analysis' Option B — most acute, most
differentiated, most viscerally understood): *"Never get surprised by cash
again. Plumb turns your QuickBooks data into a 30/60/90/120-day cash forecast
built for how subcontractors actually get paid — retainage, slow GCs, and all."*

**Brand/category frame — CFO-in-a-box** (Option A), used once the buyer is
engaged: *"the CFO your subcontractor business can't afford to hire."*

Category framing (avoid "construction accounting software" — that's a red ocean):
Subcontractor Financial Planning · Trade Contractor CFO Dashboard · Job Margin +
Cash Flow Intelligence · Financial Command Center for Small Commercial Contractors.

**Non-negotiable stance:** Plumb never replaces QuickBooks. Every competitor that
replaces the GL (FOUNDATION, Sage 100/300, Jonas, CrewCost) demands a switch this
buyer won't make. Sitting on top is the position Knowify, JobTread, and Adaptive
each validated commercially.

---

## Where the build stands

| # | Module | Status | Lives in |
|---|--------|--------|----------|
| 1 | Project setup (contract, bid, budgets, margin target, terms, retainage, customer/GC) | **Built** | `Project` + `BudgetLine` + `Phase` |
| 2 | Job-cost tracking (invoices, receipts, bills, payroll/labor, change orders, by project *and* phase/cost code) | **Built** + QBO wired | `CostEntry`, `ChangeOrder`, `packages/qbo` |
| 3 | Margin tracker (original / current / projected margin, over-budget areas, CO + material impact) | **Built** | `engine/margin` |
| 4 | Cash-flow forecast (30/60/90/120, base + stress) | **Built** | `engine/cashflow` |
| 5 | Workload & bidding (booked work by month, bid aggressive/normal/selective/pass) | **Built** | `engine/bid` + `LaborCommitment` |
| 6 | Owner alerts + weekly digest | **Built (rule-based)** | `engine/health`, `engine/digest` |
| 7 | WIP over/under-billing | **Built** | `engine/wip` |
| 8 | Retainage tracking | **Built** | `engine/retainage` |
| 9 | Auth, multi-company, roles, invitations | **Built** | `apps/api/src/routes/auth.ts`, `team.ts` |
| 10 | Integrations (QBO 2-way, Plaid, payroll, FreshBooks, tax) | **Built (dry-run + live paths)** | `packages/qbo`, `apps/api/src/integrations` |
| — | Business profile (employee count, revenue model, module gating) | **Built** | `Company`, `/setup` |
| — | Assets module | **Built** | `Asset`, `engine/assets` |
| — | Liabilities module | **Built** | `Liability`, `engine/liabilities` |
| — | Recurring overhead as first-class records | **Built** | `RecurringExpense`, `engine/schedule` |
| — | Invoicing milestones | **Built** | `Milestone`, `engine/milestones` |
| — | Delay ripple (shift a milestone → forecast moves) | **Built** | `PATCH .../milestones/:id/date` |
| — | Payer behavior modeling (per-payer days-late, observed) | **Built** | `Payer`, `engine/payers` |
| — | Scenario modeling | **Built** | `engine/scenario` |
| — | Services / recurring revenue module | **Built** | `ServiceContract`, `engine/services` |
| — | AI analysis layer | **Built** | `apps/api/src/ai.ts`, `engine/collisions` |
| — | Net worth / balance sheet view | **Built** | `engine/networth`, `/balance-sheet` |
| — | Data-quality / forecast-confidence surface | **Built** | `engine/confidence`, `/data-health` |

**Honest read on the "rebuild" framing** (written before the build; kept because
it explains the ordering). The running notes call the current
build off-direction. The competitive analysis' own MVP ranking — (1) cash-flow
engine, (2) job margin bid vs actual vs projected, (3) plain-English health
screen, (4) QBO sync, (5) advisory recommendations — is largely already
shipped, and the two features it names as the sharpest wedges (retainage and
slow-payer cash effects) exist here and in no competitor's product. What's
missing is the **balance-sheet half** of the business (assets, liabilities,
overhead), the **structured billing schedule** the forecast should be driven by
(milestones), **recurring revenue**, **scenarios**, and the **AI layer**. Treat
this as additive, not a rewrite. Nothing built gets thrown away.

---

## The architectural key: a schedule-expansion layer

`engine/cashflow` takes a flat `CashEvent[]`. That is the right seam, and it
means none of the new modules require touching the forecast engine.

Every new recurring or scheduled thing — a loan payment, a lease, an insurance
premium, a service contract's monthly invoice, a project's invoicing milestone —
becomes a **generator** that expands into projected `CashEvent`s over the
horizon. One new pure module, `engine/schedule.ts`, owns that expansion. The
engine stays pure and deterministic; the forecast route just feeds it a longer
event list.

```
Assets ─┐
Liabilities ─┤
Recurring overhead ─┼→ engine/schedule.ts ─→ CashEvent[] ─→ engine/cashflow ─→ forecast
Service contracts ─┤                              ↑
Invoicing milestones ─┘              QBO actuals ─┘ (supersede projections by source id)
```

Two rules this layer must hold:
- **Projections never double-count actuals.** When a real QBO bill or payment
  matches a projected event (same obligation, same period), the actual wins.
  This extends the existing "idempotent by source id" invariant.
- **Horizon must grow.** A 120-day window can't show a loan payoff date or a
  lease expiry. Phase 9 adds a rolling 12-month mode alongside the 30/60/90/120
  headline. (This resolves the spec's open horizon question — see §Open decisions.)

---

## Build phases

### Phases 1–6 — DONE
Engine, QBO sync (read + write-back + nightly), owner onboarding (Plaid opening
cash, crew capacity, budgets, retainage), alerts + weekly digest, bid intake,
and the additional integrations (payroll, FreshBooks, tax). Plus auth,
multi-company, roles, invitations, password reset, phases/cost codes, change-order
approval. 38 tests green.

---

### Phase 7 — Business profile & module gating — DONE
*Small, unblocks gating for everything below. Do it first.*

- `Company.employeeCount: Int`, `Company.revenueModel: RevenueModel`
  (`PROJECT` | `RECURRING` | `BOTH` — default `BOTH`, which the spec says most
  trades actually are).
- Promote `Company.trade` from free String to an enum (`ELECTRICAL`, `HVAC`,
  `PLUMBING`, `ROOFING`, `MASONRY`, `DRYWALL`, `CONCRETE`, `OTHER`) — trade-specific
  landing pages and defaults depend on it later.
- Setup wizard at first login: trade → employee count → revenue model → opening
  cash → connect QuickBooks. Under 10 minutes.
- **Module gating:** nav and dashboard sections render per revenue model. A pure
  project shop never sees the Services module; a pure service shop never sees bid
  coverage.
- Settings page gains a "Business profile" card (OWNER-only, consistent with
  existing role gating).

**Done when:** a new company can be created through the wizard, and the nav
differs between a `PROJECT` and a `RECURRING` company.

---

### Phase 8 — Balance sheet: Assets & Liabilities — DONE
*The spec's items 2 and 3. Missing entirely today.*

**8a — Assets.**
- `Asset` model: `name`, `description`, `category` (`VEHICLE` | `EQUIPMENT` |
  `REAL_ESTATE` | `OTHER`), `purchaseDate`, `purchaseCostCents`,
  `currentValueCents`, `valueAsOf`, `usefulLifeMonths?`, `salvageValueCents?`,
  `disposedAt?`.
- Depreciation: **straight-line by default** when `usefulLifeMonths` is set, with a
  **manual value override that always wins** (`currentValueCents` + `valueAsOf`).
  This resolves the spec's open depreciation question without forcing the owner to
  understand MACRS — pure function `engine/assets.ts depreciatedValue(asset, asOf)`.
- Routes: `GET/POST/PUT/DELETE /companies/:id/assets`. Web `/assets` page: table
  with category grouping, purchase cost vs current value, total.

**8b — Liabilities.**
- `Liability` model with `kind`: `CREDIT_CARD` | `TERM_LOAN` | `SBA_LOAN` |
  `MORTGAGE` | `EQUIPMENT_LEASE` | `BUILDING_LEASE` | `LINE_OF_CREDIT` | `OTHER`.
- Shared fields: `name`, `lender`, `originalPrincipalCents`,
  `remainingBalanceCents`, `interestRatePct`, `paymentAmountCents`,
  `paymentFrequency`, `nextPaymentDate`, `payoffDate?`.
- Card-specific: `creditLimitCents`, `aprPct`, `currentBalanceCents`.
- Lease-specific: `termMonths`, `endDate`, `renewalTerms` (text), `assetId?` so an
  equipment lease can point at the asset it finances.
- **Amortization** (pure, `engine/liabilities.ts`): split each payment into
  interest and principal so `remainingBalanceCents` declines over the projection
  and net worth moves correctly. Simple-interest amortization is sufficient.
- Routes + web `/liabilities` page mirroring assets.

**8c — Net worth / balance sheet view.**
- `engine/networth.ts`: assets (depreciated) + cash − liabilities (amortized),
  as of a date, with a trend series.
- Dashboard card: "What the business is worth," plus a `/balance-sheet` page
  breaking out both sides.

**Done when:** entering a truck loan and the truck shows a correct net-worth line
and the loan's payments appear in the forecast (via Phase 9).

---

### Phase 9 — Recurring overhead + the schedule-expansion layer — DONE
*The spec's item 4, and the plumbing that makes 8b, 13 and 10 actually reach the
forecast. **This is the load-bearing phase.***

- `RecurringExpense` model: `name`, `category` (insurance, software, fuel,
  utilities, rent, non-job payroll, other), `amountCents`, `frequency`
  (`WEEKLY` | `BIWEEKLY` | `MONTHLY` | `QUARTERLY` | `ANNUAL`), `startDate`,
  `endDate?`, `active`. Deliberately simpler than `Liability` — the spec is
  explicit that this is a separate, low-friction entry point.
- **`engine/schedule.ts` — new pure module.** `expandSchedules(input, asOf,
  horizonDays) → CashEvent[]`, expanding: liability payments (with
  interest/principal split), recurring overhead, service contracts (Phase 13),
  and milestone-derived receivables (Phase 10).
- **Supersession rule:** each projected event carries a stable
  `sourceKey` (e.g. `liability:<id>:2026-09`). When a QBO actual matches that key
  and period, the actual replaces the projection. Test this explicitly — a
  double-counted loan payment is the exact failure that destroys trust.
- **Horizon extension:** `horizonDays` gains `365`, plus a `MONTHLY` rollup mode
  so a 12-month view stays readable. Headline stays 30/60/90/120.
- Web `/overhead` page + a "Recurring obligations" card on the dashboard showing
  the monthly fixed nut — a number most owners in this segment cannot state.

**Done when:** a $1,400/mo insurance premium and a $2,100/mo truck loan entered
once show up on every future month of the forecast, and stop double-counting when
the real QBO bill syncs.

---

### Phase 10 — Invoicing milestones + delay ripple — DONE
*The spec's item 5, and the highest-leverage single gap in the product.*

Today a project's contribution to cash is inferred; the spec wants it driven by
the contract's actual billing schedule, and wants a slipped date to ripple
automatically. Payton's weather-delay example is the acceptance test.

- `Milestone` model: `projectId`, `name`, `sequence`, `trigger`
  (`DATE` | `PERCENT_COMPLETE` | `PHASE_COMPLETE`), `triggerValue`
  (percent or `phaseId`), `expectedDate`, `amountCents`, `retainagePct`,
  `status` (`PLANNED` | `READY` | `BILLED` | `PAID`), `billedAt?`, `paidAt?`,
  `qboInvoiceId?`, `originalExpectedDate` (so slip is measurable).
- **Generator on project creation:** offer an even N-way split or a
  percent-complete schedule so entering a 12-milestone contract isn't punishing.
- **Cash derivation:** `expectedDate` + payer terms (`netDays`, then Phase 11's
  days-late) → projected inbound `CashEvent`; the retainage slice splits off into
  a `RETAINAGE_RELEASE` event at project close. Replaces inference with contract
  reality.
- **Delay ripple:** `PATCH /milestones/:id` with a new date recomputes the
  forecast and returns a **before/after delta** — "pushing Rough-In 2 weeks moves
  your low point from Nov 12 to Nov 26 and takes it $38,400 lower." Not a note
  field; a recomputation.
- **Wire the existing QBO write-back to milestones.** `POST /qbo/invoice`
  currently takes a free-text memo (`apps/web/src/app/projects/[id]/page.tsx`);
  it should bill a selected milestone, set `status = BILLED`, and roll
  `billedToDate` — which also makes WIP over/under-billing far more accurate.
- Project page: milestone schedule table with status, slip indicator, "bill this"
  and "push this date" actions.

**Done when:** dragging one milestone two weeks later visibly changes the cash
breach date on the dashboard, with no manual recalculation.

---

### Phase 11 — Payer behavior modeling — DONE
*From the competitive analysis §3.3 — the differentiator even against Siteline.*

Today stress-testing uses one global `stressDelayDays`. Real subs know that one
GC pays in 32 days and a school district takes 75.

- `Payer` model: `name`, `type` (`GC` | `OWNER_DIRECT` | `PUBLIC_ENTITY`),
  `typicalDaysLate`, `source` (`MANUAL` | `OBSERVED`), `sampleSize`.
  `Project.client` and service contracts point at it.
- **Observed mode:** derive `typicalDaysLate` from historical invoice→payment lag
  already present in synced QBO data. This is the Siteline insight, delivered to
  an owner instead of an AR department.
- Forecast uses per-payer delay; the global value becomes the fallback for payers
  with no history. Stress scenario becomes "each payer at their worst observed
  lag" rather than a flat +30 days.
- Surface it: "Riverside ISD has paid an average of 41 days late across 6
  invoices" on the project and in the digest.

**Done when:** two projects with different GCs produce different expected receipt
dates from identical invoice dates.

---

### Phase 12 — Scenario modeling — DONE
*The spec's item 7b. The "what if" half of the cash engine.*

- `engine/scenario.ts`: pure `applyScenario(baseInput, mutation) → { base,
  scenario, delta }`. Mutations, all expressible against the event list:
  - Delay a project or a specific milestone by N days.
  - A payer pays N days late (single payer or all).
  - Lose a recurring service client.
  - Take on a new loan (adds a liability + its payment schedule).
  - **Buy an asset now vs. wait N months** — the spec's truck question. Compares
    cash trough, breach date, and net worth under both timings.
  - Hire a crew member (adds payroll outflow + capacity).
  - Revenue drop of X% (the Field & Ledger drought analogue).
- Reported delta: breach date, minimum balance and its date, ending balance,
  portfolio margin.
- UI: a scenario panel on the dashboard (pick a mutation, see both lines on the
  same chart) and a "Buy now or wait?" action on each asset.

**Done when:** "should I buy this $68k truck now or in March" returns two cash
curves and a one-sentence answer with its reasons.

---

### Phase 13 — Services / recurring revenue module — DONE
*The spec's item 6. The competitive analysis explicitly recommends deferring it
behind the cash-flow work — hence its position here, not earlier.*

- `ServiceContract` model: `payerId`, `name`, `amountCents`, `billingFrequency`,
  `startDate`, `endDate?`, `renewalDate?`, `autoRenew`, `status`.
- Intentionally simpler than `Project` — the spec is clear there's no
  estimate-vs-actual tracking here, just predictable recurring inflow.
- Feeds `engine/schedule.ts` as recurring inbound events, through the same payer
  terms as milestones.
- Gated on `revenueModel` including `RECURRING` (Phase 7).
- Health/digest additions: renewal coming up, churn risk ("this contract is 22%
  of your recurring revenue and renews in 40 days").
- Web `/services` page.

**Done when:** a landscaping-style company with 30 monthly contracts and two
winter projects gets one coherent forecast from both.

---

### Phase 14 — AI analysis layer — DONE
*The spec's item 8. Currently the digest writes templated strings; there is no
model in the repo.*

**Architecture stance:** the engine remains the single source of numeric truth.
The model narrates and prioritizes; it never computes. It receives the
deterministic snapshot (`apps/api/src/snapshot.ts` already exists as that single
source) and returns prose plus an ordered list of concerns, each referencing an
engine value by key. Any sentence that can't be traced to a snapshot value is a
bug.

The three jobs the spec names:
1. **Margin trend → impact.** "Actual costs on Riverside are trending 14% over
   the framing budget; at this pace the job lands at 6.2% margin against an 12%
   bid."
2. **Cash-risk collision detection.** The spec's specific example — a liability
   payment landing the same week as a delayed invoice. Requires Phases 9 and 10;
   it is not expressible until obligations and milestones are structured data.
3. **Buy-vs-wait recommendation** over the asset/liability/cash picture, on top of
   Phase 12's scenario output.

Plus a plain-English rewrite of the health screen — the competitive analysis
argues this *is* the value proposition, not a feature: "You're trending $8,200
under margin on the Riverside job because of a materials overrun in framing"
instead of a variance table.

**Guardrails:**
- **Advisory, not prescriptive, at launch.** Surface flags and context, not
  commands. Earn prescriptiveness with proven accuracy. (Resolves the spec's open
  question in the direction the competitive analysis recommends.)
- Every statement ships its reasons — already a locked invariant.
- Deterministic fallback: if the model call fails, the existing templated digest
  renders. The product must never be blank because an API was down.
- Model: Claude, called server-side from the API; snapshot in, structured
  narration out.

**Done when:** the weekly digest reads like a CFO wrote it, and every number in it
can be clicked back to its source rows.

---

### Phase 15 — Trust, data quality & time-to-value — DONE
*Cross-cutting. Directly addresses risks 2, 4 and 5 in the competitive analysis
— the ones most likely to kill the product regardless of feature completeness.*

- **Forecast-confidence indicator.** On connect and continuously: are jobs tagged
  in QBO, are bills categorized, is opening cash fresh, do projects have budgets
  and milestones. Show a confidence level and *exactly what's missing to raise
  it*. A garbage-in dashboard is worse than the spreadsheet the owner half-trusts.
- **Sync health, always visible.** Last successful sync and any failures shown on
  every screen that displays money. A silent stale sync showing the wrong cash
  position is the single highest-stakes failure mode for a forecasting product.
- **Reconciliation view.** Plumb's cash position vs. the bank/QBO balance, with
  the difference itemized. This is how an owner decides to trust the number.
- **Drill-down everywhere.** Every displayed figure opens the rows behind it.
- **Fast first value.** Connect QuickBooks → see a real cash forecast before any
  manual project entry is required. Manual data deepens it; it isn't the gate.
- **Health-screen simplification audit.** The dashboard currently renders six
  sections (health, needs attention, cash, margins, WIP, retainage). The
  competitive analysis argues for 3–5 numbers in plain English as the hero, with
  depth below the fold. Restructure, don't delete.

**Done when:** a skeptical owner can answer "why should I believe this number?"
without asking anyone.

---

### Phase 16 — Deferred / post-MVP
Explicitly parked, with reasons:

- **Workload & bidding coverage** — already built (`engine/bid`). The competitive
  analysis calls it genuinely novel but additive. Validate with real users before
  expanding it further.
- **Asset depreciation for tax basis / reporting** — Phase 8's straight-line model
  is for decision support, not tax filing. Don't let it drift into tax software.
- **Multi-entity / consolidated reporting** — beyond the $2–10M ICP.
- **QuickBooks Desktop and Sage connectors** — QBO first and well, per the
  competitive analysis' warning that FieldPulse's sync reputation is a cautionary
  tale. Breadth after reliability.
- **Automated milestone extraction from contract PDFs** — high value, high effort;
  Phase 10's manual entry plus generator has to prove the model first.

---

## Open decisions (from the source docs, resolved or still open)

| Question | Status | Recommendation |
|---|---|---|
| Cash-flow projection horizon | **Resolved in Phase 9** | Keep 30/60/90/120 as the headline; add a rolling 12-month monthly rollup, required once multi-year liabilities and leases exist. |
| How prescriptive should the AI be | **Resolved in Phase 14** | Start advisory (flags + context), move prescriptive only as accuracy is proven. Both docs point this way. |
| Depreciation: standard method or manual updates | **Resolved in Phase 8a** | Straight-line as the default, manual value override always wins. Owner never has to know the method. |
| Beachhead trade | **Open — for Will and Payton** | Competitive analysis suggests electrical or HVAC (organized associations, right company sizes). The existing warm design partner should probably decide this. |
| Pricing dimension | **Open** | Source doc recommends flat monthly by employee-count tier with unlimited users; the previous roadmap tiered by feature. Employee-count banding matches the profile data Phase 7 collects. Not a build task — decide before it is. |

---

## Competitive bar (what to match, where to win)

**Must match (table stakes):**
- Two-way QuickBooks Online sync — non-negotiable. **Done**, but Phase 15's
  reliability surface is what makes it trustworthy.
- Cost by phase + cost code, not flat categories. **Done.**
- WIP over/under-billing. **Done** — sharpens further once milestones (Phase 10)
  drive `billedToDate`.
- Change-order approval flow. **Done.**
- Onboarding under ~30 minutes. Phase 7 wizard + Phase 15 fast-first-value.

**Where Plumb wins (nothing in the researched competitive set does these):**
- **Forecasting that actually forecasts.** Every product surveyed reports the past
  (actuals, WIP, budget variance) or the present (AR aging). Only Siteline looks
  forward, and only at payment timing. Committed job costs + recurring overhead +
  liability payments + retainage-adjusted receivables in one rolling view is the
  clearest wedge. Phases 9–10 complete it.
- **Owner-facing, not controller-facing.** Jonas, Adaptive, Sage Intacct and
  Siteline all assume accounting literacy. Plain English is the whole product
  (Phase 14), not a feature.
- **Payer-behavior modeling connected to job costing.** Siteline proved
  GC-payment-pattern forecasting is buildable but built it for AR teams and never
  connects it to margin. Phase 11.
- **Bid/no-bid decision engine.** Still unoccupied. Knowify/JobTread help you
  *build* a bid; Adaptive forecasts costs. None answer "should I take this job
  given my committed crew and worst-case cash." **Already built** — keep central.
- **Breach date as a headline number.** They forecast cash; Plumb forecasts the
  date you run out. Sharper and more owner-legible.
- **Price + simplicity at the floor.** Adaptive starts at $5M-revenue customers;
  Knowify's job costing is gated behind a $329–399/mo tier; CrewCost is
  $999–1,699/mo *and* demands leaving QuickBooks.

Competitors to keep watching: Siteline (subs, pay-app/AR, real forecasting),
Adaptive (AI layer on top of QBO/Sage, closest structural analog, $5M+ floor),
Knowify (best trade-specific fit, best QBO sync, no forecasting), JobTread,
CrewCost, Procore Financials, FOUNDATION, Sage 100/300/Intacct, Jonas,
FieldPulse, Buildertrend, Contractor Foreman, Levelset, QuickBooks Cash Flow
Planner.

---

## Pricing (working model)

The competitive analysis puts the segment's ceiling around Knowify's Advanced
tier ($329–399/mo) and floors it near Contractor Foreman/FieldPulse ($49–199/mo).
Stay under ~$400–500/mo to avoid competing on Adaptive's or Jonas's turf.

Flat monthly, **no per-seat** (per-user pricing penalizes exactly the
owner + office manager + bookkeeper visibility this product should encourage —
CrewCost and JobTread both use unlimited users within a tier):

- **Under 10 employees** — health score, cash forecast, margin tracker, QBO sync.
- **10–30 employees** — + WIP, alerts, bid engine, scenarios.
- **30–50 employees** — + bank feed, payroll/tax integrations, multi-user roles.

Employee-count banding is the recommended dimension (matches Phase 7's profile
data and is the easiest for an owner to understand); revenue banding aligns better
to ability to pay but forces revenue disclosure during signup, which is friction
for self-serve. A trial that connects QuickBooks and shows a real forecast before
asking for manual entry is the conversion mechanism (Phase 15).

## Go-to-market

The unfair advantage is **distribution, not the product** — a warm design partner
(your dad) and his DFW trade network. That's what the funded competitors burn
millions to acquire.

1. Land your dad as design partner + first case study.
2. Referral into his direct network (other trades on the same GC jobs), supply
   houses, and trade associations (IEC, ABC, NECA, PHCC, local chapters).
3. **Bookkeeper/CPA channel** — construction-specialized bookkeepers and
   QuickBooks ProAdvisors are the closest thing to a financial advisor this owner
   has, and no researched competitor leans on this channel. High leverage, low CAC.
4. **Narrow beachhead trade first** (electrical or HVAC), deep before wide —
   mirroring how Knowify and Siteline built early traction, including
   trade-specific landing pages.
5. Content on the specific, searchable pain: "profitable on paper, broke in the
   bank," "will I make payroll in 6 weeks," "is this job actually profitable."
   Don't fight Procore/Buildertrend/Sage on generic "construction software" terms.
6. QuickBooks App Store listing — this buyer is already shopping for add-ons there.

**Model:** QBO-add-on-adjacent, **service-assisted SaaS** moving toward self-serve.
Onboard the first handful of subs by hand — a guided setup call, not a 3–6 month
implementation — to beat the trust and data-quality risks, then shrink the service
layer as accuracy proves out. Not standalone (you need QBO's data), not a pure
consulting play (it anchors the business as a services company that never makes
the transition).

---

## Validate before scaling (do this in parallel with Phase 7–9)

Cheap and decisive, one weekend:
1. Pull your dad's last 12 months of QBO export + a couple of bid docs.
2. Run them through the engine: health score, 90-day cash base + stress, margin vs
   bid per job, WIP over/under, capacity by month, retainage outstanding.
3. Show him and 3–5 subs in his network. Watch which number makes them lean in.
   - Leans on "when's my cash tight" → that's now the *lead* positioning, and the
     Siteline/Adaptive overlap is narrower than it looks (they're staff-facing).
   - Leans on "should I bid the next one" or "which job is quietly bleeding" →
     that's the wedge; build toward it with proof in hand.

## Customer-discovery questions

**Current state / pain**
- Walk me through how you found out whether last month was a good or bad month.
  What did you look at, and how long did it take?
- When were you last surprised by a cash shortfall? What caused it, how did you
  find out?
- How do you know whether a specific job is making or losing money *during* the
  job, not after it closes?
- Who do you trust today for financial visibility — bookkeeper, accountant,
  spreadsheet, gut?
- What happens when a GC or property owner pays you 30+ days late? How do you find
  out, and what do you do?
- Have you ever won work you couldn't staff, or taken a job that lost money you
  didn't catch until the end?

**Willingness to adopt / pay**
- If a tool told you in plain English "here's your cash position for the next 90
  days and here's what's driving it," what's that worth monthly?
- What's stopped you from adopting a tool like this already?
- How do you decide today whether to bid, hire, or hold off? What's missing when
  you make that call?
- Would you act on a software recommendation ("invoice now," "you can afford that
  truck")? What would it take to earn that trust?

**Workflow / integration fit**
- What accounting software do you use, and how confident are you the data is
  accurate and current?
- Who enters bid estimates, tracks change orders, and reconciles actuals — you, an
  office manager, a PM, or no one formally?
- How do you track retainage owed to you? Do you know today how much is sitting
  out there uncollected?
- How often would you actually open this — daily, weekly, only when something feels
  off?

## Riskiest assumptions (kill these early)

1. **Owners will connect QuickBooks.** If they won't grant access, the decision
   layer starves. Test in the first 3 interviews.
2. **The data is clean enough.** Forecast quality depends on jobs being tagged and
   bills categorized — and this segment is the least likely to have that
   discipline. Phase 15's confidence indicator is the hedge; it doesn't eliminate
   the risk.
3. **Owners will trust a second system's numbers over their bookkeeper's or their
   gut.** Unproven, and the AI layer raises the bar further. Phase 15 exists for
   this.
4. **This segment will pay for a planning layer on top of tools they consider
   already paid for.** QuickBooks feels free/sunk to the owner. Intangible
   ("peace of mind about cash") is a harder sell than transactional (invoicing,
   dispatch, payroll).
5. **Integrations stay reliable enough to earn trust.** A sync error showing the
   wrong cash position breaks trust permanently — much higher stakes for a
   forecasting product than a scheduling one.
6. **The AI layer is more than a gimmick.** Generic or occasionally wrong
   recommendations read as noise to an owner who knows their business by feel.
7. **The bid decision is the wedge, not cash forecasting.** If everyone only cares
   about "when's cash tight," you're closer to funded incumbents than you'd like.
8. **The market is reachable and large enough.** No narrowly-positioned competitor
   was found — genuine whitespace, or a market too fragmented, hard to reach, and
   price-sensitive for anyone to have served profitably. Live question, not an
   assumption.

---

## Traceability — every item in both source documents

**Build/Rebuild Spec (running notes, 2026-08-23)**

| Spec item | Where it lands |
|---|---|
| 1. Business profile / setup (trade, employee count, revenue model, module gating) | **Phase 7** |
| 2. Assets module (category, purchase date/cost, current value, depreciation) | **Phase 8a** |
| 2b. Feeds net worth / balance sheet | **Phase 8c** |
| 2c. Buy-vs-wait scenario support | **Phase 12** |
| 3. Liabilities (cards, loans, mortgages, equipment + building leases) | **Phase 8b** |
| 3b. Every liability generates a recurring outflow into the cash engine | **Phase 9** |
| 4. Recurring overhead (amount + frequency, separate simple entry) | **Phase 9** |
| 5. Projects — contract basics | Built (`Project`) |
| 5b. Estimated cost line items at bid time | Built (`BudgetLine`) |
| 5c. Actual costs logged over the job | Built (`CostEntry`, QBO sync) |
| 5d. **Live** estimate-vs-actual comparison | Built (`engine/margin`, project page) |
| 5e. **Invoicing milestones** (expected date + amount, contract triggers) | **Phase 10** |
| 5f. **Delay tracking — shifting a milestone ripples into the forecast** | **Phase 10** |
| 6. Services module (recurring revenue, client, amount, frequency, term) | **Phase 13** |
| 7. Cash flow engine — combined forward view | Built (`engine/cashflow`), extended by **Phases 9–11** |
| 7b. Horizon decision | **Resolved** — see Open decisions |
| 7c. Scenario modeling (delay, new loan, lost client, revenue drop) | **Phase 12** |
| 8. AI layer — margin trend → margin impact | **Phase 14** |
| 8b. AI layer — cash risk collision (liability payment vs delayed invoice) | **Phase 14** (needs 9 + 10) |
| 8c. AI layer — buy-vs-wait recommendation | **Phase 14** (needs 12) |
| 8d. Prescriptive vs advisory decision | **Resolved** — advisory first |
| Open: depreciation method | **Resolved** — Phase 8a |

**Competitive Landscape & Market Opportunity Analysis (2026-08-23)**

| Analysis item | Where it lands |
|---|---|
| MVP 1 — cash-flow engine as the anchor | Built + **Phases 9–10** |
| MVP 1b — retainage adjustment | Built (`engine/retainage`) |
| MVP 1c — expected payer behavior override ("this GC pays 30–45 days late") | **Phase 11** |
| MVP 2 — job margin bid vs actual vs projected-final, one simple visual | Built; simplification in **Phase 15** |
| MVP 3 — lightweight business-health home screen, 3–5 numbers, plain English | **Phases 14 + 15** |
| MVP 4 — QuickBooks Online sync as core infrastructure | Built; reliability surface in **Phase 15** |
| MVP 5 — advisory, not prescriptive, recommendations | **Phase 14** |
| MVP 6 — defer workload/bidding, buy-vs-wait, Services | **Phases 12, 13, 16** |
| Differentiator 1 — forecasting that actually forecasts | **Phases 9–10** |
| Differentiator 2 — owner-facing not controller-facing | **Phase 14** |
| Differentiator 3 — retainage + slow-payer modeling for trades' real customers | **Phase 11** |
| Differentiator 4 — true non-replacement layer at the right price | Positioning + Pricing above |
| Differentiator 5 — workload/bidding coverage as a distinct module | Built (`engine/bid`); validate, **Phase 16** |
| Risk 2 — data availability and cleanliness | **Phase 15** (confidence indicator) |
| Risk 4 — integration reliability | **Phase 15** (sync health, reconciliation) |
| Risk 1/3/5/6 — trust, willingness to pay, AI usefulness, market size | Discovery + Riskiest assumptions above |
| §5 discovery questions | Merged into Customer-discovery above |
| §7 positioning — lead cash-flow-first (B), CFO-in-a-box as brand (A) | Positioning above |
| §8 pricing — flat monthly by size tier, unlimited users, under ~$400–500 | Pricing above |
| §9 GTM — beachhead trade, bookkeeper channel, associations, content, QBO store, trial | Go-to-market above |
| §10 product form — QBO-native add-on, service-assisted → self-serve | Go-to-market above |

---

## Where it stands

Phases 1–15 are committed. Full monorepo build green (6/6); 118 tests pass
(engine 91, api 18, qbo 9). Reference profile: Foley Electric, a $6M commercial
electrical sub — 2 open jobs with 10 billing milestones, 5 assets, 5 liabilities,
7 recurring overhead lines, 4 service contracts, 2 payers with 9 settled
invoices of payment history.

What is **not** built, deliberately: everything in Phase 16, and the live paths
that need real credentials (QuickBooks OAuth against a real Intuit app, Plaid,
Gusto, and an `ANTHROPIC_API_KEY` for the written analysis). Each of those runs
as a non-mutating dry run without credentials and switches to the live path when
its key is set — the dry-run behaviour is tested; the live behaviour is tested
against mocked transports, not a real account.

## Locked invariants

- Money in integer cents; percentages are display/decision values, never money.
- Engine functions are pure and deterministic; `asOf` is injected, never
  `Date.now()` inside the engine.
- Every recommendation ships its reasons. Auditable over impressive.
- QBO sync is idempotent by source id; re-running never double-counts. **Projected
  schedule events extend this rule — an actual always supersedes its projection.**
- The engine computes; the model narrates. No number originates in an LLM.
- Plumb never replaces QuickBooks.
