import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Load the repo-root .env once, here, so every consumer of @plumb/db (API, seed,
// qbo sync) resolves DATABASE_URL without exporting it into the shell. In deploy
// environments where .env is absent, the vars come from the platform instead.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    // no .env — rely on the ambient environment
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });

// Type the global cache so `prisma` keeps its full PrismaClient type — casting
// the whole expression through `any` would erase DB type-safety on every query.
const globalForPrisma = globalThis as unknown as {
  __plumbPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.__plumbPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__plumbPrisma = prisma;
}

export * from "@prisma/client";
