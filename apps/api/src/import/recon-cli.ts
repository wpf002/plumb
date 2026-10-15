import { prisma } from "@plumb/db";
import { reconcile } from "./reconcile.js";

// Print the reconciliation for every imported company.
const companies = await prisma.company.findMany({ where: { dataSource: "IMPORT" } });
for (const c of companies) {
  const r = await reconcile(c.id);
  console.log(`\n${c.name}: ${r.ok ? "OK" : "FAILURES"}`);
  for (const k of r.checks) console.log(`  ${k.failures ? "x" : "✓"} ${k.name} (${k.periods} periods, max diff ${k.maxDiffCents}c)${k.firstFailure ? " — " + k.firstFailure : ""}`);
  for (const v of r.coverage) console.log(`  · ${v.name}: ledger ${(v.ledgerCents / 100).toFixed(2)} detail ${(v.detailCents / 100).toFixed(2)} residual ${(v.residualCents / 100).toFixed(2)}`);
}
process.exit(0);
