-- CreateTable
CREATE TABLE "TharaCreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceOrderId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TharaCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TharaCreditLedger_userId_idx" ON "TharaCreditLedger"("userId");

-- CreateIndex
CREATE INDEX "TharaCreditLedger_sourceOrderId_idx" ON "TharaCreditLedger"("sourceOrderId");

-- AddForeignKey
ALTER TABLE "TharaCreditLedger" ADD CONSTRAINT "TharaCreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TharaCreditLedger" ADD CONSTRAINT "TharaCreditLedger_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
