-- Photos + short videos attached to customer reviews. Stored inline on the
-- Review row as a JSON array of {url, kind} entries (kind = "image" or
-- "video"). Kept alongside the review because both the storefront and the
-- admin moderation queue read them with the review; nothing edits them after
-- submit. Nullable so legacy rows behave unchanged.
ALTER TABLE "Review" ADD COLUMN "media" JSONB;
