import { NextResponse, type NextRequest } from 'next/server'
import { refCookieName, logClick } from '@femi9/core/services/affiliate'

/**
 * GET /a/[code] — creator (affiliate) referral link entry point.
 *
 * This route is the missing half of the affiliate programme. `placeOrder` has
 * always read the `femi9_ref` cookie to attribute commission, and `logClick`
 * has always existed — but nothing anywhere in the repo ever WROTE that cookie
 * or called that function. Every creator's clicks, orders and earnings were
 * therefore permanently zero while the marketing page promised live tracking.
 *
 * Deliberately mirrors /r/[code] (the Thara membership referral) rather than
 * inventing a second pattern: normalise, record, drop an httpOnly cookie, 302
 * home. An unknown, pending or suspended code still redirects home — a stale
 * link must be harmless, never an error page — and logClick no-ops for it, so a
 * guessed code cannot manufacture tracking noise.
 *
 * The cookie is httpOnly (a client script has no reason to read an attribution
 * token), sameSite lax so it survives the cross-site click that created it, and
 * lives 30 days, matching the window the creator terms describe.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 30 days, in seconds. */
const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  // Same base fix as /r/[code]: req.url is `http://0.0.0.0:3000/...` behind the
  // ALB because the standalone server binds HOSTNAME=0.0.0.0, so every creator
  // link redirected to an unroutable address. The cookie was set correctly the
  // whole time — the visitor just never landed on the shop to spend it.
  const home = new URL('/', process.env.NEXT_PUBLIC_SITE_URL?.trim() || req.url)
  const { code: raw } = await ctx.params
  const code = (raw ?? '').trim().toUpperCase()

  // Length guard before touching the DB: the code column is short, and an
  // arbitrarily long path segment should not become a query.
  if (!code || code.length > 40) return NextResponse.redirect(home)

  // Fire-and-await, but never let a logging failure cost the visitor her
  // redirect — she came here to reach the shop.
  await logClick('femi9', code).catch(() => {})

  const res = NextResponse.redirect(home)
  res.cookies.set(refCookieName('femi9'), code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REF_COOKIE_MAX_AGE,
    path: '/',
  })
  return res
}
