-- CreateEnum
CREATE TYPE "TharaCycleStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "TharaVoucherStatus" AS ENUM ('available', 'claimed', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "TharaCycle" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "TharaCycleStatus" NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TharaCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TharaRewardPointsLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TharaRewardPointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TharaVoucher" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "valuePaise" INTEGER NOT NULL,
    "amazonCode" TEXT,
    "status" "TharaVoucherStatus" NOT NULL DEFAULT 'available',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimDeadline" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    CONSTRAINT "TharaVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TharaCycle_startDate_endDate_key" ON "TharaCycle"("startDate","endDate");
CREATE INDEX "TharaCycle_status_idx" ON "TharaCycle"("status");
CREATE INDEX "TharaRewardPointsLedger_userId_cycleId_idx" ON "TharaRewardPointsLedger"("userId","cycleId");
CREATE INDEX "TharaRewardPointsLedger_sourceOrderId_idx" ON "TharaRewardPointsLedger"("sourceOrderId");
CREATE UNIQUE INDEX "TharaVoucher_amazonCode_key" ON "TharaVoucher"("amazonCode");
CREATE UNIQUE INDEX "TharaVoucher_userId_cycleId_key" ON "TharaVoucher"("userId","cycleId");
CREATE INDEX "TharaVoucher_status_idx" ON "TharaVoucher"("status");

-- FKs
ALTER TABLE "TharaRewardPointsLedger" ADD CONSTRAINT "TharaRewardPointsLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TharaRewardPointsLedger" ADD CONSTRAINT "TharaRewardPointsLedger_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "TharaCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TharaRewardPointsLedger" ADD CONSTRAINT "TharaRewardPointsLedger_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TharaVoucher" ADD CONSTRAINT "TharaVoucher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TharaVoucher" ADD CONSTRAINT "TharaVoucher_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "TharaCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
