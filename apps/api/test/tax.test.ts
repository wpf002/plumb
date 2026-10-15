import { describe, expect, it } from "vitest";
import { taxLine } from "../src/analytics/tax.js";

const a = (type: string, key: string, subtype: string | null = null, name = key) => ({ type, key, subtype, name });

describe("taxLine", () => {
  it("maps the trade P&L to the lines a CPA expects", () => {
    expect(taxLine(a("REVENUE", "revenue_musco"))).toBe("Gross receipts");
    expect(taxLine(a("COGS", "cogs_subcontractor"))).toBe("Cost of goods sold: contract labor");
    expect(taxLine(a("COGS", "cogs_direct_labor", "LABOR"))).toBe("Cost of goods sold: labor");
    expect(taxLine(a("OPEX", "opex_officer_comp", "OWNER_COMP"))).toBe("Compensation of officers");
    expect(taxLine(a("OPEX", "opex_payroll_taxes_benefits_admin"))).toBe("Taxes, benefits: payroll");
    expect(taxLine(a("OPEX", "opex_admin_payroll"))).toBe("Salaries and wages");
    expect(taxLine(a("OPEX", "opex_building_occupancy"))).toBe("Utilities");
    expect(taxLine(a("OPEX", "opex_rent_shop"))).toBe("Rents");
    expect(taxLine(a("OPEX", "opex_depreciation", "DEPRECIATION"))).toBe("Depreciation");
    expect(taxLine(a("OPEX", "opex_vehicle_expense_nonjob"))).toBe("Car and truck expenses");
    expect(taxLine(a("OPEX", "opex_misc_other_opex"))).toBe("Other deductions");
  });
});
