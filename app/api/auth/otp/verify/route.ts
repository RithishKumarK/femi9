import type { NextRequest } from 'next/server'
import { ok, badRequest, handle } from '@femi9/core/api'
import { verifyOtp, InvalidOtpError, InvalidPhoneError, normalizePhone } from '@femi9/core/services/auth'
import { missingProfileFields } from '@femi9/core/services/account'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@femi9/core/auth'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { THARA_REF_COOKIE } from '@femi9/core/thara/cookies'
import { GUEST_COOKIE } from '@/lib/session'
import { mergeGuestCartIntoUser } from '@femi9/core/services/cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/auth/otp/verify — { phone, code } → verify, then set the session
 *  cookie on success. A bad/expired code is a 400. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { phone?: unknown; code?: unknown }
    const phone = typeof body.phone === 'string' ? body.phone : ''
    const code = typeof body.code === 'string' ? body.code : ''

    // Throttle verification attempts to blunt online brute-force: per-IP (burst)
    // and per-phone. This complements the per-code fail counter in verifyOtp.
    const ipHit = await rateLimit('otp:verify:ip:' + clientIp(req), 10, 60_000)
    if (!ipHit.ok) return tooManyRequests(ipHit.retryAfterSec)
    const phHit = await rateLimit('otp:verify:ph:' + normalizePhone(phone), 10, 60_000)
    if (!phHit.ok) return tooManyRequests(phHit.retryAfterSec)

    const attributionCtx = {
      cookieToken: req.cookies.get(THARA_REF_COOKIE)?.value ?? null,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? null,
    }

    try {
      const user = await verifyOtp('femi9', phone, code, attributionCtx)
      await mergeGuestCartIntoUser('femi9', req.cookies.get(GUEST_COOKIE)?.value ?? null, user.id)
      const token = await createSession('femi9', {
        sub: user.id,
        phone: user.phone ?? undefined,
        email: user.email ?? undefined,
        name: user.name ?? undefined,
      })

      // A phone-OTP signup captures a phone and nothing else, so the client has
      // to know whether to land on /account or on the /welcome onboarding step.
      // verifyOtp stays a pure challenge verifier — completeness is derived here
      // from the one shared definition, so the gate and the screen can't disagree.
      const missing = missingProfileFields(user)
      const res = ok({
        ok: true,
        user: { name: user.name, phone: user.phone },
        needsProfile: missing.length > 0,
        missing,
      })
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_MAX_AGE,
      })
      // Clear the referral cookie once consumed (either way — successful
      // attribution or a rejected one — we don't want it re-used).
      res.cookies.set(THARA_REF_COOKIE, '', { path: '/', maxAge: 0 })
      return res
    } catch (err) {
      if (err instanceof InvalidOtpError || err instanceof InvalidPhoneError) {
        return badRequest(err.message)
      }
      throw err
    }
  })
}
