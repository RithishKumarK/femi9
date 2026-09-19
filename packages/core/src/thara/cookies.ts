import 'server-only'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Attribution cookie: carries the referrer's TharaMembership id from the
 * /r/[code] click through to signup, at which point the signup hook consumes
 * it and creates the TharaReferral row. Signed with AUTH_SECRET (HS256) so
 * a hostile shopper can't hand-craft one. Distinct audience keeps it from
 * being confused with the customer/admin session cookies.
 *
 * The cookie is HttpOnly and SameSite=Lax; TTL is 30 days.
 */

export const THARA_REF_COOKIE = 'femi9_thara_ref'
export const THARA_REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

const AUDIENCE = 'femi9-thara-ref'

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export async function signTharaRefCookie(referrerMembershipId: string): Promise<string> {
  return new SignJWT({ ref: referrerMembershipId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${THARA_REF_COOKIE_MAX_AGE}s`)
    .sign(secretKey())
}

export async function verifyTharaRefCookie(
  token: string,
): Promise<{ referrerMembershipId: string } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    })
    if (typeof payload.ref !== 'string') return null
    return { referrerMembershipId: payload.ref }
  } catch {
    return null
  }
}
