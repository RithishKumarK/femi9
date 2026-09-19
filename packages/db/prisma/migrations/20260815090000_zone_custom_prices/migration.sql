-- Per-zone CUSTOM PRICES: an exact rupee price for one product (card price) or
-- one variant (what a cart line is charged) inside one pricing zone. Where a row
-- exists it replaces the zone's percentage discount entirely.

-- CreateTable
CREATE TABLE "ZoneProductPrice" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "ZoneProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneVariantPrice" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "ZoneVariantPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZoneProductPrice_productId_idx" ON "ZoneProductPrice"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneProductPrice_zoneId_productId_key" ON "ZoneProductPrice"("zoneId", "productId");

-- CreateIndex
CREATE INDEX "ZoneVariantPrice_variantId_idx" ON "ZoneVariantPrice"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneVariantPrice_zoneId_variantId_key" ON "ZoneVariantPrice"("zoneId", "variantId");

-- AddForeignKey
ALTER TABLE "ZoneProductPrice" ADD CONSTRAINT "ZoneProductPrice_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "PriceZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneProductPrice" ADD CONSTRAINT "ZoneProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneVariantPrice" ADD CONSTRAINT "ZoneVariantPrice_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "PriceZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneVariantPrice" ADD CONSTRAINT "ZoneVariantPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
