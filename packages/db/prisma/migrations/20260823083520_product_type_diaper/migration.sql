-- Lumi9 sells diapers. The ProductType enum only knew Femi9's vocabulary.
--
-- The enum is shared because the SCHEMA is shared: one definition, one client
-- generator, and a Postgres schema per brand. A brand simply never uses the
-- other's values. Adding a value is additive and invisible to Femi9.
--
-- IF NOT EXISTS so re-running is safe. Postgres allows ADD VALUE inside a
-- transaction (which is how Prisma applies migrations); the new value just
-- cannot be USED until that transaction commits, and nothing here uses it.
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'diaper';
