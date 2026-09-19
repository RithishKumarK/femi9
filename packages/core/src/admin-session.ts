import { SignJWT, jwtVerify } from 'jose'
import type { Brand } from '@femi9/db'
import type { AdminRole } from '@femi9/db-platform'

/**
 * Admin session tokens — sign, verify, and the cookie they live in.
 *
 * Deliberately free of `server-only`, `next/headers` and the platform database.
 * The route guard (`proxy.ts`) needs to verify a token before any request
 * handler runs, and pulling Prisma or request-scoped APIs in there would drag
 * the whole data layer into the guard.
 *
 * This is the single implementation. Femi9's storefront middleware re-implements
 * its own verification inline because it runs on the edge runtime; the admin
 * console runs `proxy` on Node, so it can just call this — one verifier, not the
 * same check written twice.
 */

export type { AdminRole }

export interface AdminSession {
  sub: string
  email: string
  name: string
  brand: Brand
  role: AdminRole
  /** True while the current password is a temporary one from an invite email
   *  that has not been changed yet. The proxy redirects such a session to
   *  /change-password on every non-exempt route. Cleared on the next login
   *  after the password is changed. Absent claim / false → normal access. */
  mustChangePassword?: boolean
}

/** 8 hours. Ops sessions are short on purpose — this console can refund money. */
export const SESSION_SECONDS = 60 * 60 * 8

/** One cookie per brand, so both consoles can be open in different tabs. */
export function adminCookieName(brand: Brand): string {
  return `f9_admin_${brand}`
}

function secretKey(): Uint8Array {
  const secret = process.env.ADMIN_AUTH_SECRET || process.env.AUTH_SECRET
  if (!secret) throw new Error('ADMIN_AUTH_SECRET (or AUTH_SECRET) is not set')
  return new TextEncoder().encode(secret)
}

/** Audience is brand-specific, so a Femi9 token cannot verify as a Lumi9 one. */
function audienceFor(brand: Brand): string {
  return `femi9-admin-${brand}`
}

export async function createAdminSession(session: AdminSession): Promise<string> {
  return new SignJWT({
    email: session.email,
    name: session.name,
    brand: session.brand,
    role: session.role,
    ...(session.mustChangePassword ? { mustChangePassword: true } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.sub)
    .setAudience(audienceFor(session.brand))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secretKey())
}

/**
 * Verify a token FOR A SPECIFIC BRAND.
 *
 * The brand is an argument, not something read off the token, so a caller has
 * to say which console it is guarding. A token minted for the other brand fails
 * the audience check, and the redundant `payload.brand` comparison means a
 * token that somehow passed audience still cannot claim the wrong brand.
 *
 * Any failure — bad signature, expiry, wrong audience, missing claim, absent
 * token — reads as "not signed in".
 */
export async function verifyAdminSession(
  token: string | undefined,
  brand: Brand,
): Promise<AdminSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
      audience: audienceFor(brand),
    })
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.role !== 'string' ||
      payload.brand !== brand
    ) {
      return null
    }
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      brand,
      role: payload.role as AdminRole,
      mustChangePassword: payload.mustChangePassword === true,
    }
  } catch {
    return null
  }
}

/** Role ordering for LEGACY comparisons. `super_admin` maps identically to
 *  `owner`; the other business roles get rank -1 so any code path that
 *  compares them via `hasAtLeast` (which is module-blind) DENIES access. Every
 *  business role that should have access to something has to declare it in
 *  admin-policy.ts, per the module, or `requireConsoleApi` won't let it in. */
const RANK: Record<AdminRole, number> = {
  owner: 3,
  manager: 2,
  support: 1,
  readonly: 0,
  super_admin: 3,
  finance: -1,
  orders_manager: -1,
  content_manager: -1,
}

export function hasAtLeast(role: AdminRole, required: AdminRole): boolean {
  return RANK[role] >= RANK[required]
}
