-- The landing page's featured rail becomes an editorial choice.
--
-- It was `products.slice(0, 4)` off a query ordered by `createdAt` — so the one
-- row of cards most shoppers ever see was decided by which products happened to
-- be typed into the catalogue first, and no console screen could change it.
--
-- Additive and defaulted, so every existing row stays valid and the storefront
-- keeps its old behaviour until somebody features something: with no flagged
-- rows the service falls back to the first N products, exactly the shape the
-- slice produced.
--
-- The "at most five" cap is NOT here. Postgres cannot express "at most N rows
-- where featured" without a trigger, and N is a per-brand layout decision
-- (brandConfig.featuredSlots), not a property of the schema the two brands
-- share. It is enforced in the admin product service, inside the transaction
-- that sets the flag.
ALTER TABLE "Product" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuredAt" TIMESTAMP(3);

-- The storefront reads `featured = true` ordered by `featuredAt`; the console
-- counts the flagged rows on every product save.
CREATE INDEX "Product_featured_featuredAt_idx" ON "Product"("featured", "featuredAt");
