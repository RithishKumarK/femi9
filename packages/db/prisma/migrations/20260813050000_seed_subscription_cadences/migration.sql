-- Subscription cadences are reference data, not user content: the product page
-- renders a fixed set of three options and posts the code to /api/subscriptions,
-- which resolves it against this table. Nothing in the codebase ever created
-- these rows, so every subscribe attempt failed with 400 "Unknown cadence" on
-- every deployed environment. Seeding them here means `prisma migrate deploy`
-- (run by the container entrypoint) repairs existing databases on next boot.
--
-- Keep in sync with CADENCES in src/data/products.ts.
-- Idempotent: re-running leaves any operator edits to label/sub/days intact.
INSERT INTO "Cadence" ("id", "code", "label", "sub", "days", "active", "position")
VALUES
  ('cadence_cycle', 'cycle', 'Every cycle',   'Arrives ~3 days before your period', 25, true, 0),
  ('cadence_4w',    '4w',    'Every 4 weeks', 'A steady four-week refill',          28, true, 1),
  ('cadence_6w',    '6w',    'Every 6 weeks', 'For lighter or shorter cycles',      42, true, 2)
ON CONFLICT ("code") DO NOTHING;
