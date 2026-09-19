-- A discount an admin can actually give, on one product, that the gateway agrees with.
--
-- There was no way to do this. `ProductVariant.price` is the only number a cart
-- line is priced from, so "50% off this product" meant typing half the number
-- into the price field — losing what the pack was worth, showing no strikethrough
-- and no badge, and silently repricing every subscription renewal of that pack.
--
-- The one thing this must NOT become is a second opinion about the price. The
-- storefront already shipped a "10% off" badge computed from a constant no
-- server code had ever read: the card said ₹404, Razorpay took ₹449, on all five
-- products, and nothing failed. So `price` stays THE charged column and becomes
-- DERIVED — the admin product service computes it as mrp × (1 − discountPct/100)
-- inside the transaction that saves them, and nothing else writes it. Checkout,
-- cart, subscriptions and OrderItem snapshots are untouched by this migration
-- and keep reading exactly the column they always read.
ALTER TABLE "ProductVariant" ADD COLUMN     "mrp" INTEGER,
ADD COLUMN     "discountPct" INTEGER NOT NULL DEFAULT 0;

-- Backfill so every existing row is already consistent with the derivation:
-- mrp = price, discountPct = 0, therefore price = mrp × 1. Nothing on either
-- storefront changes appearance until somebody sets a discount.
--
-- `mrp` stays NULLABLE rather than being made NOT NULL after this. A row created
-- by a path that predates the column (an older seed, a restored dump) reads null
-- and is treated as "same as price" — which is true — instead of failing an
-- insert on a column the writer has never heard of.
UPDATE "ProductVariant" SET "mrp" = "price" WHERE "mrp" IS NULL;
