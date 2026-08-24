import { describe, it, expect } from "vitest";
import { verifyNarration, deterministicAnalysis, type Fact } from "../src/ai.js";
import type { DigestResult } from "@plumb/engine";

const facts: Fact[] = [
  { key: "cash.low", label: "Lowest cash", value: "$168,440.00", raw: 16_844_000 },
  { key: "cash.lowDate", label: "Date", value: "2026-09-10", raw: "2026-09-10" },
  { key: "job.a.nowMargin", label: "Margin", value: "4.0%", raw: 4 },
  { key: "billing.a.slip", label: "Slip", value: "14 days", raw: 14 },
];

describe("narration verification", () => {
  it("accepts prose that only uses engine values", () => {
    const text =
      "Cash bottoms out at $168,440.00 on 2026-09-10. The field house is heading for 4.0% after slipping 14 days.";
    expect(verifyNarration(text, facts)).toBeNull();
  });

  it("rejects a dollar figure the engine never produced", () => {
    const bad = verifyNarration("You'll be short about $92,000.00 in September.", facts);
    expect(bad).toContain("$92,000.00");
  });

  it("rejects an invented percentage", () => {
    expect(verifyNarration("Margin is heading for 3.2%.", facts)).toContain("3.2%");
  });

  it("rejects an invented date", () => {
    expect(verifyNarration("Trouble starts 2026-11-02.", facts)).toContain("2026-11-02");
  });

  it("rejects an invented day count", () => {
    expect(verifyNarration("Billing slipped 21 days.", facts)).toContain("21 days");
  });

  it("allows a figure that appears inside a longer fact value", () => {
    const withRange: Fact[] = [
      ...facts,
      { key: "collision.0.week", label: "Week", value: "2026-09-07 to 2026-09-13", raw: null },
    ];
    expect(verifyNarration("The week of 2026-09-07 is the tight one.", withRange)).toBeNull();
  });

  it("ignores prose with no figures at all", () => {
    expect(verifyNarration("Two jobs are worth watching this week.", facts)).toBeNull();
  });
});

describe("deterministic fallback", () => {
  const digest: DigestResult = {
    asOf: "2026-08-24",
    companyName: "Foley Electric",
    score: 74,
    headline: "Cash drops below your safety floor on Oct 29",
    items: [
      { severity: "critical", title: "Cash drops below your safety floor on Oct 29", detail: "Bill early." },
      { severity: "warning", title: "Riverside is under-billed", detail: "Send the invoice." },
    ],
  };

  it("never returns a blank page when there is no model", () => {
    const a = deterministicAnalysis(digest);
    expect(a.source).toBe("deterministic");
    expect(a.headline).toBe(digest.headline);
    expect(a.concerns).toHaveLength(2);
    expect(a.summary).toContain("74");
  });
});
