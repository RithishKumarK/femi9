import { SignJWT, jwtVerify } from 'jose'
import type { Brand } from '@femi9/db'

/**
 * Shopper session tokens — sign, verify, and the cookie they live in.
 *
 * Deliberately free of `server-only` and `next/headers`, so a route guard can
 * verify a cookie before any request handler runs without dragging
 * request-scoped APIs (or the data layer) in with it. `./auth` is the
 * request-scoped half that reads the cookie jar.
 *
 * This mirrors `./admin-session`, and for the same reason: it means there is
 * ONE verifier. Femi9's storefront middleware still re-implements this inline
 * because it targets the edge runtime; anything on Node calls this instead.
 */

export interface CustomerSession {
  sub: string
  phone?: string
  email?: string
  name?: string
}

/** 30 days, in seconds. The cookie Max-Age and the JWT expiry stay in lockstep
 *  so a still-present cookie always carries a still-valid token. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

/**
 * Each brand's shopper session has its own cookie name and audience.
 *
 * Both derive to exactly what Femi9 already issues — `femi9_session`, audience
 * `femi9-customer` — so making this brand-aware invalidated no live session.
 * The brands are on separate hosts, which already isolates cookies; distinct
 * audiences mean a token still cannot cross brands even if a cookie is copied
 * across by hand, because both brands sign with the same secret.
 */
export function sessionCookieName(brand: Brand): string {
  return `${brand}_session`
}

export function customerAudience(brand: Brand): string {
  return `${brand}-customer`
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(secret)
}

/** Sign a 30-day token. Only defined claims are written, so an absent phone or
 *  email does not land as a null claim. */
export async function createSession(brand: Brand, payload: CustomerSession): Promise<string> {
  return new SignJWT({
    ...(payload.phone ? { phone: payload.phone } : {}),
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.name ? { name: payload.name } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setAudience(customerAudience(brand))
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey())
}

/**
 * Verify a token FOR A SPECIFIC BRAND.
 *
 * The brand is an argument rather than something read off the token, so a
 * caller must say which storefront it is guarding. Any failure — bad signature,
 * expiry, wrong audience, missing subject, absent token — reads as "not signed
 * in".
 */
export async function verifySession(
  brand: Brand,
  token: string | undefined,
): Promise<CustomerSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
      audience: customerAudience(brand),
    })
    // A valid signature over a payload with no subject is not a usable identity.
    if (typeof payload.sub !== 'string') return null
    return {
      sub: payload.sub,
      phone: typeof payload.phone === 'string' ? payload.phone : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    }
  } catch {
    return null
  }
}
