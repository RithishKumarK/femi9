import type { NextRequest } from 'next/server'
import { badRequest, ok, handle, serviceUnavailable } from '@femi9/core/api'
import { webhookConfigured, verifyWebhookSignature } from '@femi9/core/razorpay'
import { logger } from '@femi9/core/logger'
import { markOrderPaid, orderNoForRazorpayOrderId } from '@femi9/core/services/checkout'
import { recordGatewayRefund } from '@femi9/core/services/admin/orders'
import {
  confirmMandate,
  recordSubscriptionCharge,
  syncGatewayStatus,
} from '@femi9/core/services/subscriptions'

/**
 * POST /api/webhooks/razorpay — the ASYNCHRONOUS capture path.
 *
 * Razorpay POSTs signed events here. We authenticate with
 * HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET) against the x-razorpay-signature
 * header, so the body MUST be read as raw text (a re-serialized JSON would not
 * match the signature byte-for-byte).
 *
 * Two families of event arrive here and they mean different things:
 *
 *   payment.captured / order.paid   — a ONE-OFF checkout payment. We resolve our
 *                                     order from the gateway order id and mark it
 *                                     paid; this is the source of truth even if
 *                                     the shopper closed the tab before the sync
 *                                     verify call ran.
 *   subscription.*                  — the MANDATE lifecycle. `subscription.charged`
 *                                     is where a recurring box's order is born,
 *                                     already paid. The rest is state we cannot
 *                                     learn any other way: a customer revoking her
 *                                     mandate in her banking app never touches our
 *                                     UI, and Razorpay halting a plan after a run
 *                                     of failed debits is a decision we do not make.
 *
 * Unverified calls are rejected (400). Unconfigured (no keys) → no real webhooks
 * can arrive and there's no secret to verify with, so we just 200 and do nothing.
 */

export const dynamic = 'force-dynamic'

// Minimal shape of the events we act on. Razorpay sends the payment entity on
// payment.captured, both the order and payment entities on order.paid, and the
// subscription entity (plus a payment entity on `charged`) on subscription.*.
type RazorpayWebhookEvent = {
  event?: string
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; method?: string; amount?: number }
    }
    order?: { entity?: { id?: string } }
    // `refund.processed` carries the refund entity, whose `payment_id` names
    // what was returned. The payment entity rides along too, but the refund is
    // the authoritative half — a partial refund raises one event per refund
    // against the same payment.
    refund?: {
      entity?: { id?: string; payment_id?: string; amount?: number; created_at?: number }
    }
    subscription?: {
      entity?: { id?: string; status?: string; current_end?: number | null }
    }
  }
}

/**
 * The mandate lifecycle.
 *
 * `subscription.charged` is the ONLY place a gateway-managed renewal order comes
 * into existence, and it arrives AFTER the bank has moved the money. Everything
 * it does downstream (order, Payment row, loyalty points, the confirmation
 * email) records something that has already happened rather than authorising
 * something that might.
 */
async function handleSubscriptionEvent(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload?.subscription?.entity
  if (!sub?.id) return

  const currentEnd =
    typeof sub.current_end === 'number' && sub.current_end > 0
      ? new Date(sub.current_end * 1000)
      : null

  if (event.event === 'subscription.charged') {
    const payment = event.payload?.payment?.entity
    // A charge with no payment entity cannot be booked: there is no gateway
    // payment id to be idempotent on and no amount to reconcile against. Log it
    // rather than guess — inventing a payment would corrupt the money path, and
    // Razorpay will redeliver.
    if (!payment?.id || !payment.order_id || typeof payment.amount !== 'number') {
      logger.error('[webhook] subscription.charged without a usable payment entity', {
        razorpaySubscriptionId: sub.id,
      })
      return
    }
    await recordSubscriptionCharge('femi9', {
      razorpaySubscriptionId: sub.id,
      razorpayPaymentId: payment.id,
      razorpayOrderId: payment.order_id,
      amountPaise: payment.amount,
      method: payment.method,
      currentEnd,
    })
    return
  }

  if (event.event === 'subscription.authenticated' || event.event === 'subscription.activated') {
    await confirmMandate('femi9', sub.id, sub.status ?? 'authenticated')
    return
  }

  // pending / paused / resumed / halted / cancelled / completed — pure state.
  await syncGatewayStatus('femi9', sub.id, sub.status ?? '', currentEnd)
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    // Read the exact bytes ONCE — required for a correct signature check.
    const rawBody = await req.text()

    // No keys → no genuine webhook and nothing to verify against. Acknowledge so
    // any stray/probe call isn't treated as an error.
    if (!webhookConfigured('femi9')) {
      if (process.env.NODE_ENV === 'production') {
        return serviceUnavailable('Payment webhook is not configured.')
      }
      return ok({ ok: true, ignored: true })
    }

    const signature = req.headers.get('x-razorpay-signature')
    if (!verifyWebhookSignature('femi9', rawBody, signature)) {
      return badRequest('Invalid webhook signature')
    }

    // Signature is good → safe to parse the (now trusted) body.
    let event: RazorpayWebhookEvent
    try {
      event = JSON.parse(rawBody) as RazorpayWebhookEvent
    } catch {
      return badRequest('Malformed webhook body')
    }

    if (event.event?.startsWith('subscription.')) {
      await handleSubscriptionEvent(event)
      return ok({ ok: true })
    }

    /*
     * A refund issued in the Razorpay DASHBOARD rather than in the console.
     *
     * Nothing consumed this event until now, so the money went back and this
     * database never heard: the order stayed `paid`, its Payment row stayed
     * `captured`, the customer kept her loyalty points and every sales figure
     * counted a sale that had been reversed. Nothing on any screen looked wrong
     * — the same shape as the unscheduled-cron failures.
     *
     * Keyed on the REFUND entity's `payment_id`, not on the payment entity: a
     * partial refund raises one event per refund against the same payment, and
     * `recordGatewayRefund` is idempotent on the order's compare-and-swap
     * rather than on the event, so a redelivery converges instead of reversing
     * the books twice.
     */
    if (event.event === 'refund.processed') {
      const entity = event.payload?.refund?.entity
      const paymentId = entity?.payment_id ?? event.payload?.payment?.entity?.id
      if (paymentId) {
        // The refund's OWN id and timestamp are carried through and written to
        // the Payment row. Without them a refunded order says 'refunded' with
        // nothing to quote at Razorpay, which is the whole difficulty when one
        // is disputed weeks later. The gateway's `created_at` is preferred over
        // ours because a redelivered webhook can arrive long after the money
        // moved.
        await recordGatewayRefund('femi9', paymentId, {
          id: entity?.id,
          at:
            typeof entity?.created_at === 'number' && entity.created_at > 0
              ? new Date(entity.created_at * 1000)
              : undefined,
        })
      } else {
        logger.error('[webhook] refund.processed without a payment id', { event: event.event })
      }
      return ok({ ok: true })
    }

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const paymentEntity = event.payload?.payment?.entity
      const orderEntity = event.payload?.order?.entity
      const razorpayOrderId = paymentEntity?.order_id ?? orderEntity?.id
      const razorpayPaymentId = paymentEntity?.id
      const method = paymentEntity?.method

      if (razorpayOrderId) {
        const orderNo = await orderNoForRazorpayOrderId('femi9', razorpayOrderId)
        if (orderNo) {
          await markOrderPaid('femi9', {
            orderNo,
            // Fall back to a deterministic id if the event omitted the payment id
            // (e.g. an order.paid without an entity), so the @unique column is set.
            razorpayPaymentId: razorpayPaymentId ?? `whook_${razorpayOrderId}`,
            razorpayOrderId,
            signatureVerified: true,
            method,
            // What the gateway says it actually took. Everything else
            // markOrderPaid checks is our own data, so without this a short
            // capture would flip the order to paid. Absent on a bare
            // `order.paid` with no payment entity, where the check is skipped.
            capturedAmountPaise: paymentEntity?.amount,
          })
        }
      }
    }

    // 200 for any verified event we understood (even an unhandled type) so
    // Razorpay stops retrying.
    return ok({ ok: true })
  })
}
