import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Interim admin auth.
 *
 * Sessions are stateless HS256 JWTs signed with AUTH_SECRET and carried in an
 * httpOnly cookie. We use `jose` (not node:crypto) on purpose so the exact same
 * verify logic is edge-safe — the middleware re-implements verification inline
 * for the edge runtime, and this module is the Node-side counterpart used by
 * route handlers and server components.
 */

export const ADMIN_COOKIE = 'femi9_admin'

export interface AdminSession {
  sub: string
  email: string
  name: string
}

/** Secret key as bytes. Read per-call (cheap) so a rotated env is picked up. */
function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(secret)
}

/** Sign a 7-day session token for the given admin identity. */
export async function createSession(payload: AdminSession): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setAudience('femi9-admin')
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey())
}

/** Verify a token → the session, or null for expired/tampered/absent-claims. */
export async function verifySession(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'], audience: 'femi9-admin' })
    // Guard the claim shape — a valid signature over the wrong payload is still
    // not a usable session.
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.name !== 'string'
    ) {
      return null
    }
    return { sub: payload.sub, email: payload.email, name: payload.name }
  } catch {
    return null
  }
}

/** Server helper: read + verify the admin cookie on the current request. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

/**
 * Guard for route handlers. Same semantics as getAdminSession (returns the
 * session or null) but named for the call site — handlers do
 * `const s = await requireAdmin(); if (!s) return unauthorized()`.
 */
export async function requireAdmin(): Promise<AdminSession | null> {
  return getAdminSession()
}
