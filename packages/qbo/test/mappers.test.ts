import { describe, it, expect } from "vitest";
import { classifyCategory, mapBill, matchObligation, type QboBill } from "../src/mappers.js";

describe("classifyCategory", () => {
  it("falls back to the built-in rules", () => {
    expect(classifyCategory("Journeyman wages")).toBe("LABOR");
    expect(classifyCategory("12/2 copper wire")).toBe("MATERIAL");
    expect(classifyCategory("scissor lift rental")).toBe("EQUIPMENT");
    expect(classifyCategory("misc")).toBe("OTHER");
  });

  it("lets a per-company override win over the rules", () => {
    // "Rexel" (a supply house) has no keyword in the built-in rules -> OTHER,
    // but an override maps it to MATERIAL.
    expect(classifyCategory("Rexel invoice 8842")).toBe("OTHER");
    expect(
      classifyCategory("Rexel invoice 8842", [{ keyword: "Rexel", category: "MATERIAL" }])
    ).toBe("MATERIAL");
  });

  it("threads overrides through mapBill", () => {
    const bill: QboBill = {
      Id: "9",
      TotalAmt: 1234.56,
      TxnDate: "2026-07-01",
      Line: [
        {
          DetailType: "AccountBasedExpenseLine",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "1", name: "Rexel supply" } },
        },
      ],
    };
    const { cost } = mapBill(bill, "BILL", [{ keyword: "rexel", category: "MATERIAL" }]);
    expect(cost.category).toBe("MATERIAL");
    expect(cost.amountCents).toBe(123456);
  });
});

describe("obligation matching", () => {
  const matchers = [
    { origin: "OVERHEAD" as const, id: "e1", frequency: "MONTHLY" as const, keyword: "Travelers" },
    { origin: "LIABILITY" as const, id: "l1", frequency: "MONTHLY" as const, keyword: "Frost" },
  ];

  it("matches a vendor substring case-insensitively and keys by month", () => {
    expect(matchObligation("TRAVELERS INSURANCE CO", new Date("2026-09-14T00:00:00Z"), matchers))
      .toBe("OVERHEAD:e1:2026-09");
    expect(matchObligation("Frost Bank", new Date("2026-09-02T00:00:00Z"), matchers))
      .toBe("LIABILITY:l1:2026-09");
  });

  it("returns null for an unrelated or missing vendor", () => {
    expect(matchObligation("Home Depot", new Date("2026-09-14T00:00:00Z"), matchers)).toBeNull();
    expect(matchObligation(undefined, new Date("2026-09-14T00:00:00Z"), matchers)).toBeNull();
  });
});
