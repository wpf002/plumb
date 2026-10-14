-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "CrewKind" AS ENUM ('PROJECT', 'SERVICE', 'MAINTENANCE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "GlStatement" AS ENUM ('CHART', 'INCOME', 'BALANCE', 'CASH_FLOW');

-- CreateEnum
CREATE TYPE "GlType" AS ENUM ('REVENUE', 'COGS', 'OPEX', 'OTHER_INCOME', 'OTHER_EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY', 'CF_OPERATING', 'CF_INVESTING', 'CF_FINANCING', 'SUBTOTAL');

-- AlterEnum
ALTER TYPE "ChangeOrderStatus" ADD VALUE 'REQUESTED';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "assetType" TEXT,
ADD COLUMN     "downtimeDaysAnnual" INTEGER,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "fuelCostAnnual" BIGINT,
ADD COLUMN     "insuranceCostAnnual" BIGINT,
ADD COLUMN     "maintenanceCostAnnual" BIGINT,
ADD COLUMN     "repairCostAnnual" BIGINT,
ADD COLUMN     "replacementCost" BIGINT,
ADD COLUMN     "unitCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "utilizationPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "performedBeforeApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timeImpactDays" INTEGER;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "accountingMethod" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "dataSource" TEXT NOT NULL DEFAULT 'SEED',
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "fiscalYearEnd" TEXT,
ADD COLUMN     "foundedYear" INTEGER,
ADD COLUMN     "goals" TEXT,
ADD COLUMN     "legalStructure" TEXT,
ADD COLUMN     "naicsCode" TEXT,
ADD COLUMN     "ownerAge" INTEGER,
ADD COLUMN     "ownerDistributionsCents" BIGINT,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "ownerSalaryCents" BIGINT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "Liability" ADD COLUMN     "collateral" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "maturityDate" TIMESTAMP(3),
ADD COLUMN     "originationDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "category" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "performanceFlag" TEXT,
ADD COLUMN     "segment" TEXT;

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "segment" TEXT,
    "customerType" TEXT,
    "paymentTermsDays" INTEGER,
    "avgDaysToPay" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "relationshipStart" TIMESTAMP(3),
    "payerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "termsDays" INTEGER,
    "isSubcontractor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "customerId" TEXT,
    "projectId" TEXT,
    "source" TEXT,
    "segment" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "termsDays" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "paidDate" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "vendorId" TEXT,
    "projectId" TEXT,
    "category" TEXT,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "termsDays" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "paidDate" TIMESTAMP(3),
    "status" "BillStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrewKind" NOT NULL DEFAULT 'PROJECT',
    "monthlyCapacityHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewCapacityPeriod" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "capacityHours" DOUBLE PRECISION,
    "usedHours" DOUBLE PRECISION,
    "utilizationPct" DOUBLE PRECISION,

    CONSTRAINT "CrewCapacityPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "payType" TEXT NOT NULL,
    "baseAnnualCents" BIGINT,
    "hourlyRateCents" INTEGER,
    "crewId" TEXT,
    "hireDate" TIMESTAMP(3),
    "terminationDate" TIMESTAMP(3),
    "cogsAllocationPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "projectId" TEXT,
    "regularHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "regularPay" BIGINT NOT NULL DEFAULT 0,
    "overtimePay" BIGINT NOT NULL DEFAULT 0,
    "grossPay" BIGINT NOT NULL,
    "cogsAllocationPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPeriod" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "pctComplete" DOUBLE PRECISION NOT NULL,
    "costMonth" BIGINT NOT NULL DEFAULT 0,
    "costCumulative" BIGINT NOT NULL DEFAULT 0,
    "revenueMonth" BIGINT NOT NULL DEFAULT 0,
    "revenueCumulative" BIGINT NOT NULL DEFAULT 0,
    "billedMonth" BIGINT,
    "billedCumulative" BIGINT,
    "retainageHeldCumulative" BIGINT,
    "changeOrdersApprovedCumulative" BIGINT,
    "changeOrdersPending" BIGINT,
    "revisedContract" BIGINT,
    "estimatedTotalCost" BIGINT,
    "estimatedCostToComplete" BIGINT,
    "committedCost" BIGINT,
    "overbilling" BIGINT,
    "underbilling" BIGINT,
    "projectedGrossProfit" BIGINT,

    CONSTRAINT "ProjectPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "customerId" TEXT,
    "description" TEXT NOT NULL,
    "projectType" TEXT,
    "segment" TEXT,
    "estimatedValue" BIGINT NOT NULL,
    "probabilityPct" DOUBLE PRECISION NOT NULL,
    "expectedMarginPct" DOUBLE PRECISION,
    "expectedStart" TIMESTAMP(3),
    "expectedClose" TIMESTAMP(3),
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "lostReason" TEXT,
    "lostYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCallPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "avgTicketCents" BIGINT NOT NULL,
    "revenue" BIGINT NOT NULL,
    "laborHours" DOUBLE PRECISION,
    "materialCost" BIGINT,
    "callbacks" INTEGER,

    CONSTRAINT "ServiceCallPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringRevenueEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "segment" TEXT,
    "period" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RECURRING',

    CONSTRAINT "RecurringRevenueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "line" TEXT NOT NULL,
    "budget" BIGINT NOT NULL,
    "actual" BIGINT,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "statement" "GlStatement" NOT NULL,
    "type" "GlType" NOT NULL,
    "subtype" TEXT,
    "serviceLine" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlAmount" (
    "id" TEXT NOT NULL,
    "glAccountId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "GlAmount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationInput" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Entity_companyId_idx" ON "Entity"("companyId");

-- CreateIndex
CREATE INDEX "Branch_entityId_idx" ON "Branch"("entityId");

-- CreateIndex
CREATE INDEX "Customer_companyId_idx" ON "Customer"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_externalId_key" ON "Customer"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "Vendor_companyId_idx" ON "Vendor"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_companyId_externalId_key" ON "Vendor"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_issueDate_idx" ON "Invoice"("companyId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_idx" ON "Invoice"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_externalId_key" ON "Invoice"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Bill_companyId_billDate_idx" ON "Bill"("companyId", "billDate");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_companyId_externalId_key" ON "Bill"("companyId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_companyId_name_key" ON "Crew"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrewCapacityPeriod_crewId_period_key" ON "CrewCapacityPeriod"("crewId", "period");

-- CreateIndex
CREATE INDEX "Employee_companyId_idx" ON "Employee"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_externalId_key" ON "Employee"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "TimeEntry_companyId_period_idx" ON "TimeEntry"("companyId", "period");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_period_idx" ON "TimeEntry"("employeeId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPeriod_projectId_period_key" ON "ProjectPeriod"("projectId", "period");

-- CreateIndex
CREATE INDEX "Opportunity_companyId_status_idx" ON "Opportunity"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_companyId_externalId_key" ON "Opportunity"("companyId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCallPeriod_companyId_period_segment_category_key" ON "ServiceCallPeriod"("companyId", "period", "segment", "category");

-- CreateIndex
CREATE INDEX "RecurringRevenueEntry_companyId_period_idx" ON "RecurringRevenueEntry"("companyId", "period");

-- CreateIndex
CREATE INDEX "RecurringRevenueEntry_customerId_period_idx" ON "RecurringRevenueEntry"("customerId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_companyId_year_line_key" ON "Budget"("companyId", "year", "line");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_companyId_kind_asOf_idx" ON "ForecastSnapshot"("companyId", "kind", "asOf");

-- CreateIndex
CREATE INDEX "GlAccount_companyId_statement_idx" ON "GlAccount"("companyId", "statement");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_companyId_statement_key_key" ON "GlAccount"("companyId", "statement", "key");

-- CreateIndex
CREATE UNIQUE INDEX "GlAmount_glAccountId_period_key" ON "GlAmount"("glAccountId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationInput_companyId_key" ON "ValuationInput"("companyId");

-- CreateIndex
CREATE INDEX "ImportRun_companyId_startedAt_idx" ON "ImportRun"("companyId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_externalId_key" ON "Project"("companyId", "externalId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewCapacityPeriod" ADD CONSTRAINT "CrewCapacityPeriod_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPeriod" ADD CONSTRAINT "ProjectPeriod_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCallPeriod" ADD CONSTRAINT "ServiceCallPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRevenueEntry" ADD CONSTRAINT "RecurringRevenueEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRevenueEntry" ADD CONSTRAINT "RecurringRevenueEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAmount" ADD CONSTRAINT "GlAmount_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationInput" ADD CONSTRAINT "ValuationInput_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

