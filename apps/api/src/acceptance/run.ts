import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@plumb/db";
import { analyticsFor, Pending } from "../analytics/index.js";
import { importAccount } from "../import/importer.js";
import { ACCOUNTS, FINDINGS, type AccountKey } from "./registry.js";

export type Outcome = "pass" | "fail" | "pending";

export interface Result {
  account: AccountKey;
  ref: string;
  title: string;
  phase: string;
  outcome: Outcome;
  detail?: string;
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/dnrd");
/** Acceptance companies are tagged so they never collide with a user's data. */
const TAG = "ACCEPTANCE:";

/** Import each test account once into a tagged company; reuse it afterwards. */
export async function ensureAccounts(opts: { reimport?: boolean } = {}): Promise<Record<AccountKey, string>> {
  const out = {} as Record<AccountKey, string>;
  for (const [key, folder] of Object.entries(ACCOUNTS) as [AccountKey, string][]) {
    const name = `${TAG}${key}`;
    const existing = await prisma.company.findFirst({ where: { goals: { startsWith: name } } });
    if (existing && !opts.reimport) {
      out[key] = existing.id;
      continue;
    }
    const dir = join(FIXTURES, folder);
    const files: Record<string, string> = {};
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isFile() && f.endsWith(".csv")) files[f] = readFileSync(p, "utf8");
    }
    const r = await importAccount({ files, companyId: existing?.id });
    // The goals field is free text; prefix it with the tag so the company can be found again.
    await prisma.company.update({ where: { id: r.companyId }, data: { goals: name } });
    out[key] = r.companyId;
  }
  return out;
}

export async function runAcceptance(opts: { reimport?: boolean } = {}): Promise<Result[]> {
  const ids = await ensureAccounts(opts);
  const results: Result[] = [];
  for (const f of FINDINGS) {
    const base = { account: f.account, ref: f.ref, title: f.title, phase: f.phase };
    try {
      await f.run(analyticsFor(ids[f.account]));
      results.push({ ...base, outcome: "pass" });
    } catch (e) {
      if (e instanceof Pending) results.push({ ...base, outcome: "pending", detail: e.message });
      else results.push({ ...base, outcome: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
