import type { NextRequest } from 'next/server'
import { handle, ok, badRequest } from '@femi9/core/api'
import { suppressEmail } from '@femi9/core/services/thara'
import { verifyResendWebhook } from '@femi9/core/resend-webhook'
import { mockProvidersAllowed } from '@femi9/core/runtime-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/resend — Resend delivery event.
 *
 * On email.bounced (hard) or email.complained, adds the recipient to the
 * Thara suppression list so subsequent /api/thara/invite calls refuse them.
 * Signature verification requires RESEND_WEBHOOK_SECRET; when not configured
 * we accept unsigned events only when ALLOW_MOCK_PROVIDERS is on.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const raw = await req.text()
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
    if (secret) {
      const verified = verifyResendWebhook(raw, {
        id: req.headers.get('svix-id'),
        timestamp: req.headers.get('svix-timestamp'),
        signature: req.headers.get('svix-signature'),
      }, secret)
      if (!verified) return badRequest('Invalid webhook signature')
    } else if (!mockProvidersAllowed()) {
      return badRequest('Webhook verification is not configured')
    }

    let body: {
      type?: string
      data?: { to?: string | string[]; bounce?: { type?: string } }
    }
    try {
      body = JSON.parse(raw)
    } catch {
      return badRequest('Body is not JSON')
    }

    const type = body.type
    const rcpts = ([] as string[]).concat(body.data?.to ?? [])
    const address = rcpts[0]?.trim().toLowerCase()
    if (!address) return ok({ ignored: true })

    if (type === 'email.bounced' && body.data?.bounce?.type === 'hard') {
      await suppressEmail('femi9', address, 'hard_bounce')
      return ok({ suppressed: address })
    }
    if (type === 'email.complained') {
      await suppressEmail('femi9', address, 'complaint')
      return ok({ suppressed: address })
    }
    return ok({ ignored: true, type })
  })
}
