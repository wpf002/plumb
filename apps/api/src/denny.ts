import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, verifyNarration, type Fact } from "./ai.js";
import { callTool, toolContext, toolsFor, type Caller, type Scope, type ToolContext } from "./tools/index.js";

/**
 * Ask Denny: questions answered through the tool layer. The model (or, with no
 * API key, a fixed router) picks which tools to call, so each question sees
 * only the slice of the business it needs. Every figure in the answer must
 * match a fact a tool returned; an answer that doesn't is replaced by the
 * deterministic one.
 */

export interface DennyAnswer {
  question: string;
  answer: string[];
  source: "claude" | "deterministic";
  tools: string[];
  facts: Fact[];
  fallbackReason?: string;
}

type Calls = [string, Record<string, unknown>?][];
type Pick = (key: string) => string | undefined;

interface Intent {
  key: string;
  re: RegExp;
  calls: Calls;
  answer(v: Pick, facts: Fact[]): string[];
}

const each = (facts: Fact[], prefix: RegExp) => facts.filter((f) => prefix.test(f.key));

export const INTENTS: Intent[] = [
  {
    key: "increase_value",
    re: /(increase|raise|improve|grow|boost).*(valuation|value|worth)|make .*(more valuable|worth more)/i,
    calls: [["get_business_valuation"]],
    answer: (v) => [`Exit readiness is ${v("value.readiness")} out of 100.`, `The three levers that would raise value most: ${[v("value.action0"), v("value.action1"), v("value.action2")].filter(Boolean).join("; ")}.`],
  },
  {
    key: "worth",
    re: /worth|valuation|value of (my|the) (company|business)|sell (my|the) (company|business)/i,
    calls: [["get_business_valuation"]],
    answer: (v) => [
      `On normalized EBITDA of ${v("value.normalized")} at ${v("value.multiples")}, the business is worth ${v("value.ebitdaLow")} to ${v("value.ebitdaHigh")}.`,
      `On an SDE basis the range is ${v("value.sdeLow")} to ${v("value.sdeHigh")}.`,
      ...(v("value.realEstate") ? [`Real estate adds ${v("value.realEstate")} of equity, valued separately.`] : []),
    ],
  },
  {
    key: "buy_truck",
    re: /(buy|purchase|afford|get).*(truck|van|equipment|excavator|vehicle|skid|machine)/i,
    calls: [["get_cash_position"], ["get_cash_forecast"], ["get_equipment"], ["run_scenario", { kind: "buy_equipment" }]],
    answer: (v) => [
      `A ${v("buy.price")} truck at 20% down takes ${v("buy.down")} of cash and adds a ${v("buy.payment")} monthly payment.`,
      `It needs ${v("buy.breakeven")} of new revenue a month to pay for itself.`,
      `Cash is ${v("cash.now")} today and the 13-week low is ${v("forecast.low")}${v("forecast.shortfall") ? `, under the reserve from the ${v("forecast.shortfall")}` : ""}.`,
      ...(v("fleet.replace") ? [`If this replaces something, ${v("fleet.replace")} is the asset closest to replacement.`] : []),
    ],
  },
  {
    key: "afford_crew",
    re: /afford.*(crew|hire|employee|people|tech)|another crew|add (a|another) crew|hire/i,
    calls: [["get_cash_position"], ["get_cash_forecast"], ["get_capacity"], ["get_backlog"], ["run_scenario", { kind: "hire", count: 3 }]],
    answer: (v) => [
      `A three-person crew costs about ${v("hire.monthlyCost")} a month loaded and needs ${v("hire.revenueNeeded")} of new revenue a month at your margin.`,
      ...(v("hire.capacity") ? [`At your best year's pace they could carry ${v("hire.capacity")} of revenue a year.`] : []),
      `Signed backlog is ${v("backlog.signed")} with ${v("backlog.weighted")} of weighted pipeline.`,
      `Cash is ${v("cash.now")}; the 13-week low is ${v("forecast.low")}.`,
      ...(v("capacity.projectCrew")
        ? [`The current project crew has averaged ${v("capacity.projectCrew")} utilization.`]
        : v("capacity.headroom")
          ? [`Today's crew still has ${v("capacity.headroom")} of headroom over last year.`]
          : v("capacity.atCeiling")
            ? ["Today's field crew is already at its best-year revenue pace."]
            : []),
    ],
  },
  {
    key: "cash_next_month",
    re: /cash.*(next month|look like|forecast|coming|ahead)|next month.*cash|run out/i,
    calls: [["get_cash_forecast"]],
    answer: (v) => [
      `${v("forecast.m0.month")}: ${v("forecast.m0.in")} in, ${v("forecast.m0.out")} out, ending at ${v("forecast.m0.end")}.`,
      `The 13-week low is ${v("forecast.low")} in the ${v("forecast.lowWeek")}, against a ${v("forecast.reserve")} reserve.`,
      ...(v("forecast.shortfall") ? [`Cash goes under the reserve from the ${v("forecast.shortfall")}.`] : []),
      ...(v("forecast.loc") ? [`The credit line would need to cover ${v("forecast.loc")} at the peak.`] : []),
    ],
  },
  {
    key: "margin_fall",
    re: /margin.*(fall|fell|drop|down|declin|slip|shrink)|why.*margin/i,
    calls: [["get_financial_summary"]],
    answer: (v, facts) => {
      const moves = each(facts, /^trend\.cost\d/).map((f) => `${f.label.toLowerCase()} went from ${f.value}`);
      return [
        ...(v("trend.priorMargin") ? [`Gross margin went from ${v("trend.priorMargin")} to ${v("trend.recentMargin")} over the last three months.`] : []),
        moves.length ? `The cost lines that grew fastest: ${moves.join("; ")}.` : "No single cost line moved more than half a point of revenue.",
        `For the last full year, gross margin was ${v("summary.grossMargin")} and EBITDA margin ${v("summary.ebitdaMargin")}.`,
      ];
    },
  },
  {
    key: "owes_most",
    re: /owes?|receivable|who.*(pay|late)|collect/i,
    calls: [["get_receivables"]],
    answer: (v) => [
      `${v("ar.p0.name")} owes the most: ${v("ar.p0.owes")}, ${v("ar.p0.pastDue") === "$0" ? "none of it past due" : `of which ${v("ar.p0.pastDue")} is past due`}.`,
      ...(v("ar.p1.name") ? [`Next are ${v("ar.p1.name")} at ${v("ar.p1.owes")} and ${v("ar.p2.name") ?? ""}${v("ar.p2.owes") ? ` at ${v("ar.p2.owes")}` : ""}.`] : []),
      `Receivables total ${v("ar.total")}; ${v("ar.over30")} is more than 30 days past due.`,
    ],
  },
  {
    key: "best_line",
    re: /service line|which line|makes the most money|most profitable|best (line|segment)/i,
    calls: [["get_service_lines"]],
    answer: (v) =>
      v("lines.0.gp")
        ? [`${v("lines.0.name")} makes the most: ${v("lines.0.gp")} of gross profit on ${v("lines.0.revenue")} of revenue, a ${v("lines.0.margin")} margin.`, ...(v("lines.1.name") ? [`${v("lines.1.name")} is next at ${v("lines.1.gp")}.`] : [])]
        : [`${v("lines.0.name")} brings in the most revenue at ${v("lines.0.revenue")}.`, "Costs aren't split by line in the books, so margin by line can't be compared yet."],
  },
  {
    key: "losing_jobs",
    re: /(losing|lose|lost|lost) money|unprofitable|jobs.*(under|losing|bad|behind)|which jobs/i,
    calls: [["get_job_profitability"]],
    answer: (v, facts) => {
      const names = each(facts, /^jobs\.w\d\.name$/).map((f) => {
        const i = f.key.split(".")[1];
        return `${f.value} (${v(`jobs.${i}.margin`)}, ${v(`jobs.${i}.profit`)})`;
      });
      return [
        `${v("jobs.losingCount")} jobs lost money and ${v("jobs.activeUnderCount")} active jobs are under target margin.`,
        ...(names.length ? [`Worst first: ${names.join("; ")}.`] : []),
      ];
    },
  },
];

const FALLBACK: Intent = {
  key: "summary",
  re: /.*/,
  calls: [["get_financial_summary"], ["get_cash_position"]],
  answer: (v) => [`Last full year: ${v("summary.revenue")} revenue, ${v("summary.grossMargin")} gross margin, ${v("summary.ebitda")} EBITDA.`, `Cash is ${v("cash.now")} today.`],
};

export function routeQuestion(q: string): Intent {
  return INTENTS.find((i) => i.re.test(q)) ?? FALLBACK;
}

async function deterministic(ctx: ToolContext, question: string, scopes: Scope[], who: Caller): Promise<DennyAnswer> {
  const intent = routeQuestion(question);
  const facts: Fact[] = [];
  const used: string[] = [];
  for (const [name, input] of intent.calls) {
    try {
      const r = await callTool(ctx, name, input ?? {}, scopes, who);
      facts.push(...r.facts);
      used.push(name);
    } catch {
      // Missing permission or data: answer with what's available.
    }
  }
  const byKey = new Map(facts.map((f) => [f.key, f.value]));
  const lines = intent.answer((k) => byKey.get(k), facts).filter((s) => !/undefined/.test(s));
  return { question, answer: lines.length ? lines : ["There isn't enough data yet to answer that."], source: "deterministic", tools: used, facts };
}

const SYSTEM = `You are Denny, the CFO for a trade contractor. You answer the owner's question using only the tools provided.

Rules:
- Call the tools you need, and only those. Don't fetch data the question doesn't need.
- Every number you write must be copied exactly from a tool fact's value. Never compute, round, or estimate a number.
- Answer in at most five short sentences of plain English. No jargon like "variance" or "accrual".
- Be advisory. Say what the numbers show and what they mean; don't issue orders.
- You cannot move money, pay bills, or change accounts. If asked, say so.`;

export async function askDenny(companyId: string, question: string, scopes: Scope[], who: Caller = { caller: "denny" }): Promise<DennyAnswer> {
  const ctx = await toolContext(companyId);
  if (!process.env.ANTHROPIC_API_KEY) return deterministic(ctx, question, scopes, who);

  const client = new Anthropic();
  const tools = toolsFor(scopes).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const facts: Fact[] = [];
  const used: string[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  try {
    for (let turn = 0; turn < 6; turn++) {
      const res = await client.messages.create({ model: AI_MODEL, max_tokens: 2000, system: SYSTEM, tools, messages });
      if (res.stop_reason !== "tool_use") {
        const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
        const bad = verifyNarration(text, facts);
        if (bad) return { ...(await deterministic(ctx, question, scopes, who)), fallbackReason: bad };
        return { question, answer: text.split(/\n+/).filter(Boolean), source: "claude", tools: used, facts };
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        try {
          const r = await callTool(ctx, block.name, block.input as Record<string, unknown>, scopes, who);
          facts.push(...r.facts);
          used.push(block.name);
          results.push({ type: "tool_result", tool_use_id: block.id, content: r.facts.map((f) => `${f.key} | ${f.label} | ${f.value}`).join("\n") || "no data" });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: block.id, content: e instanceof Error ? e.message : String(e), is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return { ...(await deterministic(ctx, question, scopes, who)), fallbackReason: "too many tool calls" };
  } catch (e) {
    return { ...(await deterministic(ctx, question, scopes, who)), fallbackReason: e instanceof Error ? e.message : String(e) };
  }
}

export const EXAMPLE_QUESTIONS = [
  "Which jobs are losing money?",
  "Can I afford another crew?",
  "What will cash look like next month?",
  "Why did margin fall?",
  "Which customer owes me the most?",
  "Should I buy another truck?",
  "Which service line makes the most money?",
  "What is my company worth?",
  "What can I do to increase valuation?",
];
