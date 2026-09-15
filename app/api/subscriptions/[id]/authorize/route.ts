import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, handle, notFound, ok, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { isConfigured, verifySubscriptionSignature } from '@femi9/core/razorpay'
import { clientIp, rateLimit, tooManyRequests } from '@femi9/core/rate-limit'
import { authorizationFor, confirmMandate } from '@femi9/core/services/subscriptions'

/**
 * Mandate authorisation for one subscription.
 *
 *   GET   → the `authorization` block again, so a plan the shopper abandoned
 *           mid-Checkout can be finished from the account page instead of being
 *           re-created (which would leave her with two plans and two debits).
 *   POST  → the SYNCHRONOUS return from Razorpay Checkout after her bank
 *           approved the mandate.
 *
 * Two mutually-exclusive POST modes, chosen by `isConfigured('femi9')` and never
 * by the client — the same discipline as /api/payments/verify:
 *
 *  CONFIGURED: the browser hands back subscription_id + payment_id + signature.
 *  The signed payload for a MANDATE is `payment_id|subscription_id` (the reverse
 *  of a one-off order's), verified in @femi9/core/razorpay. A bad signature is a
 *  forged callback → 400.
 *
 *  MOCK (no keys, dev/test): there is no gateway and nothing to sign, so an
 *  explicit { mock: true } confirms. Gated on isConfigured === false, so once
 *  real keys exist this body fails the live schema and is REJECTED — the mock
 *  path can never authorise a mandate in production.
 *
 * The webhook (`subscription.authenticated`) confirms the same mandate
 * independently. Both are idempotent: whichever lands first wins and the other
 * is a no-op, because a shopper who closes the tab before this call returns must
 * still end up with a live plan.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LiveSchema = z.object({
  razorpay_subscription_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

const MockSchema = z.object({ mock: z.literal(true) })

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()
    const authorization = await authorizationFor('femi9', id, u.sub)
    if (!authorization) return notFound('Subscription not found')
    return ok({ authorization })
  })
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const hit = await rateLimit(`sub-authorize:${clientIp(req)}`, 10, 60_000)
  if (!hit.ok) return tooManyRequests(hit.retryAfterSec)

  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()

    // Ownership first, and it doubles as the lookup of the gateway id we are
    // allowed to confirm. Never trust the subscription id in the body: a caller
    // could otherwise post someone else's handles and activate their plan.
    const owned = await authorizationFor('femi9', id, u.sub)
    if (!owned) return notFound('Subscription not found')

    const raw = await req.json().catch(() => null)

    if (isConfigured('femi9')) {
      const parsed = LiveSchema.safeParse(raw)
      if (!parsed.success) return badRequest('Invalid authorization payload', parsed.error.flatten())
      const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = parsed.data

      if (razorpay_subscription_id !== owned.razorpaySubscriptionId) {
        return badRequest('Authorization does not match this subscription')
      }
      const valid = verifySubscriptionSignature('femi9', {
        subscriptionId: razorpay_subscription_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      })
      if (!valid) return badRequest('Mandate signature verification failed')

      await confirmMandate('femi9', razorpay_subscription_id, 'authenticated')
      return ok({ ok: true, status: 'active' })
    }

    const parsed = MockSchema.safeParse(raw)
    if (!parsed.success) return badRequest('Invalid authorization payload')
    await confirmMandate('femi9', owned.razorpaySubscriptionId, 'authenticated')
    return ok({ ok: true, status: 'active', mock: true })
  })
}
