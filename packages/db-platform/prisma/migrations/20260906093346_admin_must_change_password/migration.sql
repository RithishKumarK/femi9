-- Marks admin accounts whose current password was set by an invite email and
-- has not been changed since. The proxy redirects such a session to
-- /change-password until the flag is cleared, so a temp password is useful
-- only once. Defaults to false so every existing account is unaffected.
ALTER TABLE "AdminUser" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
