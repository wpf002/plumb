import { prisma } from "@plumb/db";
import { ledgerPeriods, type LedgerAccount } from "@plumb/engine";

export interface Ledger {
  accounts: LedgerAccount[];
  periods: string[];
  /** Amount for statement:key at a period, or undefined when absent. */
  get(statement: LedgerAccount["statement"], key: string, period: string): number | undefined;
  account(statement: LedgerAccount["statement"], key: string): LedgerAccount | undefined;
}

/** Load every statement account and its monthly amounts for a company. */
export async function loadLedger(companyId: string): Promise<Ledger> {
  const rows = await prisma.glAccount.findMany({
    where: { companyId, statement: { in: ["INCOME", "BALANCE", "CASH_FLOW"] } },
    include: { amounts: true },
    orderBy: { sortOrder: "asc" },
  });
  const accounts: LedgerAccount[] = rows
    // Source subtotals are kept for reconciliation; statements recompute them.
    .filter((r) => r.type !== "SUBTOTAL" || r.key === "cash")
    .map((r) => ({
      key: r.key,
      name: r.name,
      statement: r.statement as LedgerAccount["statement"],
      type: r.type,
      subtype: r.subtype,
      serviceLine: r.serviceLine,
      sortOrder: r.sortOrder,
      amounts: new Map(r.amounts.map((a) => [a.period, Number(a.amount)])),
    }));
  // Subtotals (ending cash, beginning cash, source EBITDA...) stay addressable by key.
  const all = new Map(
    rows.map((r) => [`${r.statement}:${r.key}`, new Map(r.amounts.map((a) => [a.period, Number(a.amount)]))])
  );
  const byKey = new Map(accounts.map((a) => [`${a.statement}:${a.key}`, a]));
  return {
    accounts,
    periods: ledgerPeriods(accounts),
    get: (statement, key, period) => all.get(`${statement}:${key}`)?.get(period),
    account: (statement, key) => byKey.get(`${statement}:${key}`),
  };
}
