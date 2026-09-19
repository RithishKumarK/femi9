-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "cta" TEXT,
ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "keywords" TEXT[],
ADD COLUMN     "metaTitle" TEXT;

-- CreateTable
CREATE TABLE "BlogPostFaq" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BlogPostFaq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlogPostFaq_postId_idx" ON "BlogPostFaq"("postId");

-- AddForeignKey
ALTER TABLE "BlogPostFaq" ADD CONSTRAINT "BlogPostFaq_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

