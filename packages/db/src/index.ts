import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });

export const prisma =
  (globalThis as any).__plumbPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  (globalThis as any).__plumbPrisma = prisma;
}

export * from "@prisma/client";
