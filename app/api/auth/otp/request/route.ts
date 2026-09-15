import type { NextRequest } from 'next/server'
import { ok, badRequest, handle, serviceUnavailable } from '@femi9/core/api'
import { requestOtp, InvalidPhoneError, normalizePhone } from '@femi9/core/services/auth'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { ProviderConfigurationError } from '@femi9/core/runtime-mode'

// node:crypto (via the OTP seam) needs the Node runtime; cookies/DB make it dynamic.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/auth/otp/request — { phone } → mint + send an OTP.
 *  In mock mode the response includes devCode so the flow is testable now. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { phone?: unknown }
    const phone = typeof body.phone === 'string' ? body.phone : ''

    // Throttle OTP minting before we touch the DB or an SMS provider: per-IP to
    // stop a single client bursting, per-phone (over an hour) to stop SMS-bombing
    // one number. Key the phone bucket on the same canonical value the service uses.
    const ipHit = await rateLimit('otp:req:ip:' + clientIp(req), 5, 60_000)
    if (!ipHit.ok) return tooManyRequests(ipHit.retryAfterSec)
    const phHit = await rateLimit('otp:req:ph:' + normalizePhone(phone), 5, 3_600_000)
    if (!phHit.ok) return tooManyRequests(phHit.retryAfterSec)

    try {
      const { mock, devCode } = await requestOtp('femi9', phone)
      return ok({ ok: true, mock, ...(devCode ? { devCode } : {}) })
    } catch (err) {
      if (err instanceof InvalidPhoneError) return badRequest(err.message)
      if (err instanceof ProviderConfigurationError) {
        return serviceUnavailable('WhatsApp sign-in is temporarily unavailable.')
      }
      throw err
    }
  })
}
