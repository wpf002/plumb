import { runAcceptance } from "./run.js";

// Pass/fail/pending per account and per phase. `--reimport` reloads fixtures.
const results = await runAcceptance({ reimport: process.argv.includes("--reimport") });
const accounts = ["steve", "joe", "robert", "jerry"] as const;
const mark = { pass: "✓", fail: "x", pending: "·" } as const;

for (const acct of accounts) {
  const rs = results.filter((r) => r.account === acct);
  const pass = rs.filter((r) => r.outcome === "pass").length;
  console.log(`\n${acct.toUpperCase()}  ${pass}/${rs.length}`);
  for (const r of rs) console.log(`  ${mark[r.outcome]} ${r.ref.padEnd(11)} ${r.phase.padEnd(4)} ${r.title}${r.outcome === "fail" ? `\n      ${r.detail}` : ""}`);
}

const byPhase = new Map<string, { pass: number; total: number }>();
for (const r of results) {
  const p = byPhase.get(r.phase) ?? { pass: 0, total: 0 };
  p.total++;
  if (r.outcome === "pass") p.pass++;
  byPhase.set(r.phase, p);
}
const total = results.filter((r) => r.outcome === "pass").length;
console.log(`\nBY PHASE  ${[...byPhase].sort().map(([k, v]) => `${k} ${v.pass}/${v.total}`).join("  ")}`);
console.log(`TOTAL     ${total}/${results.length} pass, ${results.filter((r) => r.outcome === "fail").length} fail, ${results.filter((r) => r.outcome === "pending").length} pending`);
process.exit(0);
