import 'server-only'
import { cookies } from 'next/headers'
import { isBrand, type Brand } from '@femi9/db'
import { platformDb } from '@femi9/db-platform'
import { fakeVerify, verifyPassword } from './admin-password'
import {
  adminCookieName,
  verifyAdminSession,
  type AdminRole,
  type AdminSession,
} from './admin-session'

/**
 * Admin identity: signing in, reading the current session, and the audit trail.
 *
 * Token mechanics live in `./admin-session`, which carries no Prisma and no
 * request-scoped imports so the route guard can use it directly. This module is
 * the database-touching half.
 */

export type { AdminRole, AdminSession }
export {
  adminCookieName,
  createAdminSession,
  verifyAdminSession,
  hasAtLeast,
  SESSION_SECONDS,
} from './admin-session'

/** Read + verify the current request's session for one brand. */
export async function getAdminSession(brand: Brand): Promise<AdminSession | null> {
  const token = (await cookies()).get(adminCookieName(brand))?.value
  return verifyAdminSession(token, brand)
}

export interface SignInResult {
  ok: boolean
  session?: AdminSession
}

/**
 * Authenticate an admin FOR ONE BRAND.
 *
 * Three things must all hold: the account exists, it is active, and it holds a
 * role in the brand being asked for. Every failure returns the same shape, and
 * callers must render the same message for all of them — "this email exists but
 * not for Lumi9" is a staff directory for anyone who can reach the login page.
 *
 * The brand argument comes from the login form's toggle, which is untrusted
 * client input. It is narrowed with `isBrand` here, and the membership lookup is
 * what actually authorises; the toggle only ever states a request.
 */
export async function signInAdmin(
  brandInput: unknown,
  email: string,
  password: string,
): Promise<SignInResult> {
  if (!isBrand(brandInput)) {
    // Not a real brand. Still burn the time, so a bad brand is not a fast probe.
    await fakeVerify()
    return { ok: false }
  }
  const brand: Brand = brandInput

  const db = platformDb()
  const admin = await db.adminUser.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { memberships: { where: { brand } } },
  })

  // No account, or a disabled one: spend the same time a real verify costs.
  if (!admin || !admin.active) {
    await fakeVerify()
    return { ok: false }
  }

  const passwordOk = await verifyPassword(password, admin.passwordHash)
  const membership = admin.memberships[0]

  // Both checks are evaluated before branching and collapse into one answer, so
  // a valid password for the wrong brand is indistinguishable from a wrong one.
  if (!passwordOk || !membership) return { ok: false }

  await db.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })

  return {
    ok: true,
    session: {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      brand,
      role: membership.role,
      mustChangePassword: admin.mustChangePassword,
    },
  }
}

/** Which brands this admin may switch to, for the header switcher. */
export async function brandsFor(adminUserId: string): Promise<Brand[]> {
  const rows = await platformDb().adminBrandRole.findMany({
    where: { adminUserId, adminUser: { active: true } },
    select: { brand: true },
  })
  return rows.map((r) => r.brand as Brand)
}

/** Record an action against the brand's console. Never throws into a request. */
export async function audit(entry: {
  adminUserId: string | null
  brand: Brand
  action: string
  target?: string
  meta?: Record<string, unknown>
  ip?: string
}): Promise<void> {
  try {
    await platformDb().adminAuditLog.create({
      data: {
        adminUserId: entry.adminUserId,
        brand: entry.brand,
        action: entry.action,
        target: entry.target,
        meta: entry.meta as never,
        ip: entry.ip,
      },
    })
  } catch {
    // An audit write must never take down the action it is describing.
  }
}
