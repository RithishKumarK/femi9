-- The initial platform schema, captured from prisma/schema.prisma.
--
-- Generated with `prisma migrate diff --from-empty`, which had no datasource
-- URL to read and so emitted a `CREATE SCHEMA "public"` header. That header is
-- removed deliberately: every object below is UNQUALIFIED, so it lands in
-- whatever `?schema=` puts on the search_path -- `platform` in every
-- environment. Naming a schema here would pin the migration to one, exactly
-- the coupling schema-per-brand exists to avoid. The brand package's fifteen
-- migrations carry no CREATE SCHEMA either, for the same reason.

-- CreateEnum
CREATE TYPE "Brand" AS ENUM ('femi9', 'lumi9');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('owner', 'manager', 'support', 'readonly');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminBrandRole" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'readonly',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminBrandRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "brand" "Brand" NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminBrandRole_brand_idx" ON "AdminBrandRole"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "AdminBrandRole_adminUserId_brand_key" ON "AdminBrandRole"("adminUserId", "brand");

-- CreateIndex
CREATE INDEX "AdminAuditLog_brand_at_idx" ON "AdminAuditLog"("brand", "at");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminUserId_at_idx" ON "AdminAuditLog"("adminUserId", "at");

-- AddForeignKey
ALTER TABLE "AdminBrandRole" ADD CONSTRAINT "AdminBrandRole_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

