import { describe, it, expect, beforeAll } from "vitest";

// The acceptance harness needs a database with the four DNRD test accounts.
// It runs under `pnpm test:acceptance` (ACCEPTANCE=1); the default unit run skips it.
const enabled = process.env.ACCEPTANCE === "1";

describe.skipIf(!enabled)("DNRD acceptance", () => {
  let results: Awaited<ReturnType<typeof import("../src/acceptance/run.js").runAcceptance>> = [];

  beforeAll(async () => {
    const { runAcceptance } = await import("../src/acceptance/run.js");
    results = await runAcceptance();
  }, 120_000);

  it("reproduces every built finding in the answer key", () => {
    const failures = results.filter((r) => r.outcome === "fail");
    expect(failures.map((f) => `${f.account} ${f.ref}: ${f.detail}`)).toEqual([]);
  });

  it("leaves nothing pending once all phases ship", () => {
    const pending = results.filter((r) => r.outcome === "pending");
    // Reported, not enforced, until D12: pending findings name their phase.
    if (process.env.ACCEPTANCE_STRICT === "1") expect(pending.map((p) => `${p.account} ${p.ref}`)).toEqual([]);
  });
});
