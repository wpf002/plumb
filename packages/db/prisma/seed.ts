import { prisma } from "../src/index.js";

// Reference profile: small commercial electrical sub. ~5 crew, ~$6M/yr.
// Money in cents. Dates relative to a fixed "as of" for reproducible demos.
const C = (dollars: number) => BigInt(Math.round(dollars * 100));
const day = (offset: number) => {
  const d = new Date("2026-07-06T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

async function main() {
  await prisma.laborCommitment.deleteMany();
  await prisma.cashEvent.deleteMany();
  await prisma.changeOrder.deleteMany();
  await prisma.costEntry.deleteMany();
  await prisma.project.deleteMany();
  await prisma.company.deleteMany();

  const co = await prisma.company.create({
    data: {
      name: "Foley Electric",
      trade: "ELECTRICAL",
      cashSafetyThreshold: C(50_000),
      defaultRetainagePct: 10,
      portfolioTargetMargin: 14,
      monthlyLaborHours: 5 * 160, // 5 crew * ~160 billable hrs/mo
    },
  });

  // Job A — school district, owner-direct, running slightly hot on material.
  const a = await prisma.project.create({
    data: {
      companyId: co.id,
      name: "Northwest ISD — Field House",
      client: "Northwest ISD",
      clientType: "OWNER_DIRECT",
      status: "ACTIVE",
      contractValue: C(820_000),
      originalBidCost: C(700_000),
      targetMarginPct: 14,
      retainagePct: 10,
      percentComplete: 0.55,
      startDate: day(-90),
      endDate: day(60),
    },
  });
  await prisma.costEntry.createMany({
    data: [
      { projectId: a.id, category: "LABOR", amount: C(210_000), incurredDate: day(-60) },
      { projectId: a.id, category: "MATERIAL", amount: C(205_000), incurredDate: day(-40) },
      { projectId: a.id, category: "EQUIPMENT", amount: C(18_000), incurredDate: day(-30) },
    ],
  });

  // Job B — through a GC, healthy.
  const b = await prisma.project.create({
    data: {
      companyId: co.id,
      name: "Hillwood Tower — Floors 3-6",
      client: "Rogers-Healy GC",
      clientType: "GC",
      status: "ACTIVE",
      contractValue: C(1_150_000),
      originalBidCost: C(980_000),
      targetMarginPct: 15,
      retainagePct: 10,
      percentComplete: 0.3,
      startDate: day(-30),
      endDate: day(150),
    },
  });
  await prisma.costEntry.createMany({
    data: [
      { projectId: b.id, category: "LABOR", amount: C(160_000), incurredDate: day(-20) },
      { projectId: b.id, category: "MATERIAL", amount: C(130_000), incurredDate: day(-10) },
    ],
  });

  // Labor commitments (remaining hours) — Aug is light, Sep is heavy.
  await prisma.laborCommitment.createMany({
    data: [
      { projectId: a.id, month: "2026-07", hours: 320 },
      { projectId: a.id, month: "2026-08", hours: 200 },
      { projectId: b.id, month: "2026-07", hours: 260 },
      { projectId: b.id, month: "2026-08", hours: 300 },
      { projectId: b.id, month: "2026-09", hours: 520 },
    ],
  });

  // Cash events — payroll every 2 weeks, vendor bills, a big billing inflow.
  await prisma.cashEvent.createMany({
    data: [
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(38_000), category: "PAYROLL", expectedDate: day(3), status: "EXPECTED" },
      { companyId: co.id, projectId: a.id, direction: "OUT", amount: C(62_000), category: "VENDOR_BILL", expectedDate: day(9), status: "EXPECTED" },
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(38_000), category: "PAYROLL", expectedDate: day(17), status: "EXPECTED" },
      { companyId: co.id, projectId: a.id, direction: "IN", amount: C(180_000), category: "PROGRESS_BILLING", expectedDate: day(22), status: "EXPECTED" },
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(38_000), category: "PAYROLL", expectedDate: day(31), status: "EXPECTED" },
      { companyId: co.id, projectId: b.id, direction: "IN", amount: C(220_000), category: "PROGRESS_BILLING", expectedDate: day(45), status: "EXPECTED" },
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(14_000), category: "OVERHEAD", expectedDate: day(15), status: "EXPECTED" },
    ],
  });

  console.log(`Seeded company ${co.id} with 2 active projects.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
