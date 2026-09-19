-- Lumi9's parenting tools stop being a browser feature.
--
-- /parenting-tools kept its entire state in one localStorage blob and read two
-- hardcoded TypeScript modules. That was fine while the page was a calculator.
-- It stopped being fine once the page started PROMISING things: an emailed care
-- plan whose address we then threw away, a "3 done / 1 due now" vaccination
-- count inferred from the calendar rather than from anything a parent told us,
-- and a size-up projection whose weight bands were a second copy of numbers the
-- console owns.
--
-- The privacy line does not move. A SIGNED-OUT parent still writes nothing here
-- -- localStorage stays the store for a guest, and these tables exist only for a
-- shopper with an account to attach a baby to.
--
-- Every table below is additive and every column added to an existing table is
-- nullable, so this migration is safe to run against both brand schemas even
-- though only `lumi9` will ever hold a row. Femi9 has no parenting page; the
-- schema is shared, the rows are not.

-- ─────────────────────────────── Enums ────────────────────────────────
-- BloodGroup's labels are mapped, not sanitised: "A+" is what a parent picks,
-- what the card prints and what the emailed plan says, and a PG enum holds it
-- verbatim. Storing A_POS and translating at four call sites is how a display
-- string and a stored value drift.
CREATE TYPE "BabySex" AS ENUM ('male', 'female');
CREATE TYPE "BloodGroup" AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');
CREATE TYPE "VaccineTrack" AS ENUM ('UIP', 'IAP');
CREATE TYPE "DoseAgeUnit" AS ENUM ('weeks', 'months', 'years');
CREATE TYPE "VaccinationStatus" AS ENUM ('given', 'skipped');

-- ─────────────────────── Catalogue: numeric weight bands ──────────────
-- `ProductSpec` already carries "7-12 kg" for the size chips, and
-- src/lib/size-projection.ts carried its own SIZE_BOUNDS array beside it with a
-- comment conceding the two "must be kept in step" by hand. They were not.
-- Renaming a range in the console moved what a parent READ and never what the
-- projector CALCULATED, and there was no error anywhere to say so.
--
-- Parsing the display string at runtime was the other option and is worse: it
-- lets a copy edit ("about 7 to 12 kg") silently change the maths.
--
-- Nullable and unbackfilled on purpose. A Femi9 pad has no weight band, and a
-- Lumi9 product with neither bound set drops OUT of the size projection rather
-- than defaulting into a band nobody measured it for. `prisma/seed.ts` fills
-- Lumi9's five.
ALTER TABLE "Product" ADD COLUMN "minWeightKg" DOUBLE PRECISION,
ADD COLUMN "maxWeightKg" DOUBLE PRECISION;

-- ───────────────────────────── BabyProfile ────────────────────────────
-- `dob` and every other birthday-shaped column is DATE, not TIMESTAMP. A
-- birthday has no time and no zone, and a UTC-midnight timestamp read back in
-- IST is the day before -- which on this page is a vaccination dated one day
-- early on every single dose.
CREATE TABLE "BabyProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "dob" DATE NOT NULL,
    "sex" "BabySex" NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "gestationalWeeks" INTEGER,
    "bloodGroup" "BloodGroup",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BabyProfile_pkey" PRIMARY KEY ("id")
);

-- One profile per account, which is what every surface assumes ("Tell us about
-- your baby", "Aarav's dashboard"). Siblings are a real future ask and the fix
-- is dropping this constraint plus a primary picker in the UI -- not a babyId
-- threaded through code that has no screen to choose one with today.
CREATE UNIQUE INDEX "BabyProfile_userId_key" ON "BabyProfile"("userId");

-- ─────────────────────────── BabyMeasurement ──────────────────────────
-- BabyProfile.weightKg is the LATEST reading, denormalised because every tool
-- wants "how big is this baby now" and none of them wants a series. This is the
-- series, so an edit no longer destroys the previous value.
CREATE TABLE "BabyMeasurement" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BabyMeasurement_pkey" PRIMARY KEY ("id")
);

-- One reading per baby per day: a parent nudging the weight field three times in
-- a sitting is one measurement, not three.
CREATE UNIQUE INDEX "BabyMeasurement_babyId_takenOn_key" ON "BabyMeasurement"("babyId", "takenOn");
CREATE INDEX "BabyMeasurement_babyId_takenOn_idx" ON "BabyMeasurement"("babyId", "takenOn");

-- ──────────────────────────── VaccineDose ─────────────────────────────
-- The published immunisation schedule, which a government revises and which was
-- a TypeScript array -- so correcting a dose age meant a deploy, and the IAP tab
-- was an empty list the UI had to hide.
--
-- `ageUnit`/`ageValue` deliberately do NOT normalise to days: "9 months" means
-- the 9th of the birth month, not 274 days after birth, and flattening the
-- three units drifts by days on exactly the doses a parent diarises.
CREATE TABLE "VaccineDose" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "ageUnit" "DoseAgeUnit" NOT NULL,
    "ageValue" INTEGER NOT NULL,
    "tracks" "VaccineTrack"[],
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaccineDose_pkey" PRIMARY KEY ("id")
);

-- `code` is the stable key the seed upserts on and every BabyVaccination points
-- at, so re-seeding a corrected schedule never orphans a parent's record.
CREATE UNIQUE INDEX "VaccineDose_code_key" ON "VaccineDose"("code");
CREATE INDEX "VaccineDose_active_position_idx" ON "VaccineDose"("active", "position");

-- ────────────────────────── BabyVaccination ───────────────────────────
-- Without this the dashboard's "3 done" was inferred purely from the calendar:
-- it counted doses whose due date had passed, which says nothing about whether
-- the baby was actually taken.
CREATE TABLE "BabyVaccination" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "doseId" TEXT NOT NULL,
    "status" "VaccinationStatus" NOT NULL,
    "givenOn" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BabyVaccination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BabyVaccination_babyId_doseId_key" ON "BabyVaccination"("babyId", "doseId");
CREATE INDEX "BabyVaccination_babyId_idx" ON "BabyVaccination"("babyId");

-- ─────────────────────────── ParentingLead ────────────────────────────
-- The care-plan route sent its message and kept nothing, so the one piece of
-- first-party data this whole surface collects reached the outbox and no
-- further: no list to follow up, no way to tell whether the feature is used at
-- all, and no record that the address was given for THIS purpose -- which is
-- what makes a later marketing send defensible or not.
--
-- NewsletterSubscriber stays separate on purpose. Asking for a vaccination plan
-- is not subscribing to a newsletter, and merging the two would be a consent
-- claim the parent never made.
CREATE TABLE "ParentingLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "babyName" TEXT,
    "dob" DATE,
    "sex" "BabySex",
    "bloodGroup" "BloodGroup",
    "source" TEXT,
    "userId" TEXT,
    "planCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentingLead_pkey" PRIMARY KEY ("id")
);

-- Unique on email so a returning parent is one row with a planCount, not a
-- constraint violation the route has to swallow.
CREATE UNIQUE INDEX "ParentingLead_email_key" ON "ParentingLead"("email");
CREATE INDEX "ParentingLead_createdAt_idx" ON "ParentingLead"("createdAt");
CREATE INDEX "ParentingLead_userId_idx" ON "ParentingLead"("userId");

-- ─────────────────────────── Foreign keys ─────────────────────────────
-- Cascade from the parent account and from the baby: deleting a shopper must
-- take the child's health data with it, and there is no ops case for a
-- measurement whose baby is gone.
ALTER TABLE "BabyProfile" ADD CONSTRAINT "BabyProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BabyMeasurement" ADD CONSTRAINT "BabyMeasurement_babyId_fkey"
    FOREIGN KEY ("babyId") REFERENCES "BabyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BabyVaccination" ADD CONSTRAINT "BabyVaccination_babyId_fkey"
    FOREIGN KEY ("babyId") REFERENCES "BabyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BabyVaccination" ADD CONSTRAINT "BabyVaccination_doseId_fkey"
    FOREIGN KEY ("doseId") REFERENCES "VaccineDose"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: the lead's whole value is the address, and it outlives
-- the account exactly as NewsletterSubscriber and EventLog already do.
ALTER TABLE "ParentingLead" ADD CONSTRAINT "ParentingLead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
