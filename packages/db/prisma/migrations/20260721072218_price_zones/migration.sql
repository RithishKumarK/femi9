-- CreateEnum
CREATE TYPE "RegionKind" AS ENUM ('state', 'district', 'pincode');

-- CreateTable
CREATE TABLE "PriceZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneRegion" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "kind" "RegionKind" NOT NULL DEFAULT 'state',
    "value" TEXT NOT NULL,

    CONSTRAINT "ZoneRegion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceZone_name_key" ON "PriceZone"("name");

-- CreateIndex
CREATE INDEX "ZoneRegion_zoneId_idx" ON "ZoneRegion"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneRegion_kind_value_key" ON "ZoneRegion"("kind", "value");

-- AddForeignKey
ALTER TABLE "ZoneRegion" ADD CONSTRAINT "ZoneRegion_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "PriceZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
