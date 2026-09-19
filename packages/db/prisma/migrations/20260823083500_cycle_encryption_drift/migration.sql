-- Reconcile schema drift, not a new feature.
--
-- The cycle-encryption columns were applied to the running database with
-- `prisma db push` and never captured as a migration, so `schema.prisma` and
-- the migration history disagreed. A database built purely from history — a
-- fresh environment, CI, or Lumi9's brand-new schema — would be missing them,
-- while the live one already has them.
--
-- Every statement is therefore idempotent: this is a no-op against the live
-- database and a fix-up against any freshly built one. `DROP NOT NULL` is
-- naturally repeatable; the ADD COLUMNs are guarded.

ALTER TABLE "PeriodLog"  ADD COLUMN IF NOT EXISTS "encryptedData" TEXT;
ALTER TABLE "PeriodLog"  ALTER COLUMN "startDate"  DROP NOT NULL;
ALTER TABLE "PeriodLog"  ALTER COLUMN "lengthDays" DROP NOT NULL;

ALTER TABLE "SymptomLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SymptomLog" ADD COLUMN IF NOT EXISTS "encryptedData" TEXT;
ALTER TABLE "SymptomLog" ALTER COLUMN "date"    DROP NOT NULL;
ALTER TABLE "SymptomLog" ALTER COLUMN "symptom" DROP NOT NULL;
ALTER TABLE "SymptomLog" ALTER COLUMN "level"   DROP NOT NULL;
