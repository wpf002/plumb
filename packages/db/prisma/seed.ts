import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "../src/index.js";

// Resets the database to one demo login. `pnpm db:demo` then imports the four
// DNRD test accounts under it.

// scrypt "salt:key" hex, the format the API's verifyPassword expects.
const hashPw = (pw: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
};

export const DEMO_EMAIL = "demo@dnrd.test";
export const DEMO_PASSWORD = "demo1234";

async function main() {
  await prisma.session.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.serviceContract.deleteMany();
  await prisma.payer.deleteMany();
  await prisma.recurringExpense.deleteMany();
  await prisma.liability.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.categoryMapping.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.qboConnection.deleteMany();
  await prisma.cashSnapshot.deleteMany();
  await prisma.laborCommitment.deleteMany();
  await prisma.cashEvent.deleteMany();
  await prisma.changeOrder.deleteMany();
  await prisma.costEntry.deleteMany();
  await prisma.budgetLine.deleteMany();
  await prisma.phase.deleteMany();
  await prisma.project.deleteMany();
  await prisma.importRun.deleteMany();
  await prisma.glAccount.deleteMany();
  await prisma.company.deleteMany();

  await prisma.user.create({ data: { email: DEMO_EMAIL, name: "DNRD Demo", passwordHash: hashPw(DEMO_PASSWORD) } });
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
