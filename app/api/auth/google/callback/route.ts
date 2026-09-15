import { NextResponse, type NextRequest } from 'next/server'
import {
  googleConfigured,
  exchangeCodeForProfile,
  mockProfile,
  callbackUrl,
  OAUTH_STATE_COOKIE,
  OAUTH_NEXT_COOKIE,
  type GoogleProfile,
} from '@femi9/core/google-oauth'
import { safeNextPath } from '@/lib/safe-next'
import { signInWithGoogle } from '@femi9/core/services/auth'
import { missingProfileFields } from '@femi9/core/services/account'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@femi9/core/auth'
import { mockProvidersAllowed } from '@femi9/core/runtime-mode'
import { THARA_REF_COOKIE } from '@femi9/core/thara/cookies'
import { clientIp } from '@femi9/core/rate-limit'
import { GUEST_COOKIE } from '@/lib/session'
import { mergeGuestCartIntoUser } from '@femi9/core/services/cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google/callback — where Google (or, in mock mode, our own start
 * route) sends the user back. Verify the anti-CSRF state against the cookie,
 * resolve the verified profile, find-or-create the customer, set the session
 * cookie, and 307 to /account (or /welcome while the profile is incomplete).
 * Any failure bounces to /login?error=google. Always a redirect — this is a
 * top-level navigation, never a fetch.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const base = process.env.NEXT_PUBLIC_SITE_URL || url.origin
  // Both handshake cookies are single-use: clear them on every exit path so an
  // abandoned attempt cannot leave a stale destination behind for the next one.
  const clearHandshake = (res: NextResponse) => {
    const expire = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    }
    res.cookies.set(OAUTH_STATE_COOKIE, '', expire)
    res.cookies.set(OAUTH_NEXT_COOKIE, '', expire)
    return res
  }

  const fail = (reason: string) => {
    if (reason) console.error('[auth] google callback failed:', reason)
    return clearHandshake(NextResponse.redirect(new URL('/login?error=google', base), 307))
  }

  // 1. CSRF: the state in the query must match the one we set at start.
  const state = url.searchParams.get('state')
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value
  if (!state || !cookieState || state !== cookieState) return fail('state mismatch')

  // Google surfaces user-declined / config errors as ?error=...
  const oauthError = url.searchParams.get('error')
  if (oauthError) return fail(`google returned error=${oauthError}`)

  try {
    // 2. Resolve the verified profile — live exchange, or the mock identity.
    let profile: GoogleProfile
    if (googleConfigured()) {
      const code = url.searchParams.get('code')
      if (!code) return fail('missing code')
      profile = await exchangeCodeForProfile(code, callbackUrl(url.origin))
    } else {
      if (!mockProvidersAllowed()) return fail('Google is not configured')
      if (url.searchParams.get('mock') !== '1') return fail('mock marker missing')
      profile = mockProfile()
    }

    // 3. Find-or-create the customer and mint OUR session.
    const attributionCtx = {
      cookieToken: req.cookies.get(THARA_REF_COOKIE)?.value ?? null,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? null,
    }
    const user = await signInWithGoogle('femi9', profile, attributionCtx)
    await mergeGuestCartIntoUser('femi9', req.cookies.get(GUEST_COOKIE)?.value ?? null, user.id)
    const jwt = await createSession('femi9', {
      sub: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      name: user.name ?? undefined,
    })

    // Google gives us a name and an email but never a phone, so a first-time
    // Google shopper is still incomplete and lands on /welcome — where the
    // rendered fields are driven by `missing`, i.e. just the mobile step. Either
    // way the destination she was headed for survives the detour.
    const next = safeNextPath(req.cookies.get(OAUTH_NEXT_COOKIE)?.value, '/account')
    const incomplete = missingProfileFields(user).length > 0
    const target = incomplete
      ? `/welcome${next !== '/account' ? `?next=${encodeURIComponent(next)}` : ''}`
      : next

    const res = NextResponse.redirect(new URL(target, base), 307)
    res.cookies.set(SESSION_COOKIE, jwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    })
    clearHandshake(res)
    res.cookies.set(THARA_REF_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'unknown error')
  }
}
