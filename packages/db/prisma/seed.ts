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
// Anchored on today so the demo forecast is always forward-looking — a seed
// pinned to a fixed date drifts into the past and the cash chart empties out.
const TODAY = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
})();
const day = (offset: number) => {
  const d = new Date(TODAY.getTime());
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
const monthsAgo = (n: number) => {
  const d = new Date(TODAY.getTime());
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
};

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
  await prisma.company.deleteMany();

  const co = await prisma.company.create({
    data: {
      name: "Foley Electric",
      trade: "ELECTRICAL",
      employeeCount: 18,
      revenueModel: "BOTH",
      setupCompletedAt: new Date(),
      // Roughly two months of fixed cost — the floor a $6M sub actually runs to.
      cashSafetyThreshold: C(120_000),
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
  // Who pays, and how late. A school district and a GC behave nothing alike.
  const isd = await prisma.payer.create({
    data: {
      companyId: co.id,
      name: "Northwest ISD",
      type: "PUBLIC_ENTITY",
      typicalDaysLate: 18,
      notes: "Board approves pay apps monthly — misses the cycle, waits 30 more days.",
    },
  });
  const gc = await prisma.payer.create({
    data: {
      companyId: co.id,
      name: "Rogers-Healy GC",
      type: "GC",
      typicalDaysLate: 41,
      notes: "Pays when the owner pays them. Chase at day 35.",
    },
  });

  const a = await prisma.project.create({
    data: {
      companyId: co.id,
      name: "Northwest ISD — Field House",
      client: "Northwest ISD",
      clientType: "OWNER_DIRECT",
      payerId: isd.id,
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
      payerId: gc.id,
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
      { companyId: co.id, projectId: null, direction: "OUT", amount: C(38_000), category: "PAYROLL", expectedDate: day(31), status: "EXPECTED" },
    ],
  });

  // Settled history, so "how late does this payer actually run" has something to
  // observe rather than only the owner's guess.
  const settled = (
    projectId: string,
    dueOffset: number,
    lateDays: number,
    dollars: number
  ) => ({
    companyId: co.id,
    projectId,
    direction: "IN" as const,
    amount: C(dollars),
    category: "PROGRESS_BILLING" as const,
    expectedDate: day(dueOffset),
    actualDate: day(dueOffset + lateDays),
    status: "RECEIVED" as const,
  });
  await prisma.cashEvent.createMany({
    data: [
      // Northwest ISD: board-cycle slippage, fairly consistent.
      settled(a.id, -250, 16, 96_000),
      settled(a.id, -190, 21, 128_000),
      settled(a.id, -140, 12, 104_000),
      settled(a.id, -95, 47, 118_000),
      settled(a.id, -42, 17, 73_800),
      // Rogers-Healy: pay-when-paid, and it shows.
      settled(b.id, -160, 38, 140_000),
      settled(b.id, -110, 52, 165_000),
      settled(b.id, -70, 44, 132_000),
      settled(b.id, -35, 39, 103_500),
    ],
  });

  // Inbound cash comes from the contract's billing schedule, not from hand-entered
  // progress-billing events — that's what lets a slipped date ripple.
  const milestone = (
    projectId: string,
    sequence: number,
    name: string,
    offset: number,
    dollars: number,
    extra: { status?: "PLANNED" | "READY" | "BILLED" | "PAID"; billedOffset?: number; slipFrom?: number } = {}
  ) => ({
    projectId,
    sequence,
    name,
    expectedDate: day(offset),
    originalExpectedDate: day(extra.slipFrom ?? offset),
    amount: C(dollars),
    retainagePct: 10,
    status: extra.status ?? ("PLANNED" as const),
    billedAt: extra.billedOffset === undefined ? null : day(extra.billedOffset),
  });

  await prisma.milestone.createMany({
    data: [
      // Northwest ISD — field house. Two billed, three ahead; the switchgear
      // milestone slipped two weeks on a gear delivery.
      milestone(a.id, 1, "Mobilization & temp power", -75, 82_000, { status: "PAID", billedOffset: -72 }),
      milestone(a.id, 2, "Underground & rough-in", -30, 205_000, { status: "BILLED", billedOffset: -28 }),
      milestone(a.id, 3, "Switchgear set & energized", 22, 190_000, { slipFrom: 8 }),
      milestone(a.id, 4, "Trim & devices", 48, 178_000),
      milestone(a.id, 5, "Final & closeout", 62, 165_000),

      // Hillwood Tower — floors 3-6. Earlier in its life.
      milestone(b.id, 1, "Mobilization", -20, 115_000, { status: "PAID", billedOffset: -18 }),
      milestone(b.id, 2, "Floors 3-4 rough-in", 18, 260_000),
      milestone(b.id, 3, "Floors 5-6 rough-in", 55, 260_000),
      milestone(b.id, 4, "Gear & feeders", 92, 240_000),
      milestone(b.id, 5, "Trim, test & closeout", 145, 275_000),
    ],
  });

  // Balance sheet: what a $6M electrical sub actually owns and owes.
  const truck = await prisma.asset.create({
    data: {
      companyId: co.id,
      name: "2024 F-350 service truck",
      category: "VEHICLE",
      purchaseDate: monthsAgo(24),
      purchaseCost: C(68_000),
      usefulLifeMonths: 60,
      salvageValue: C(8_000),
    },
  });
  const shop = await prisma.asset.create({
    data: {
      companyId: co.id,
      name: "Shop & yard — 4100 Irving Blvd",
      category: "REAL_ESTATE",
      purchaseDate: monthsAgo(96),
      purchaseCost: C(540_000),
      currentValue: C(690_000),
      valueAsOf: monthsAgo(3),
    },
  });
  await prisma.asset.createMany({
    data: [
      {
        companyId: co.id,
        name: "Bucket truck (used)",
        category: "VEHICLE",
        purchaseDate: monthsAgo(40),
        purchaseCost: C(94_000),
        usefulLifeMonths: 84,
        salvageValue: C(12_000),
      },
      {
        companyId: co.id,
        name: "Wire pullers, benders & test gear",
        category: "EQUIPMENT",
        purchaseDate: monthsAgo(18),
        purchaseCost: C(46_000),
        usefulLifeMonths: 60,
      },
      {
        companyId: co.id,
        name: "Estimating workstations & tablets",
        category: "TECHNOLOGY",
        purchaseDate: monthsAgo(10),
        purchaseCost: C(18_000),
        usefulLifeMonths: 36,
      },
    ],
  });

  await prisma.liability.createMany({
    data: [
      {
        companyId: co.id,
        name: "Truck loan — Frost Bank",
        lender: "Frost Bank",
        kind: "TERM_LOAN",
        originalPrincipal: C(58_000),
        currentBalance: C(31_400),
        interestRatePct: 6.4,
        paymentAmount: C(1_180),
        paymentFrequency: "MONTHLY",
        nextPaymentDate: day(9),
        assetId: truck.id,
      },
      {
        companyId: co.id,
        name: "Shop mortgage",
        lender: "Frost Bank",
        kind: "MORTGAGE",
        originalPrincipal: C(430_000),
        currentBalance: C(288_000),
        interestRatePct: 5.85,
        paymentAmount: C(3_240),
        paymentFrequency: "MONTHLY",
        nextPaymentDate: day(6),
        assetId: shop.id,
      },
      {
        companyId: co.id,
        name: "Amex business card",
        kind: "CREDIT_CARD",
        currentBalance: C(24_600),
        creditLimit: C(60_000),
        interestRatePct: 22.9,
        paymentAmount: C(2_500),
        paymentFrequency: "MONTHLY",
        nextPaymentDate: day(12),
      },
      {
        companyId: co.id,
        name: "SBA 7(a) working capital",
        lender: "SBA / Amegy",
        kind: "SBA_LOAN",
        originalPrincipal: C(250_000),
        currentBalance: C(164_000),
        interestRatePct: 8.25,
        paymentAmount: C(3_050),
        paymentFrequency: "MONTHLY",
        nextPaymentDate: day(2),
      },
      {
        companyId: co.id,
        name: "Scissor lift lease",
        lender: "United Rentals",
        kind: "EQUIPMENT_LEASE",
        currentBalance: C(0),
        paymentAmount: C(1_450),
        paymentFrequency: "MONTHLY",
        nextPaymentDate: day(4),
        endDate: day(430),
        renewalTerms: "36-month term, 12-month renewal at market rate",
      },
    ],
  });

  // Opening cash. The seed previously had no snapshot at all, so every forecast
  // started from the code default — a $6M sub with 3-4 months of fixed cost in
  // the bank is a truer reference profile than a flush one.
  await prisma.cashSnapshot.create({
    data: { companyId: co.id, asOf: day(0), balance: C(168_000), source: "MANUAL" },
  });

  // Recurring overhead: the fixed nut before a single job cost.
  await prisma.recurringExpense.createMany({
    data: [
      { companyId: co.id, name: "General liability & umbrella", category: "INSURANCE", amount: C(3_850), frequency: "MONTHLY", startDate: day(-2), matchKeyword: "Travelers" },
      { companyId: co.id, name: "Workers' comp", category: "INSURANCE", amount: C(6_200), frequency: "MONTHLY", startDate: day(1) },
      { companyId: co.id, name: "Fuel & fleet cards", category: "OVERHEAD", amount: C(1_150), frequency: "WEEKLY", startDate: day(-1), matchKeyword: "WEX" },
      { companyId: co.id, name: "Office rent & utilities", category: "OVERHEAD", amount: C(2_400), frequency: "MONTHLY", startDate: day(5) },
      { companyId: co.id, name: "Software (estimating, QBO, phones)", category: "OVERHEAD", amount: C(940), frequency: "MONTHLY", startDate: day(7) },
      { companyId: co.id, name: "Office salaries (non-job)", category: "PAYROLL", amount: C(9_800), frequency: "MONTHLY", startDate: day(3) },
      { companyId: co.id, name: "Quarterly estimated tax", category: "TAX", amount: C(18_000), frequency: "QUARTERLY", startDate: day(24) },
    ],
  });

  // Recurring revenue. Most trades run both models — bid work plus service
  // agreements that pay whether or not the next bid lands.
  await prisma.serviceContract.createMany({
    data: [
      {
        companyId: co.id,
        name: "Fire alarm & emergency lighting monitoring",
        client: "Hillwood Properties",
        amount: C(4_200),
        billingFrequency: "MONTHLY",
        netDays: 30,
        startDate: monthsAgo(19),
        renewalDate: day(52),
        autoRenew: true,
      },
      {
        companyId: co.id,
        name: "Preventive maintenance agreement",
        client: "Northwest ISD",
        amount: C(18_500),
        billingFrequency: "QUARTERLY",
        netDays: 45,
        startDate: monthsAgo(14),
        renewalDate: day(210),
        autoRenew: false,
      },
      {
        companyId: co.id,
        name: "Generator load-bank testing",
        client: "Baylor Scott & White",
        amount: C(9_800),
        billingFrequency: "ANNUAL",
        netDays: 30,
        startDate: monthsAgo(8),
        autoRenew: true,
      },
      {
        companyId: co.id,
        name: "Parking-lot lighting service",
        client: "Rogers-Healy GC",
        amount: C(1_150),
        billingFrequency: "MONTHLY",
        netDays: 30,
        startDate: monthsAgo(6),
        renewalDate: day(74),
        autoRenew: true,
      },
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
