import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest, created, handle, serviceUnavailable } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { getGuestToken } from '@/lib/session'
import { clientIp, rateLimit, tooManyRequests } from '@femi9/core/rate-limit'
import { orderToken } from '@femi9/core/order-token'
import {
  EmptyCartError,
  InvalidCouponError,
  OutOfStockError,
  ZeroTotalOrderError,
  placeOrder,
} from '@femi9/core/services/checkout'
import { ProviderConfigurationError } from '@femi9/core/runtime-mode'

/**
 * POST /api/checkout — turn the guest's cart into a pending order.
 *
 * Money is never taken from the body; placeOrder recomputes it from the DB.
 * We only validate the shipping/customer fields here. Domain errors map to
 * precise statuses so the storefront can show the right message inline:
 *   EmptyCartError  → 400   OutOfStockError → 409 (with the item name)
 */

// Empty optional text fields arrive as '' from the form; normalise to undefined
// so `.optional()` validators don't reject a blank the user simply left empty.
const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const CheckoutSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  phone: z.string().trim().regex(/^\d{10}$/, 'Enter a valid 10-digit mobile number'),
  email: z.preprocess(blankToUndef, z.string().trim().email('Enter a valid email').optional()),
  line: z.string().trim().min(1, 'Please enter your address').max(300),
  city: z.string().trim().min(1, 'Please enter your city').max(120),
  state: z.preprocess(blankToUndef, z.string().trim().max(120).optional()),
  pincode: z.preprocess(blankToUndef, z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode').optional()),
  couponCode: z.preprocess(blankToUndef, z.string().trim().max(40).optional()),
  // The shopper's own name for this address. Every order used to stamp 'Home'.
  addressLabel: z.preprocess(blankToUndef, z.string().trim().max(40).optional()),
})

/** 409 helper — api.ts has no conflict envelope, so build it inline. */
function conflict(error: string) {
  return NextResponse.json({ error }, { status: 409 })
}

export async function POST(req: NextRequest) {
  // Throttle order placement per client IP to blunt spam / double-submit abuse.
  const rl = await rateLimit('checkout:' + clientIp(req), 10, 60_000)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec)

  return handle(async () => {
    // No guest cookie means no cart was ever created — treat as empty.
    const token = await getGuestToken()
    if (!token) return badRequest('Your bag is empty.')

    const session = await getSession('femi9')

    const raw = await req.json().catch(() => null)
    const parsed = CheckoutSchema.safeParse(raw)
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    try {
      // Returns { orderNo, payment } — the payment intent (razorpay order id,
      // amount, publishable key, configured flag) the client uses to open
      // Checkout or, in mock mode, to POST the dev verify call.
      // A signed-in shopper's order belongs to HER account. Without this the
      // service identified the buyer by the phone typed into the form, so a
      // magic-link or Google customer got a second User row per order and her
      // order history stayed empty forever.
      const result = await placeOrder('femi9', token, parsed.data, session?.sub)
      // Hand back an unguessable capability token so the confirmation page can
      // authorize a guest (no session) without exposing PII to orderNo guessing.
      return created({ ...result, token: orderToken(result.orderNo) })
    } catch (err) {
      if (err instanceof EmptyCartError) return badRequest(err.message)
      if (err instanceof InvalidCouponError) return badRequest(err.message)
      // A fully-discounted basket. 400 rather than 409: nothing raced, the basket
      // simply has nothing left to charge, and the message names the discount
      // code so she is not left staring at a gateway error.
      if (err instanceof ZeroTotalOrderError) return badRequest(err.message)
      if (err instanceof OutOfStockError) return conflict(err.message)
      if (err instanceof ProviderConfigurationError) {
        return serviceUnavailable('Online payment is temporarily unavailable.')
      }
      throw err // unexpected → handle() turns it into a 500
    }
  })
}
