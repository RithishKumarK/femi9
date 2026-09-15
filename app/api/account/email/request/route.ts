import type { NextRequest } from 'next/server'
import { badRequest, conflict, handle, ok, serviceUnavailable, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { ProviderConfigurationError } from '@femi9/core/runtime-mode'
import {
  assertIdentityFree,
  IdentityConflictError,
  InvalidEmailError,
  normalizeEmail,
  requestAttachEmailLink,
} from '@femi9/core/services/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/account/email/request — { email } → send a confirmation link that
 * turns an unverified address into a verified one (or attaches a first address
 * to a phone-OTP account, which otherwise gets no reward-code email at all).
 *
 * The link is minted under the `attach-email:<userId>:<email>` namespace, so it
 * can never be redeemed by the SIGN-IN verifier to mint a session for a
 * different account.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await requireUser('femi9')
    if (!session) return unauthorized()

    const body = (await req.json().catch(() => ({}))) as { email?: unknown }
    const email = typeof body.email === 'string' ? body.email : ''

    const ipHit = await rateLimit('email:req:ip:' + clientIp(req), 5, 60_000)
    if (!ipHit.ok) return tooManyRequests(ipHit.retryAfterSec)
    const addrHit = await rateLimit('email:req:addr:' + normalizeEmail(email), 5, 3_600_000)
    if (!addrHit.ok) return tooManyRequests(addrHit.retryAfterSec)

    try {
      // Refuse an address owned by another account before sending anything.
      await assertIdentityFree('femi9', session.sub, 'email', email)
      const { mock, devLink } = await requestAttachEmailLink('femi9', session.sub, email)
      return ok({ ok: true, mock, ...(devLink ? { devLink } : {}) })
    } catch (err) {
      if (err instanceof IdentityConflictError) {
        return conflict(err.message, { code: 'identity_conflict', field: err.field })
      }
      if (err instanceof InvalidEmailError) return badRequest(err.message)
      if (err instanceof ProviderConfigurationError) {
        return serviceUnavailable('Email verification is temporarily unavailable.')
      }
      throw err
    }
  })
}
