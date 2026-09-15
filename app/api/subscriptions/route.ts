import { z } from 'zod'
import { badRequest, created, handle, ok, serviceUnavailable, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { ProviderConfigurationError } from '@femi9/core/runtime-mode'
import { UnsupportedCadenceError } from '@femi9/core/services/subscription-plans'
import {
  createSubscription,
  listForUser,
  CadenceNotFoundError,
  VariantNotFoundError,
} from '@femi9/core/services/subscriptions'

/**
 * Subscriptions collection endpoint for the signed-in customer.
 *   GET  → the user's subscriptions.
 *   POST → start a subscription (from the product page's "Subscribe & save").
 *
 * Both require a customer session. The auth check runs BEFORE the body is read so
 * an unauthenticated POST returns 401 without creating anything — the product page
 * relies on that 401 to bounce guests to /login.
 *
 * POST is the FIRST half of a two-phase flow. It creates the plan and the
 * gateway subscription but authorises nothing: the response carries an
 * `authorization` block the browser hands to Razorpay Checkout, and the plan
 * only starts billing once the customer's bank approves the mandate. A 201 here
 * therefore does NOT mean "subscribed" — it means "ready to authorise".
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().int().min(1).max(99).default(1),
  // Cadence code as seeded: 'cycle' | '4w' | '6w'. Validated against the DB in the service.
  cadenceCode: z.string().min(1),
})

export async function GET() {
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()
    return ok({ subscriptions: await listForUser('femi9', u.sub) })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid subscription', parsed.error.flatten())

    try {
      const result = await createSubscription('femi9', u.sub, parsed.data)
      return created(result)
    } catch (err) {
      // Stale cadence code / product option is a client problem, not a 500.
      if (err instanceof CadenceNotFoundError || err instanceof VariantNotFoundError) {
        return badRequest(err.message)
      }
      // A cadence whose day count has no Razorpay rhythm is a misconfigured
      // Cadence row, not something the shopper can fix — but it must not 500 the
      // product page either.
      if (err instanceof UnsupportedCadenceError) {
        return serviceUnavailable('That delivery frequency is unavailable right now.')
      }
      // No live gateway credentials: we cannot take a mandate, and creating a
      // plan we can never bill would be worse than refusing.
      if (err instanceof ProviderConfigurationError) {
        return serviceUnavailable('Subscriptions are temporarily unavailable.')
      }
      throw err
    }
  })
}
