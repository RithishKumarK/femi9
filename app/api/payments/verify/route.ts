import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, ok, handle, serviceUnavailable } from '@femi9/core/api'
import { isConfigured, verifyPaymentSignature } from '@femi9/core/razorpay'
import { mockProvidersAllowed } from '@femi9/core/runtime-mode'
import {
  markOrderPaid,
  orderNoForRazorpayOrderId,
  OrderNotFoundError,
  PaymentIntentMissingError,
  PaymentAmountMismatchError,
} from '@femi9/core/services/checkout'

/**
 * POST /api/payments/verify — the SYNCHRONOUS return path from Razorpay Checkout.
 *
 * Two mutually-exclusive modes, chosen by isConfigured('femi9') (never by the client):
 *
 *  CONFIGURED (live keys): the browser hands back the three Razorpay handles +
 *  the signature. We recompute HMAC(order_id|payment_id) and only mark the order
 *  paid if it matches; a bad signature is a forged/tampered callback → 400.
 *
 *  MOCK (keys absent, dev/test): there is no gateway and nothing to sign, so we
 *  accept an explicit { mock:true } and capture with a synthetic payment id and
 *  signatureVerified:false. This branch is gated on isConfigured('femi9')===false, so
 *  once real keys exist a { mock:true } body fails the live schema and is
 *  REJECTED (400) — the mock path can never bypass real payment in production.
 *
 * Idempotent (markOrderPaid short-circuits an already-paid order) and always
 * answers { ok:true, status:'paid' } on success.
 */

export const dynamic = 'force-dynamic'

const LiveSchema = z.object({
  orderNo: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

const MockSchema = z.object({
  orderNo: z.string().min(1),
  mock: z.literal(true),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const raw = await req.json().catch(() => null)

    if (isConfigured('femi9')) {
      const parsed = LiveSchema.safeParse(raw)
      if (!parsed.success) return badRequest('Invalid payment payload', parsed.error.flatten())
      const { orderNo, razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data

      const valid = verifyPaymentSignature('femi9', {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      })
      if (!valid) return badRequest('Payment signature verification failed')

      // Resolve which order this payment belongs to from the VERIFIED gateway
      // order id — never from the client-supplied orderNo, which a caller could
      // swap to a cheaper/other order to claim it paid. The submitted orderNo is
      // only honoured when it matches the order the signed payment actually
      // references.
      const resolvedOrderNo = await orderNoForRazorpayOrderId('femi9', razorpay_order_id)
      if (!resolvedOrderNo) return badRequest('Payment does not match any known order')
      if (resolvedOrderNo !== orderNo) return badRequest('Payment does not match the submitted order')

      try {
        const result = await markOrderPaid('femi9', {
          orderNo: resolvedOrderNo,
          razorpayPaymentId: razorpay_payment_id,
          razorpayOrderId: razorpay_order_id,
          signatureVerified: true,
        })
        return ok({ ok: true, status: result.status })
      } catch (err) {
        if (
          err instanceof OrderNotFoundError ||
          err instanceof PaymentIntentMissingError ||
          err instanceof PaymentAmountMismatchError
        ) {
          return badRequest(err.message)
        }
        throw err
      }
    }

    // Explicit non-production MOCK mode only. Missing production credentials
    // must fail closed; otherwise `{ mock:true }` would become a payment bypass.
    if (!mockProvidersAllowed()) {
      return serviceUnavailable('Online payment is temporarily unavailable.')
    }

    const parsed = MockSchema.safeParse(raw)
    if (!parsed.success) return badRequest('Invalid payment payload', parsed.error.flatten())

    try {
      const result = await markOrderPaid('femi9', {
        orderNo: parsed.data.orderNo,
        razorpayPaymentId: `mockpay_${parsed.data.orderNo}`,
        signatureVerified: false,
      })
      return ok({ ok: true, status: result.status })
    } catch (err) {
      if (
        err instanceof OrderNotFoundError ||
        err instanceof PaymentIntentMissingError ||
        err instanceof PaymentAmountMismatchError
      ) {
        return badRequest(err.message)
      }
      throw err
    }
  })
}
