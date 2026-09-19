-- A parent can have more than one child.
--
-- `BabyProfile.userId` carried a UNIQUE index, so the database enforced one
-- baby per account. No data moves here and none is lost: every existing row
-- stays exactly as it is and simply becomes that parent's first child.
--
-- The plain index that replaces it is not optional. `listBabies` and every
-- authorised read filter on `userId`, and without an index those become a
-- sequential scan of the whole table on every page load of the parenting hub.
DROP INDEX "BabyProfile_userId_key";

CREATE INDEX "BabyProfile_userId_idx" ON "BabyProfile"("userId");
