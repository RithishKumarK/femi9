import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Edge guard for this app's authenticated surface: the customer account area.
 * It verifies an HS256 session cookie with Web Crypto (no Node/server-only
 * imports) so it stays edge-compatible. Guarded server layouts and route
 * handlers verify again in the Node runtime.
 *
 * The ops console USED to live here. It now has its own app (apps/admin), its
 * own per-brand cookies, and a `proxy.ts` guard on the Node runtime — which is
 * why that one can call the shared verifier instead of re-implementing it the
 * way this file still has to.
 */

const SESSION_COOKIE = 'femi9_session'

export const config = {
  // Customer /api/auth/* is intentionally NOT matched here — those endpoints must
  // stay public (they're how you obtain a session in the first place). /welcome
  // joins the list because onboarding writes to the signed-in user's own row:
  // it needs a session, but NOT a complete profile (that check can't happen at
  // the edge — it's a DB read — so it lives in the /account and /dashboard
  // server pages, which redirect here while the profile is incomplete).
  //
  // Nothing outside these four prefixes is matched, so static assets, /_next
  // and every storefront route stay untouched.
  matcher: ['/account/:path*', '/dashboard/:path*', '/welcome/:path*'],
}

/** Verify a session JWT against AUTH_SECRET, bound to the given audience so a
 *  token minted for the other surface is rejected. Any failure (bad sig, expiry,
 *  wrong audience, missing secret, absent token) reads as "not signed in". */
async function isValidToken(token: string | undefined, audience: string): Promise<boolean> {
  if (!token || !process.env.AUTH_SECRET) return false
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]
    const header = JSON.parse(new TextDecoder().decode(base64urlBytes(headerPart))) as {
      alg?: unknown
    }
    if (header.alg !== 'HS256') return false
    const payload = JSON.parse(new TextDecoder().decode(base64urlBytes(payloadPart))) as {
      aud?: unknown
      exp?: unknown
      nbf?: unknown
      sub?: unknown
    }
    const now = Math.floor(Date.now() / 1000)
    const audienceMatches =
      payload.aud === audience ||
      (Array.isArray(payload.aud) && payload.aud.some((value) => value === audience))
    if (
      !audienceMatches ||
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now ||
      (typeof payload.nbf === 'number' && payload.nbf > now)
    ) {
      return false
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(process.env.AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify(
      'HMAC',
      key,
      base64urlBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )
  } catch {
    return false
  }
}

function base64urlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  // ── Customer surface (/account, /dashboard, /welcome) ───────────────────────
  if (await isValidToken(req.cookies.get(SESSION_COOKIE)?.value, 'femi9-customer')) {
    return NextResponse.next()
  }

  // Carry the requested path across sign-in so the shopper lands where she was
  // headed. The clone keeps the original query string, so it is cleared before
  // `next` is written — otherwise /account?verified=email would arrive at
  // /login carrying a stray `verified` param. /login validates `next` again
  // (must be a same-origin path, never /api and never /welcome) before using it.
  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''
  loginUrl.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}
