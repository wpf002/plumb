import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// Load the repo-root .env so CLI commands (generate / db push / migrate) resolve
// DATABASE_URL without the caller having to export it into the shell.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // no .env — rely on the ambient environment
}

// Prisma 7 no longer reads the connection URL from schema.prisma. The datasource
// URL for CLI commands lives here; the runtime PrismaClient gets it via the pg
// driver adapter in src/index.ts. `prisma generate` doesn't need a real URL, so
// fall back to a placeholder rather than throwing during a build with no env.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
