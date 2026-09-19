-- IPv6 prefix → Indian telecom circle, learned from confirmed deliveries.
--
-- Mobile carriers CGNAT their IPv4, so the address the CDN resolves belongs to a
-- regional gateway rather than to the shopper — the reason regional pricing
-- misfires on Jio/Airtel and works over WiFi. IPv6 is not NAT'd and its prefixes
-- are allocated per licensed service area, which is drawn on state lines.
--
-- The table ships EMPTY. No registry publishes prefix→circle, so rows are learned
-- from orders (viewer IP paired with the delivery pincode the shopper typed) and
-- are not allowed to price until `observations` clears the threshold in
-- src/lib/geo/circles.ts.

-- CreateTable
CREATE TABLE "IpCircleRange" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "circle" TEXT NOT NULL,
    "asn" INTEGER,
    "observations" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'observed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpCircleRange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IpCircleRange_prefix_key" ON "IpCircleRange"("prefix");

-- CreateIndex
CREATE INDEX "IpCircleRange_circle_idx" ON "IpCircleRange"("circle");

-- CreateIndex
CREATE INDEX "IpCircleRange_asn_idx" ON "IpCircleRange"("asn");
