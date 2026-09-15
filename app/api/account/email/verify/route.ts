import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@femi9/core/auth'
import { prisma } from '@/lib/db'
import {
  attachIdentity,
  IdentityConflictError,
  verifyAttachEmailToken,
} from '@femi9/core/services/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/account/email/verify?token=RAW&email=EMAIL — the destination of the
 * "confirm your email" link. A top-level navigation from an inbox, so it always
 * redirects and never returns JSON.
 *
 * Unlike the sign-in magic link this does NOT mint a session: the token belongs
 * to a specific userId, and redeeming it only ever stamps emailVerified on THAT
 * row. A signed-out click is bounced through /login first, which is why the
 * failure target is /account rather than a bare error page.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  const email = url.searchParams.get('email') ?? ''
  const base = process.env.NEXT_PUBLIC_SITE_URL || url.origin

  const session = await getSession('femi9')
  if (!session) {
    // Send them through sign-in and back to the same link, so a click from a
    // browser that isn't signed in still completes instead of dead-ending.
    const next = encodeURIComponent(`/api/account/email/verify${url.search}`)
    return NextResponse.redirect(new URL(`/login?next=${next}`, base), 307)
  }

  try {
    const normalized = await verifyAttachEmailToken('femi9', session.sub, email, token)
    await attachIdentity(prisma, session.sub, {
      email: normalized,
      emailVerified: new Date(),
    })
    return NextResponse.redirect(new URL('/account?verified=email', base), 307)
  } catch (err) {
    if (!(err instanceof IdentityConflictError) && (!(err instanceof Error) || err.name !== 'InvalidMagicLinkError')) {
      console.error('[account] email verify failed', err)
    }
    return NextResponse.redirect(new URL('/account?error=link', base), 307)
  }
}
