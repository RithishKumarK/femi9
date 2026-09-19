-- A one-time, support-granted address correction on a single order.
--
-- All three columns are NULLABLE with no default, so this migration is purely
-- additive: every existing order reads as "not granted, never used", which is
-- the closed state. Nothing about an order already placed changes.
ALTER TABLE "Order" ADD COLUMN "addressEditGrantedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "addressEditGrantedBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "addressEditUsedAt" TIMESTAMP(3);
