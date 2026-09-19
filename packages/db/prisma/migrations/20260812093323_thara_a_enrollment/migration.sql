-- CreateEnum
CREATE TYPE "TharaStatus" AS ENUM ('purchase_pending', 'active', 'suspended', 'deactivated');

-- CreateTable
CREATE TABLE "TharaMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TharaStatus" NOT NULL DEFAULT 'purchase_pending',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "qualifyingOrderId" TEXT,
    "referralCode" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "statusBeforeSuspend" "TharaStatus",
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TharaMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TharaReferral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "invitedByEmail" TEXT,
    "invitedByLink" BOOLEAN NOT NULL DEFAULT false,
    "ipAtSignup" TEXT,
    "uaAtSignup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TharaReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TharaMembership_userId_key" ON "TharaMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TharaMembership_qualifyingOrderId_key" ON "TharaMembership"("qualifyingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "TharaMembership_referralCode_key" ON "TharaMembership"("referralCode");

-- CreateIndex
CREATE INDEX "TharaMembership_status_idx" ON "TharaMembership"("status");

-- CreateIndex
CREATE INDEX "TharaMembership_referralCode_idx" ON "TharaMembership"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "TharaReferral_referredUserId_key" ON "TharaReferral"("referredUserId");

-- CreateIndex
CREATE INDEX "TharaReferral_referrerId_idx" ON "TharaReferral"("referrerId");

-- AddForeignKey
ALTER TABLE "TharaMembership" ADD CONSTRAINT "TharaMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TharaMembership" ADD CONSTRAINT "TharaMembership_qualifyingOrderId_fkey" FOREIGN KEY ("qualifyingOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TharaReferral" ADD CONSTRAINT "TharaReferral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "TharaMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TharaReferral" ADD CONSTRAINT "TharaReferral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

