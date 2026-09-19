-- Identity completion: give every account a real name, a verified reachable
-- phone and an email, and bind the three downstream records that were orphaned
-- by the split identity (personal coupons, deletable addresses, deduped periods).

-- 1. Phone verification stamp, symmetric with the existing emailVerified.
ALTER TABLE "User" ADD COLUMN "phoneVerified" TIMESTAMP(3);

-- 2. A redeemed reward coupon belongs to the customer who paid points for it.
--    SetNull (not Cascade): deleting a user must not silently void an order's coupon.
ALTER TABLE "Coupon" ADD COLUMN "userId" TEXT;
CREATE INDEX "Coupon_userId_idx" ON "Coupon"("userId");
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Soft-delete addresses so an order-linked address can leave the address book
--    without breaking Order.addressId.
ALTER TABLE "Address" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Address_userId_archivedAt_idx" ON "Address"("userId", "archivedAt");

-- 4. Two PeriodLog rows with the same start gave gaps=[0] -> avgCycle 0 ->
--    Infinity/NaN across the whole dashboard. The start date is inside the
--    encrypted blob, so we key uniqueness on an HMAC of it (never plaintext).
--    Existing rows keep NULL; Postgres treats NULLs as distinct, so no backfill.
ALTER TABLE "PeriodLog" ADD COLUMN "startDayHash" TEXT;
CREATE UNIQUE INDEX "PeriodLog_userId_startDayHash_key" ON "PeriodLog"("userId", "startDayHash");

-- 5. Both newsletter forms showed "you're on the list" without persisting anything.
CREATE TABLE "NewsletterSubscriber" (
  "id"        TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "source"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
