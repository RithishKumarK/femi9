import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { handle, ok, unauthorized, notFound, badRequest } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import {
  sendTharaInvite,
  TharaInviteBadEmailError,
  TharaInviteNotEligibleError,
  TharaInviteSelfError,
  TharaInviteSuppressedError,
} from '@femi9/core/services/thara'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ email: z.string().min(3).max(200) })

/**
 * POST /api/thara/invite — send a referral invite to a friend's email.
 * Rate-limited to 10 per user per hour + 20 per IP per hour, so a single
 * account can't fan out to hundreds of addresses.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (!isTharaEnabled()) return notFound()

    const session = await getSession('femi9')
    if (!session) return unauthorized()

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid body', parsed.error.format())

    const perUser = await rateLimit(`thara:invite:user:${session.sub}`, 10, 60 * 60 * 1000)
    if (!perUser.ok) return tooManyRequests(perUser.retryAfterSec)
    const perIp = await rateLimit(`thara:invite:ip:${clientIp(req)}`, 20, 60 * 60 * 1000)
    if (!perIp.ok) return tooManyRequests(perIp.retryAfterSec)

    try {
      const result = await sendTharaInvite('femi9', session.sub, parsed.data.email)
      return ok({ sent: true, mock: result.mock })
    } catch (e) {
      if (e instanceof TharaInviteBadEmailError) return badRequest(e.message)
      if (e instanceof TharaInviteNotEligibleError) return badRequest(e.message)
      if (e instanceof TharaInviteSelfError) return badRequest(e.message)
      if (e instanceof TharaInviteSuppressedError) return badRequest(e.message)
      throw e
    }
  })
}
