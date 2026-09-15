import { NextResponse, type NextRequest } from 'next/server'
import { verifyMagicLink } from '@femi9/core/services/auth'
import { missingProfileFields } from '@femi9/core/services/account'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@femi9/core/auth'
import { THARA_REF_COOKIE } from '@femi9/core/thara/cookies'
import { clientIp } from '@femi9/core/rate-limit'
import { safeNextPath } from '@/lib/safe-next'
import { GUEST_COOKIE } from '@/lib/session'
import { mergeGuestCartIntoUser } from '@femi9/core/services/cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/email/verify?token=RAW&email=EMAIL — the destination of the
 * magic link. On success set the session cookie and redirect; on any failure
 * bounce to /login?error=link. This is a top-level navigation (the user clicked
 * a link in their inbox), so it must redirect, never return JSON.
 *
 * Where it lands matters: a magic-link signup captures an email and nothing
 * else — no name, no reachable phone — so an incomplete profile goes to
 * /welcome rather than to an /account page that would render "Femi9 member"
 * and two em-dashes. A complete profile honours a validated `next`.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  const email = url.searchParams.get('email') ?? ''
  const next = safeNextPath(url.searchParams.get('next'), '/account')
  // Canonical origin for the redirect target; fall back to the request origin.
  const base = process.env.NEXT_PUBLIC_SITE_URL || url.origin

  const attributionCtx = {
    cookieToken: req.cookies.get(THARA_REF_COOKIE)?.value ?? null,
    ip: clientIp(req),
    ua: req.headers.get('user-agent') ?? null,
  }

  try {
    const user = await verifyMagicLink('femi9', email, token, attributionCtx)
    await mergeGuestCartIntoUser('femi9', req.cookies.get(GUEST_COOKIE)?.value ?? null, user.id)
    const jwt = await createSession('femi9', {
      sub: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      name: user.name ?? undefined,
    })

    // Carry `next` through onboarding so finishing /welcome still returns the
    // shopper to the page that sent them to sign in.
    const incomplete = missingProfileFields(user).length > 0
    const destination = incomplete
      ? `/welcome${next !== '/account' ? `?next=${encodeURIComponent(next)}` : ''}`
      : next

    const res = NextResponse.redirect(new URL(destination, base), 307)
    res.cookies.set(SESSION_COOKIE, jwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    })
    res.cookies.set(THARA_REF_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  } catch (err) {
    // Typed link errors are expected (stale/tampered link); anything else is a
    // real fault worth logging, but the shopper still just sees the login error.
    if (!(err instanceof Error) || err.name !== 'InvalidMagicLinkError') {
      console.error('[auth] magic-link verify failed', err)
    }
    return NextResponse.redirect(new URL('/login?error=link', base), 307)
  }
}
