-- Extend AdminRole with per-module business roles.
-- Owner/manager/support/readonly remain for back-compat; the new values are
-- mapped to a per-module policy in @femi9/core/admin-policy.
ALTER TYPE "AdminRole" ADD VALUE 'super_admin';
ALTER TYPE "AdminRole" ADD VALUE 'finance';
ALTER TYPE "AdminRole" ADD VALUE 'orders_manager';
ALTER TYPE "AdminRole" ADD VALUE 'content_manager';
