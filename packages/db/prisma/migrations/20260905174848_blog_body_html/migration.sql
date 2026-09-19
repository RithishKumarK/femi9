-- Add rich-HTML body column for blog posts. Nullable so existing rows are
-- unaffected; storefronts prefer bodyHtml when present and fall back to body.
ALTER TABLE "BlogPost" ADD COLUMN "bodyHtml" TEXT;
