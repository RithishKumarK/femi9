-- CreateTable
CREATE TABLE "TharaSuppressedEmail" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TharaSuppressedEmail_pkey" PRIMARY KEY ("email")
);
