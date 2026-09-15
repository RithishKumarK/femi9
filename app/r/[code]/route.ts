import { NextResponse, type NextRequest } from 'next/server'
import { normalizeReferralCode } from '@femi9/core/thara/codes'
import {
  THARA_REF_COOKIE,
  THARA_REF_COOKIE_MAX_AGE,
  signTharaRefCookie,
} from '@femi9/core/thara/cookies'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import { prisma } from '@/lib/db'

/**
 * GET /r/[code] — referral link entry point.
 *
 * Sets a signed HttpOnly cookie carrying the referrer's TharaMembership id if
 * the code resolves to an eligible (active or purchase_pending) referrer, then
 * 302s to the site homepage. If the feature is off, the code is invalid, or
 * the referrer is suspended/deactivated, we still 302 home but skip the cookie.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
) {
  // Redirect base comes from NEXT_PUBLIC_SITE_URL, not req.url. The standalone
  // server binds HOSTNAME=0.0.0.0 (Dockerfile), so behind the ALB req.url is
  // `http://0.0.0.0:3000/...` — every referral click 307'd the visitor to
  // http://0.0.0.0:3000/, an address that resolves nowhere outside the
  // container. That is the whole point of the link, so it failed silently for
  // anyone who clicked one. Falls back to req.url for local dev, where the env
  // var is unset and the request host is already correct.
  const home = new URL('/', process.env.NEXT_PUBLIC_SITE_URL?.trim() || req.url)

  if (!isTharaEnabled()) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const { code: raw } = await ctx.params
  const code = normalizeReferralCode(raw)
  if (!code) return NextResponse.redirect(home)

  const membership = await prisma.tharaMembership.findUnique({
    where: { referralCode: code },
    select: { id: true, status: true },
  })
  if (!membership) return NextResponse.redirect(home)
  if (membership.status !== 'active' && membership.status !== 'purchase_pending') {
    return NextResponse.redirect(home)
  }

  const token = await signTharaRefCookie(membership.id)
  const res = NextResponse.redirect(home)
  res.cookies.set(THARA_REF_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: THARA_REF_COOKIE_MAX_AGE,
    path: '/',
  })
  return res
}
