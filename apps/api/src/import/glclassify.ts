/**
 * Classify a statement column into a ledger account.
 *
 * Source statements are wide: one column per line item, named differently per
 * company (`revenue_musco`, `cogs_equipment_fuel`, `opex_yard_rent`). The type
 * comes from the prefix and, on the balance sheet, from position relative to
 * the total_assets / total_liabilities columns. Nothing is hardcoded to a
 * particular company's chart of accounts.
 */

export type GlStatement = "INCOME" | "BALANCE" | "CASH_FLOW";
export type GlType =
  | "REVENUE"
  | "COGS"
  | "OPEX"
  | "OTHER_INCOME"
  | "OTHER_EXPENSE"
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "CF_OPERATING"
  | "CF_INVESTING"
  | "CF_FINANCING"
  | "SUBTOTAL";

export interface GlLine {
  key: string;
  name: string;
  type: GlType;
  subtype: string | null;
  serviceLine: string | null;
  sortOrder: number;
}

const SKIP = new Set(["period", "check_balance_error", "gross_margin_pct"]);

/** "revenue_school_municipal" -> "School Municipal". */
export function humanize(key: string): string {
  return key
    .replace(/^(revenue|cogs|opex)_/, "")
    .split("_")
    .map((w) => (w.length <= 3 && /^(ar|ap|loc|gm|it|crm)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function incomeSubtype(key: string): string | null {
  if (/labor|payroll|officer_comp|gm_salary/.test(key)) {
    if (key === "opex_officer_comp") return "OWNER_COMP";
    return key.startsWith("cogs") ? "LABOR" : "PAYROLL";
  }
  if (/material/.test(key)) return "MATERIALS";
  if (/subcontract/.test(key)) return "SUBCONTRACT";
  if (/equipment|fuel/.test(key)) return "EQUIPMENT";
  if (/permit|disposal|supplies/.test(key)) return "PERMITS_SUPPLIES";
  if (key === "opex_depreciation") return "DEPRECIATION";
  if (key === "opex_interest") return "INTEREST";
  if (/rent|occupancy/.test(key)) return "RENT";
  if (/insurance/.test(key)) return "INSURANCE";
  if (/vehicle/.test(key)) return "VEHICLE";
  if (/advertising|marketing/.test(key)) return "MARKETING";
  if (/software|it$|crm/.test(key)) return "SOFTWARE";
  if (/professional/.test(key)) return "PROFESSIONAL";
  if (/utilities/.test(key)) return "UTILITIES";
  if (/property_tax/.test(key)) return "PROPERTY_TAX";
  if (/repairs/.test(key)) return "REPAIRS";
  return null;
}

export function classifyIncome(headers: string[]): GlLine[] {
  return headers
    .filter((h) => !SKIP.has(h))
    .map((key, i) => {
      let type: GlType = "SUBTOTAL";
      let serviceLine: string | null = null;
      if (key.startsWith("revenue_")) {
        type = "REVENUE";
        serviceLine = humanize(key);
      } else if (key.startsWith("cogs_")) type = "COGS";
      else if (key.startsWith("opex_")) type = "OPEX";
      else if (/^other_income/.test(key)) type = "OTHER_INCOME";
      else if (/^other_expense/.test(key)) type = "OTHER_EXPENSE";
      return {
        key,
        name: type === "SUBTOTAL" ? humanize(key) : humanize(key),
        type,
        subtype: type === "SUBTOTAL" ? key.toUpperCase() : incomeSubtype(key),
        serviceLine,
        sortOrder: i,
      };
    });
}

const CURRENT_ASSET = /cash|receivable|inventory|prepaid|costs_in_excess|deposit/;
const CURRENT_LIABILITY = /payable|payroll|line_of_credit|billings_in_excess|accrued|tax|credit_card/;

export function classifyBalance(headers: string[]): GlLine[] {
  const cols = headers.filter((h) => !SKIP.has(h));
  const totalAssetsAt = cols.indexOf("total_assets");
  const totalLiabAt = cols.indexOf("total_liabilities");
  return cols.map((key, i) => {
    let type: GlType;
    let subtype: string | null = null;
    if (/^total_/.test(key)) {
      type = "SUBTOTAL";
      subtype = key.toUpperCase();
    } else if (totalAssetsAt >= 0 && i < totalAssetsAt) {
      type = "ASSET";
      subtype = CURRENT_ASSET.test(key) ? "CURRENT" : "FIXED";
    } else if (totalLiabAt >= 0 && i < totalLiabAt) {
      type = "LIABILITY";
      subtype = CURRENT_LIABILITY.test(key) ? "CURRENT" : "LONG_TERM";
    } else {
      type = "EQUITY";
    }
    return { key, name: humanize(key), type, subtype, serviceLine: null, sortOrder: i };
  });
}

export function classifyCashFlow(headers: string[]): GlLine[] {
  const cols = headers.filter((h) => !SKIP.has(h));
  return cols.map((key, i) => {
    let type: GlType = "SUBTOTAL";
    if (/^(net_income|depreciation|change_in_)/.test(key)) type = "CF_OPERATING";
    else if (/^(capex|asset_sale|equipment_sale)/.test(key)) type = "CF_INVESTING";
    else if (/(debt|loc_|distribution|contribution)/.test(key)) type = "CF_FINANCING";
    return {
      key,
      name: humanize(key),
      type,
      subtype: type === "SUBTOTAL" ? key.toUpperCase() : null,
      serviceLine: null,
      sortOrder: i,
    };
  });
}
