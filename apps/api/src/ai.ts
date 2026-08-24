import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { formatUsd } from "@plumb/shared";
import type { DigestResult } from "@plumb/engine";
import type { CompanySnapshot } from "./snapshot.js";

/**
 * The AI analysis layer.
 *
 * Locked invariant: the engine computes, the model narrates. Every number the
 * owner reads is produced by a pure function and passed to the model as a fact;
 * the model's job is to decide what matters, connect causes to effects, and say
 * it in a sentence an electrician would say. It never does arithmetic, and a
 * narration containing a figure that isn't in the facts is rejected.
 */

const MODEL = process.env.PLUMB_AI_MODEL ?? "claude-opus-5";

export type AnalysisSeverity = "critical" | "warning" | "good";

export interface AnalysisConcern {
  severity: AnalysisSeverity;
  title: string;
  body: string;
  /** Engine fact keys this concern is derived from. Enforced, not decorative. */
  factKeys: string[];
}

export interface AnalysisResult {
  source: "claude" | "deterministic";
  generatedAt: string;
  headline: string;
  summary: string;
  concerns: AnalysisConcern[];
  /** Present when the model's narration failed verification. */
  fallbackReason?: string;
}

/** A number the engine computed, with the exact string the owner may be shown. */
export interface Fact {
  key: string;
  label: string;
  value: string;
  raw: number | string | null;
}

const ConcernSchema = z.object({
  severity: z.enum(["critical", "warning", "good"]),
  title: z.string(),
  body: z.string(),
  factKeys: z.array(z.string()),
});

const AnalysisSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  concerns: z.array(ConcernSchema),
});

const SYSTEM = `You are the CFO of a small commercial subcontracting business — an electrical, HVAC, plumbing, or roofing company doing $2M-$10M a year, run by an owner who is excellent at the trade and has never read a WIP schedule.

You will be given FACTS: numbers already computed from the business's books. Your job is to decide which of them matter this week, explain what is causing them, and say it the way a trusted CFO would say it out loud.

Absolute rules:
- Never compute, estimate, or infer a number. Every figure you write must be copied exactly, character for character, from a fact's value. If you want to say a number that isn't in the facts, don't say it.
- Never invent a cause you weren't given. If two facts are related, you may connect them ("the loan payment lands the same week the invoice is late"); do not speculate beyond that.
- Cite the fact keys behind each concern in factKeys.
- Be advisory, not directive. Say what is happening and what it means. Do not issue commands like "raise your bid" or "cut spending" — the owner knows their business; you are showing them what the numbers say.
- Write in plain English. No "WIP", "variance", "accrual", "EBITDA", "portfolio". Say "the Riverside job is spending faster than you bid it", not "unfavorable cost variance".
- Short sentences. The headline is one line, under 100 characters. The summary is two or three sentences.
- Order concerns by what would hurt most, worst first. At most five.`;

function fact(key: string, label: string, value: string, raw: number | string | null): Fact {
  return { key, label, value, raw };
}

/**
 * Turn the deterministic snapshot into the fact sheet the model reasons over.
 * Every value is pre-formatted here so the model never formats a number itself.
 */
export function buildFacts(snap: CompanySnapshot, digest: DigestResult): Fact[] {
  const f: Fact[] = [
    fact("company.name", "Business", snap.company.name, snap.company.name),
    fact("health.score", "Overall health score (0-100)", String(snap.health.score), snap.health.score),
    fact("cash.opening", "Cash in the bank now", formatUsd(snap.openingCashCents), snap.openingCashCents),
    fact("cash.low", "Lowest cash gets, expected", formatUsd(snap.cash.base.minBalanceCents), snap.cash.base.minBalanceCents),
    fact("cash.lowDate", "Date of that low point", snap.cash.base.minBalanceDate, snap.cash.base.minBalanceDate),
    fact("cash.end", "Cash at the end of the window", formatUsd(snap.cash.base.endingBalanceCents), snap.cash.base.endingBalanceCents),
    fact("cash.floor", "Safety floor the owner set", formatUsd(snap.company.cashSafetyThresholdCents), snap.company.cashSafetyThresholdCents),
    fact("cash.stressLow", "Lowest cash if every payer runs at their worst", formatUsd(snap.cash.stress.minBalanceCents), snap.cash.stress.minBalanceCents),
    fact("obligations.fixed", "Fixed cost every month before any job", formatUsd(snap.obligations.monthlyFixedCents), snap.obligations.monthlyFixedCents),
    fact("obligations.overhead", "Monthly overhead", formatUsd(snap.obligations.monthlyOverheadCents), snap.obligations.monthlyOverheadCents),
    fact("obligations.debt", "Monthly debt service", formatUsd(snap.obligations.monthlyDebtServiceCents), snap.obligations.monthlyDebtServiceCents),
    fact("services.monthly", "Recurring revenue per month", formatUsd(snap.services.monthlyRecurringCents), snap.services.monthlyRecurringCents),
  ];

  if (snap.cash.base.firstBreachDate) {
    f.push(fact("cash.breachDate", "Date cash goes under the safety floor", snap.cash.base.firstBreachDate, snap.cash.base.firstBreachDate));
  }
  if (snap.cash.stress.firstBreachDate) {
    f.push(fact("cash.stressBreachDate", "Date cash goes under the floor if payers run late", snap.cash.stress.firstBreachDate, snap.cash.stress.firstBreachDate));
  }

  for (const m of snap.margins) {
    const id = m.projectId;
    f.push(
      fact(`job.${id}.name`, "Job name", m.projectName, m.projectName),
      fact(`job.${id}.bidMargin`, `${m.projectName}: margin it was bid at`, `${m.originalMarginPct.toFixed(1)}%`, m.originalMarginPct),
      fact(`job.${id}.nowMargin`, `${m.projectName}: margin it is heading for`, `${m.projectedFinalMarginPct.toFixed(1)}%`, m.projectedFinalMarginPct),
      fact(`job.${id}.overrun`, `${m.projectName}: projected over budget by`, formatUsd(m.costOverrunCents), m.costOverrunCents),
      fact(`job.${id}.complete`, `${m.projectName}: how far along`, `${Math.round(m.percentComplete * 100)}%`, m.percentComplete)
    );
    if (m.overBudgetCategories.length > 0) {
      f.push(
        fact(
          `job.${id}.overBudgetAreas`,
          `${m.projectName}: cost areas running over`,
          m.overBudgetCategories.join(", ").toLowerCase(),
          m.overBudgetCategories.join(",")
        )
      );
    }
  }

  for (const b of snap.billing) {
    if (b.totalSlipDays === 0) continue;
    const name = snap.projectNames[b.projectId] ?? b.projectId;
    f.push(
      fact(`billing.${b.projectId}.slip`, `${name}: days its billing has slipped`, `${b.totalSlipDays} days`, b.totalSlipDays),
      fact(`billing.${b.projectId}.unbilled`, `${name}: still to bill`, formatUsd(b.unbilledCents), b.unbilledCents)
    );
  }

  for (const p of snap.payerBehavior) {
    f.push(
      fact(`payer.${p.payerId}.late`, `${p.name}: days past terms they typically pay`, `${p.typicalDaysLate} days`, p.typicalDaysLate),
      fact(`payer.${p.payerId}.name`, "Payer name", p.name, p.name)
    );
  }

  for (const r of snap.services.renewals) {
    f.push(
      fact(`renewal.${r.contractId}.days`, `${r.client} ${r.name}: days until it renews`, `${r.daysAway} days`, r.daysAway),
      fact(`renewal.${r.contractId}.share`, `${r.client} ${r.name}: share of recurring revenue`, `${r.shareOfRecurringPct}%`, r.shareOfRecurringPct)
    );
  }

  for (const row of snap.wip.rows) {
    if (row.state !== "UNDERBILLED") continue;
    const name = row.name ?? row.projectId;
    f.push(
      fact(
        `underbilled.${row.projectId}`,
        `${name}: work done but not yet invoiced`,
        formatUsd(-row.overUnderBillingCents),
        -row.overUnderBillingCents
      )
    );
  }

  // Weeks where obligations land on money that may not arrive. This is the
  // connection the spec asks the AI layer to make, and it is handed over as a
  // computed fact rather than left to the model to spot.
  snap.collisions.forEach((c, i) => {
    f.push(
      fact(`collision.${i}.week`, "Week where bills land on money that may be late", `${c.weekStart} to ${c.weekEnd}`, c.weekStart),
      fact(`collision.${i}.out`, "Money going out that week", formatUsd(c.outflowCents), c.outflowCents),
      fact(`collision.${i}.atRisk`, "Money coming in that week from a payer who runs late", formatUsd(c.atRiskInflowCents), c.atRiskInflowCents),
      fact(`collision.${i}.ifLate`, "Where the balance ends that week if that money is late", formatUsd(c.balanceIfLateCents), c.balanceIfLateCents),
      fact(`collision.${i}.items`, "What's in that week", c.items.map((it) => it.label).join("; "), null)
    );
  });

  // The deterministic digest's own conclusions, so the model doesn't have to
  // re-derive what the rules already established.
  digest.items.forEach((item, i) => {
    f.push(fact(`flag.${i}`, `Flag raised by the engine (${item.severity})`, item.title, item.title));
  });

  return f;
}

/**
 * Reject a narration that contains a figure the engine didn't produce.
 *
 * Currency amounts, percentages, day counts, and dates are extracted from the
 * prose and each must appear verbatim in some fact value. This is what makes
 * "no number originates in an LLM" enforceable rather than aspirational.
 */
export function verifyNarration(text: string, facts: Fact[]): string | null {
  const allowed = new Set(facts.map((f) => f.value));
  const haystack = facts.map((f) => f.value).join(" | ");

  const patterns = [
    /\$[\d,]+(?:\.\d{2})?/g, // money
    /\b\d+(?:\.\d+)?%/g, // percentages
    /\b\d{4}-\d{2}-\d{2}\b/g, // ISO dates
    /\b\d+ days?\b/g, // day counts
  ];

  for (const re of patterns) {
    for (const match of text.match(re) ?? []) {
      if (allowed.has(match)) continue;
      // A figure may legitimately appear inside a longer fact value
      // ("14 days" inside "14 days"), so accept a substring hit too.
      if (haystack.includes(match)) continue;
      return `narration contained "${match}", which is not an engine value`;
    }
  }
  return null;
}

/** The narration the product ships when there's no model — never a blank page. */
export function deterministicAnalysis(digest: DigestResult): AnalysisResult {
  return {
    source: "deterministic",
    generatedAt: new Date().toISOString(),
    headline: digest.headline,
    summary: `Health ${digest.score} out of 100. ${digest.items.length} thing${
      digest.items.length === 1 ? "" : "s"
    } to look at this week.`,
    concerns: digest.items.slice(0, 5).map((i) => ({
      severity: i.severity,
      title: i.title,
      // Some engine alerts are a single sentence that is its own detail;
      // repeating it under the title reads like a bug.
      body: i.detail === i.title ? "" : i.detail,
      factKeys: [],
    })),
  };
}

export interface Analyst {
  live: boolean;
  analyze(snap: CompanySnapshot, digest: DigestResult): Promise<AnalysisResult>;
}

class DryRunAnalyst implements Analyst {
  live = false;
  async analyze(_snap: CompanySnapshot, digest: DigestResult): Promise<AnalysisResult> {
    return deterministicAnalysis(digest);
  }
}

class ClaudeAnalyst implements Analyst {
  live = true;
  private client = new Anthropic();

  async analyze(snap: CompanySnapshot, digest: DigestResult): Promise<AnalysisResult> {
    const facts = buildFacts(snap, digest);
    const factSheet = facts.map((f) => `${f.key} | ${f.label} | ${f.value}`).join("\n");

    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `FACTS (key | what it is | value):\n${factSheet}\n\nWrite this week's read on the business.`,
          },
        ],
        output_config: { format: zodOutputFormat(AnalysisSchema) },
      });

      const parsed = response.parsed_output;
      if (!parsed) {
        return { ...deterministicAnalysis(digest), fallbackReason: "model returned no structured output" };
      }

      // Verify before showing. A wrong number in a cash forecast destroys trust
      // permanently, so a failed check falls back rather than degrading quietly.
      const known = new Set(facts.map((f) => f.key));
      const narration = [parsed.headline, parsed.summary, ...parsed.concerns.flatMap((c) => [c.title, c.body])].join(
        "\n"
      );
      const bad = verifyNarration(narration, facts);
      if (bad) {
        return { ...deterministicAnalysis(digest), fallbackReason: bad };
      }

      return {
        source: "claude",
        generatedAt: new Date().toISOString(),
        headline: parsed.headline,
        summary: parsed.summary,
        concerns: parsed.concerns.slice(0, 5).map((c) => ({
          severity: c.severity,
          title: c.title,
          body: c.body,
          factKeys: c.factKeys.filter((k) => known.has(k)),
        })),
      };
    } catch (err) {
      // The product must never be blank because an API was down.
      return {
        ...deterministicAnalysis(digest),
        fallbackReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function getAnalyst(): Analyst {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeAnalyst() : new DryRunAnalyst();
}
