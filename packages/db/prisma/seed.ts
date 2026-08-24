import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "../src/index.js";

// Reference profile: small commercial electrical sub. ~5 crew, ~$6M/yr.
// Money in cents. Dates relative to a fixed "as of" for reproducible demos.
const C = (dollars: number) => BigInt(Math.round(dollars * 100));

// scrypt "salt:key" hex — same format the API's verifyPassword expects.
const hashPw = (pw: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
};
const day = (offset: number) => {
  const d = new Date("2026-07-06T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

async function main() {
  await prisma.session.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
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
  await prisma.company.deleteMany();

  const co = await prisma.company.create({
    data: {
      name: "Foley Electric",
      trade: "ELECTRICAL",
      employeeCount: 18,
      revenueModel: "BOTH",
      setupCompletedAt: new Date(),
      cashSafetyThreshold: C(50_000),
      defaultRetainagePct: 10,
      portfolioTargetMargin: 14,
      monthlyLaborHours: 5 * 160,
    },
  });

  // Demo owner login: owner@foley.test / plumb1234
  const owner = await prisma.user.create({
    data: { email: "owner@foley.test", name: "Ray Foley", passwordHash: hashPw("plumb1234") },
  });
  await prisma.membership.create({ data: { userId: owner.id, companyId: co.id, role: "OWNER" } });
  // A non-owner teammate: crew@foley.test / plumb1234 (can view, can't change settings/team)
  const member = await prisma.user.create({
    data: { email: "crew@foley.test", name: "Dana Crew", passwordHash: hashPw("plumb1234") },
  });
  await prisma.membership.create({ data: { userId: member.id, companyId: co.id, role: "MEMBER" } });

  // Opening cash from the bank (drives forecasts instead of a query param).
  await prisma.cashSnapshot.create({
    data: { companyId: co.id, asOf: day(0), balance: C(250_000), source: "MANUAL" },
  });

  // --- Job A: school district, owner-direct, material running hot, OVERBILLED
  const a = await prisma.project.create({
    data: {
      companyId: co.id,
      name: "Northwest ISD — Field House",
      client: "Northwest ISD",
      clientType: "OWNER_DIRECT",
      status: "ACTIVE",
      billingType: "FIXED_PRICE",
      netDays: 30,
      contractValue: C(820_000),
      originalBidCost: C(700_000),
      billedToDate: C(480_000), // > earned(451k) => overbilled
      targetMarginPct: 14,
      retainagePct: 10,
      percentComplete: 0.55,
      startDate: day(-90),
      endDate: day(60),
    },
  });
  const aRough = await prisma.phase.create({
    data: { projectId: a.id, name: "Rough-In", code: "16-100", sortOrder: 1 },
  });
  await prisma.budgetLine.createMany({
    data: [
      { projectId: a.id, category: "LABOR", budgetedCost: C(380_000), budgetedHours: 4200 },
      { projectId: a.id, category: "MATERIAL", budgetedCost: C(190_000) }, // actual 205k => over
      { projectId: a.id, category: "EQUIPMENT", budgetedCost: C(20_000) },
      { projectId: a.id, category: "OTHER", budgetedCost: C(110_000) },
    ],
  });
  await prisma.costEntry.createMany({
    data: [
      { projectId: a.id, phaseId: aRough.id, category: "LABOR", amount: C(210_000), laborHours: 2400, docType: "PAYROLL", incurredDate: day(-60) },
      { projectId: a.id, phaseId: aRough.id, category: "MATERIAL", amount: C(205_000), docType: "BILL", vendorName: "Rexel", incurredDate: day(-40) },
      { projectId: a.id, category: "EQUIPMENT", amount: C(18_000), docType: "RECEIPT", incurredDate: day(-30) },
    ],
  });
  // A pending change order awaiting the owner's decision (doesn't move margin yet).
  await prisma.changeOrder.create({
    data: {
      projectId: a.id,
      reason: "Added disconnect switches (owner request)",
      contractDelta: C(18_000),
      costDelta: C(12_000),
      status: "PENDING",
      date: day(-5),
    },
  });

  // --- Job B: through a GC, healthy, UNDERBILLED (financing the job)
  const b = await prisma.project.create({
    data: {
      companyId: co.id,
      name: "Hillwood Tower — Floors 3-6",
      client: "Rogers-Healy GC",
      clientType: "GC",
      status: "ACTIVE",
      billingType: "AIA",
      netDays: 45,
      contractValue: C(1_150_000),
      originalBidCost: C(980_000),
      billedToDate: C(250_000), // < earned(345k) => underbilled
      targetMarginPct: 15,
      retainagePct: 10,
      percentComplete: 0.3,
      startDate: day(-30),
      endDate: day(150),
    },
  });
  await prisma.budgetLine.createMany({
    data: [
      { projectId: b.id, category: "LABOR", budgetedCost: C(520_000), budgetedHours: 5800 },
      { projectId: b.id, category: "MATERIAL", budgetedCost: C(360_000) },
      { projectId: b.id, category: "OTHER", budgetedCost: C(100_000) },
    ],
  });
  await prisma.costEntry.createMany({
    data: [
      { projectId: b.id, category: "LABOR", amount: C(160_000), laborHours: 1800, docType: "PAYROLL", incurredDate: day(-20) },
      { projectId: b.id, category: "MATERIAL", amount: C(130_000), docType: "BILL", vendorName: "Graybar", incurredDate: day(-10) },
    ],
  });

  // Remaining labor by month: Aug light, Sep heavy, Oct wide open (bid target).
  await prisma.laborCommitment.createMany({
    data: [
      { projectId: a.id, month: "2026-07", hours: 320 },
      { projectId: a.id, month: "2026-08", hours: 200 },
      { projectId: b.id, month: "2026-07", hours: 260 },
      { projectId: b.id, month: "2026-08", hours: 300 },
      { projectId: b.id, month: "2026-09", hours: 520 },
    ],
  });

  // Cash events: payroll biweekly, vendor bills, big billing inflows, retainage.
  await prisma.cashEvent.createMany({
    data: [
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(38_000), category: "PAYROLL", expectedDate: day(3), status: "EXPECTED" },
      { companyId: co.id, projectId: a.id, direction: "OUT", amount: C(62_000), category: "VENDOR_BILL", expectedDate: day(9), status: "EXPECTED" },
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(14_000), category: "OVERHEAD", expectedDate: day(15), status: "EXPECTED" },
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(38_000), category: "PAYROLL", expectedDate: day(17), status: "EXPECTED" },
      { companyId: co.id, projectId: a.id, direction: "IN", amount: C(180_000), category: "PROGRESS_BILLING", expectedDate: day(22), status: "EXPECTED" },
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(38_000), category: "PAYROLL", expectedDate: day(31), status: "EXPECTED" },
      { companyId: co.id, projectId: b.id, direction: "IN", amount: C(220_000), category: "PROGRESS_BILLING", expectedDate: day(45), status: "EXPECTED" },
      { companyId: co.id, projectId: a.id, direction: "IN", amount: C(82_000), category: "RETAINAGE_RELEASE", expectedDate: day(75), status: "EXPECTED" },
    ],
  });

  console.log(`Seeded company ${co.id} (Foley Electric) — 2 active projects.`);
  console.log(`Demo login: owner@foley.test / plumb1234`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
