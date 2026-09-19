-- Adds a nullable override for the "verified buyer" badge on reviews.
-- Admin-authored reviews (Reviews → New review in the console) set this to
-- TRUE so the storefront shows the badge without the userId+purchase heuristic
-- in getProduct. Storefront-submitted reviews leave it NULL and the heuristic
-- still runs. Nullable so nothing needs backfilling and old rows behave exactly
-- as before.
ALTER TABLE "Review" ADD COLUMN "verifiedOverride" BOOLEAN;
