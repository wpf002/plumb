import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@plumb/db";
import { importAccount } from "./importer.js";

/**
 * Import one or more account folders from disk.
 *
 *   tsx src/import/cli.ts <folder> [<folder>...] [--owner demo@dnrd.test]
 *
 * Each folder becomes its own company. With --owner, that user is made OWNER of
 * every imported company so it shows up in their company switcher. Re-running
 * for the same owner replaces the earlier import of that account.
 */
async function main() {
  const args = process.argv.slice(2);
  const ownerAt = args.indexOf("--owner");
  const ownerEmail = ownerAt >= 0 ? args[ownerAt + 1] : undefined;
  const folders = args.filter((a, i) => !a.startsWith("--") && (ownerAt < 0 || i !== ownerAt + 1));
  if (folders.length === 0) {
    console.error("usage: cli.ts <folder> [<folder>...] [--owner email]");
    process.exit(1);
  }
  const owner = ownerEmail ? await prisma.user.findUnique({ where: { email: ownerEmail } }) : null;
  if (ownerEmail && !owner) throw new Error(`No user ${ownerEmail}`);

  for (const folder of folders) {
    const files: Record<string, string> = {};
    for (const name of readdirSync(folder)) {
      const p = join(folder, name);
      if (statSync(p).isFile() && name.endsWith(".csv")) files[name] = readFileSync(p, "utf8");
    }
    const businessId = (files["01_business_profile.csv"] ?? "").split(/\r?\n/)[1]?.split(",")[0];
    const existing =
      owner && businessId
        ? await prisma.company.findFirst({
            where: { externalId: businessId, memberships: { some: { userId: owner.id } } },
          })
        : null;
    const started = Date.now();
    const r = await importAccount({ files, companyId: existing?.id, ownerUserId: existing ? undefined : owner?.id });
    const rows = r.files.reduce((s, f) => s + f.written, 0);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `${r.companyName} (${r.companyId}) — ${r.files.length} files, ${rows} rows, as of ${r.dataAsOf}, ${secs}s` +
        (r.unrecognized.length ? `, unrecognized: ${r.unrecognized.join(", ")}` : "")
    );
    for (const w of r.warnings) console.log(`  ! ${w}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
