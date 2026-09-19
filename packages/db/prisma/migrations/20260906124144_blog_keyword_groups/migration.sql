-- Three typed keyword lists for the new admin blog form. Nullable-equivalent
-- (default empty array), additive, so no existing row needs backfilling. The
-- legacy `keywords` column stays for now — the storefront's meta tag falls
-- back to it when the three are empty.
ALTER TABLE "BlogPost" ADD COLUMN "keywordsPrimary"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "BlogPost" ADD COLUMN "keywordsSecondary" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "BlogPost" ADD COLUMN "keywordsSemantic"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
