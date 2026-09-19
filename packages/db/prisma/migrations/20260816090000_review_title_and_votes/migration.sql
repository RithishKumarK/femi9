-- Review headlines and helpful/unhelpful votes on the product page.
--
-- The PDP review card grew a one-line headline above the body and a thumbs
-- up/down control under it. The headline is nullable: every row written before
-- this migration has none, and the card falls back to the rating's own wording
-- rather than printing an empty heading.
--
-- The tallies are denormalised onto Review because the product page reads them
-- for every card on every render and never needs to know WHO voted. ReviewVote
-- carries that, and only to enforce one vote per visitor per review — a
-- client-side guard alone is a localStorage clear away from being meaningless.

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "title" TEXT,
ADD COLUMN     "helpfulUp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "helpfulDown" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReviewVote" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "voterKey" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewVote_reviewId_idx" ON "ReviewVote"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVote_reviewId_voterKey_key" ON "ReviewVote"("reviewId", "voterKey");

-- AddForeignKey
ALTER TABLE "ReviewVote" ADD CONSTRAINT "ReviewVote_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
