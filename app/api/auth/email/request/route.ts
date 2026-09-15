import type { NextRequest } from 'next/server'
import { ok, badRequest, handle, serviceUnavailable } from '@femi9/core/api'
import { requestMagicLink, InvalidEmailError, normalizeEmail } from '@femi9/core/services/auth'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { ProviderConfigurationError } from '@femi9/core/runtime-mode'
import { safeNextPath } from '@/lib/safe-next'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/auth/email/request — { email } → mint + send a magic link.
 *  In mock mode the response includes devLink so the flow is testable now. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; next?: unknown }
    const email = typeof body.email === 'string' ? body.email : ''
    // Validated here as well as on the way back in: this value is about to be
    // baked into a URL we email out, so it must never leave as an off-site link.
    const next = safeNextPath(typeof body.next === 'string' ? body.next : null, '/account')

    // Mirrors the OTP sibling exactly, and for the same reason: requestMagicLink
    // sends to ANY syntactically valid address without upserting anything, so
    // without a limit this endpoint is an unauthenticated amplifier that will
    // deliver Femi9-branded mail to arbitrary third-party inboxes on demand.
    // Per-IP stops one client bursting; per-address stops mail-bombing one inbox.
    // Both run BEFORE we touch the DB or Resend.
    const ipHit = await rateLimit('email:req:ip:' + clientIp(req), 5, 60_000)
    if (!ipHit.ok) return tooManyRequests(ipHit.retryAfterSec)
    const addrHit = await rateLimit('email:req:addr:' + normalizeEmail(email), 5, 3_600_000)
    if (!addrHit.ok) return tooManyRequests(addrHit.retryAfterSec)

    try {
      const { mock, devLink } = await requestMagicLink('femi9', email, next)
      return ok({ ok: true, mock, ...(devLink ? { devLink } : {}) })
    } catch (err) {
      if (err instanceof InvalidEmailError) return badRequest(err.message)
      if (err instanceof ProviderConfigurationError) {
        return serviceUnavailable('Email sign-in is temporarily unavailable.')
      }
      throw err
    }
  })
}
