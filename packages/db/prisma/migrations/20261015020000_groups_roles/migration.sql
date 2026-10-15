-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MemberRole" ADD VALUE 'ACCOUNTANT';
ALTER TYPE "MemberRole" ADD VALUE 'VIEWER';

-- CreateTable
CREATE TABLE "CompanyGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "CompanyGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupElimination" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupElimination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "widgets" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyGroup_ownerId_idx" ON "CompanyGroup"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyGroupMember_groupId_companyId_key" ON "CompanyGroupMember"("groupId", "companyId");

-- CreateIndex
CREATE INDEX "GroupElimination_groupId_year_idx" ON "GroupElimination"("groupId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardLayout_userId_companyId_key" ON "DashboardLayout"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "CompanyGroupMember" ADD CONSTRAINT "CompanyGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompanyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyGroupMember" ADD CONSTRAINT "CompanyGroupMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupElimination" ADD CONSTRAINT "GroupElimination_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompanyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardLayout" ADD CONSTRAINT "DashboardLayout_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

