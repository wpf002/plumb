import type { FastifyInstance } from "fastify";
import {
  balanceSheet,
  budgetVsActual,
  cashFlowStatement,
  columnsFor,
  incomeStatement,
  incomeTotals,
  priorPeriod,
  priorYear,
  profitVsCash,
  type Column,
  type View,
} from "@plumb/engine";
import { loadLedger } from "../analytics/ledger.js";
import { budgetRows } from "../analytics/statements.js";
import { companyAsOf } from "../snapshot.js";
import { periodOf } from "../import/csv.js";
import { taxCsv, taxPackage } from "../analytics/tax.js";

const VIEWS = ["monthly", "quarterly", "annual", "ytd", "t12"] as const;
const COMPARE = ["none", "prior_year", "prior_period", "budget", "forecast"] as const;

const query = {
  type: "object",
  additionalProperties: false,
  properties: {
    view: { type: "string", enum: [...VIEWS] },
    compare: { type: "string", enum: [...COMPARE] },
    through: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
    year: { type: "integer", minimum: 1990, maximum: 2100 },
  },
} as const;

type Q = { view?: View; compare?: (typeof COMPARE)[number]; through?: string; year?: number };

async function setup(companyId: string, q: Q) {
  const ledger = await loadLedger(companyId);
  const through = q.through ?? periodOf(await companyAsOf(companyId));
  const last = ledger.periods.filter((p) => p <= through).at(-1) ?? through;
  const columns = columnsFor(q.view ?? "annual", ledger.periods, last);
  return { ledger, columns, through: last };
}

/**
 * Budget for the income-statement subtotals, by column. Budgets are annual, so
 * a YTD or trailing column gets the months-covered share of its year's budget.
 */
async function budgetColumns(companyId: string, columns: Column[]) {
  const rows = await budgetRows(companyId);
  const lineFor: Record<string, string> = {
    REVENUE: "total_revenue",
    DIRECT_COST: "total_cogs",
    OPEX: "total_opex",
    NET_INCOME: "net_income",
  };
  const out: Record<string, (number | null)[]> = {};
  for (const [line, key] of Object.entries(lineFor)) {
    out[key] = columns.map((c) => {
      let total = 0;
      let any = false;
      for (const p of c.periods) {
        const r = rows.find((x) => x.year === Number(p.slice(0, 4)) && x.line === line);
        if (r) {
          total += r.budget / 12;
          any = true;
        }
      }
      return any ? Math.round(total) : null;
    });
  }
  out.gross_profit = columns.map((_, i) =>
    out.total_revenue[i] === null || out.total_cogs[i] === null ? null : out.total_revenue[i]! - out.total_cogs[i]!
  );
  return out;
}

export function registerStatementRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string }; Querystring: Q }>(
    "/companies/:companyId/statements/income",
    { schema: { querystring: query } },
    async (req) => {
      const { ledger, columns, through } = await setup(req.params.companyId, req.query);
      const statement = incomeStatement(ledger.accounts, columns);
      const compare = req.query.compare ?? "none";
      let comparison = null;
      let budget = null;
      if (compare === "prior_year") comparison = incomeStatement(ledger.accounts, columns.map(priorYear));
      if (compare === "prior_period") comparison = incomeStatement(ledger.accounts, columns.map(priorPeriod));
      if (compare === "budget") budget = await budgetColumns(req.params.companyId, columns);
      if (compare === "forecast") comparison = forecastStatement(ledger.accounts, columns);
      return { through, hasLedger: ledger.accounts.length > 0, statement, comparison, budget };
    }
  );

  app.get<{ Params: { companyId: string }; Querystring: Q }>(
    "/companies/:companyId/statements/balance",
    { schema: { querystring: query } },
    async (req) => {
      const { ledger, columns, through } = await setup(req.params.companyId, { view: "annual", ...req.query });
      const statement = balanceSheet(ledger.accounts, columns);
      const comparison = req.query.compare === "prior_year" ? balanceSheet(ledger.accounts, columns.map(priorYear)) : null;
      // Equity roll-forward for the latest column: what moved owner equity.
      const lastCol = columns.at(-1);
      let rollForward = null;
      if (lastCol) {
        const ni = incomeTotals(ledger.accounts, lastCol.periods).netIncome;
        const sumCf = (k: string) => lastCol.periods.reduce((s, p) => s + (ledger.get("CASH_FLOW", k, p) ?? 0), 0);
        const eq = statement.lines.find((l) => l.key === "total_equity")!;
        const prior = balanceSheet(ledger.accounts, [priorPeriod(lastCol)]).lines.find((l) => l.key === "total_equity")!.values[0];
        const distributions = sumCf("owner_distributions");
        const contributions = sumCf("owner_contributions");
        const ending = eq.values.at(-1)!;
        rollForward = {
          beginning: prior,
          netIncome: ni,
          distributions,
          contributions,
          // Whatever net income, distributions, and contributions don't explain
          // (prior-period adjustments, reclasses). Shown, not hidden, so the
          // roll-forward always ties.
          other: ending - prior - ni - distributions - contributions,
          ending,
        };
      }
      return { through, hasLedger: ledger.accounts.length > 0, statement, comparison, rollForward };
    }
  );

  app.get<{ Params: { companyId: string }; Querystring: Q }>(
    "/companies/:companyId/statements/cash-flow",
    { schema: { querystring: query } },
    async (req) => {
      const { ledger, columns, through } = await setup(req.params.companyId, req.query);
      const statement = cashFlowStatement(ledger.accounts, columns);
      const comparison = req.query.compare === "prior_year" ? cashFlowStatement(ledger.accounts, columns.map(priorYear)) : null;
      return {
        through,
        hasLedger: ledger.accounts.length > 0,
        statement,
        comparison,
        profitVsCash: columns.map((c) => ({ label: c.label, ...profitVsCash(ledger.accounts, c.periods) })),
      };
    }
  );

  // Budget vs actual for a year, with the largest variances explained by the
  // statement lines that moved most against the prior year.
  app.get<{ Params: { companyId: string }; Querystring: Q }>(
    "/companies/:companyId/budget-vs-actual",
    { schema: { querystring: query } },
    async (req) => {
      const ledger = await loadLedger(req.params.companyId);
      const all = await budgetRows(req.params.companyId);
      const years = [...new Set(all.map((r) => r.year))].sort();
      const year = req.query.year ?? years.at(-1);
      if (!year) return { year: null, years, lines: [] };
      const rows = all.filter((r) => r.year === year);
      const periods = ledger.periods.filter((p) => p.startsWith(String(year)));
      const prior = ledger.periods.filter((p) => p.startsWith(String(year - 1)));
      const t = incomeTotals(ledger.accounts, periods);
      // Fill actuals from the ledger when the budget file didn't carry them.
      const actualFor: Record<string, number> = { REVENUE: t.revenue, DIRECT_COST: t.cogs, OPEX: t.opex, NET_INCOME: t.netIncome };
      const withActual = rows.map((r) => ({ ...r, actual: r.actual ?? actualFor[r.line] ?? null }));
      const gp = withActual.find((r) => r.line === "REVENUE") && withActual.find((r) => r.line === "DIRECT_COST");
      if (gp) {
        const rev = withActual.find((r) => r.line === "REVENUE")!;
        const dc = withActual.find((r) => r.line === "DIRECT_COST")!;
        withActual.push({ year, line: "GROSS_PROFIT", budget: rev.budget - dc.budget, actual: (rev.actual ?? 0) - (dc.actual ?? 0) });
      }
      const typeFor: Record<string, string[]> = { REVENUE: ["REVENUE"], DIRECT_COST: ["COGS"], OPEX: ["OPEX"], GROSS_PROFIT: ["REVENUE", "COGS"], NET_INCOME: ["REVENUE", "COGS", "OPEX"] };
      const lines = budgetVsActual(withActual).map((v) => {
        let explanation: string | null = null;
        const types = typeFor[v.line];
        if (types && Math.abs(v.variancePct) >= 5 && prior.length) {
          const movers = ledger.accounts
            .filter((a) => a.statement === "INCOME" && types.includes(a.type))
            .map((a) => {
              const now = periods.reduce((s, p) => s + (a.amounts.get(p) ?? 0), 0);
              const was = prior.reduce((s, p) => s + (a.amounts.get(p) ?? 0), 0);
              return { name: a.name, change: now - was };
            })
            .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
            .slice(0, 2);
          explanation = movers
            .map((m) => `${m.name} ${m.change >= 0 ? "up" : "down"} $${Math.round(Math.abs(m.change) / 100).toLocaleString("en-US")} vs ${year - 1}`)
            .join("; ");
        }
        return { ...v, explanation };
      });
      return { year, years, lines };
    }
  );
}

export function registerTaxRoutes(app: FastifyInstance) {
  app.get<{ Params: { companyId: string }; Querystring: { year?: number; format?: "csv" | "json" } }>(
    "/companies/:companyId/tax-package",
    { schema: { querystring: { type: "object", properties: { year: { type: "integer", minimum: 2000, maximum: 2100 }, format: { type: "string", enum: ["csv", "json"] } } } } },
    async (req, reply) => {
      try {
        const pkg = await taxPackage(req.params.companyId, await loadLedger(req.params.companyId), req.query.year);
        if (req.query.format === "csv") {
          const file = `${pkg.company.replace(/[^A-Za-z0-9]+/g, "-")}-tax-package-${pkg.year}.csv`;
          return reply.header("Content-Type", "text/csv").header("Content-Disposition", `attachment; filename="${file}"`).send(taxCsv(pkg));
        }
        return pkg;
      } catch (e) {
        return reply.code(422).send({ error: "Unprocessable", message: e instanceof Error ? e.message : String(e) });
      }
    }
  );
}


/**
 * What a forecast made a year earlier would have said: each column's prior-year
 * figures grown by the growth rate known at the time (the year before that),
 * capped at ±30%. Every line scales together, so margins carry over.
 */
function forecastStatement(accounts: Parameters<typeof incomeStatement>[0], columns: Parameters<typeof incomeStatement>[1]) {
  const base = incomeStatement(accounts, columns.map(priorYear));
  const growth = columns.map((c) => {
    const py = incomeTotals(accounts, priorYear(c).periods).revenue;
    const ppy = incomeTotals(accounts, priorYear(priorYear(c)).periods).revenue;
    return ppy > 0 && py > 0 ? Math.max(-0.3, Math.min(0.3, py / ppy - 1)) : 0;
  });
  return { ...base, lines: base.lines.map((l) => ({ ...l, values: l.values.map((v, i) => Math.round(v * (1 + growth[i]))) })) };
}
