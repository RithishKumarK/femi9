import 'server-only'
import type { Prisma, SubscriptionStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { adminCancel } from '../subscriptions'

/**
 * Admin subscriptions service — mostly the read side for the Ops console's
 * subscription table: one list read, shaped for the table (customer + product
 * + cadence + next-delivery), with an optional status filter for the chips.
 *
 * Subscription state is normally owned by the customer — pause / resume / skip
 * are hers alone, via `services/subscriptions.ts`, and this module has no write
 * for any of them. `cancelSubscription` below is the one exception: a plan a
 * customer no longer wants can be stopped from here when she called support
 * instead of using her account page, or when the mandate needs stopping
 * regardless of who asks. It wraps `adminCancel`, the ONE mutation in the
 * shared service that is not scoped to a customer's `userId` — see the note
 * there for why the gateway call still comes first.
 */

// Source of truth for the filter chips + the filter guard. Matches the
// SubscriptionStatus enum in schema.prisma exactly.
//
// `pending_mandate` is the one ops most needs a chip for: those are shoppers who
// started a plan and never finished authorising it, so nothing recurs and
// nothing is charged. They look like customers and are not yet.
export const SUBSCRIPTION_STATUSES = [
  'pending_mandate',
  'active',
  'paused',
  'halted',
  'cancelled',
] as const

/** True when `s` is a real SubscriptionStatus — guards the URL-supplied filter. */
function isStatus(s: string): s is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s)
}

/** One row in the admin subscriptions table. */
export interface AdminSubscriptionRow {
  id: string
  customerName: string
  customerContact: string | null // phone, falling back to email
  product: string
  variantLabel: string
  qty: number
  frequency: string // cadence.label
  nextDelivery: Date // formatted by the (server-component) page
  status: SubscriptionStatus
  savedTotal: number
  /** Rupees the mandate debits per cycle; null on a legacy pay-later plan. */
  chargeAmount: number | null
  /** The Razorpay subscription id, for looking the mandate up in their
   *  dashboard when a customer calls about a charge. Null on a legacy plan. */
  razorpaySubscriptionId: string | null
  /** False when the customer never completed the bank approval. */
  mandateActive: boolean
}

/**
 * All subscriptions (optionally filtered by status), ordered by the soonest next
 * delivery so the ops team sees what's shipping next at the top.
 */
export async function listSubscriptions(brand: Brand, {
  status,
}: { status?: string } = {}): Promise<AdminSubscriptionRow[]> {
  const prisma = dbFor(brand)
  try {
    const where: Prisma.SubscriptionWhereInput = {}
    // Silently ignore an unknown status so a stale/hand-edited URL never 500s.
    if (status && isStatus(status)) where.status = status

    const rows = await prisma.subscription.findMany({
      where,
      orderBy: { nextDeliveryAt: 'asc' },
      include: {
        user: { select: { name: true, phone: true, email: true } },
        variant: { include: { product: { select: { name: true } } } },
        cadence: { select: { label: true } },
      },
    })

    return rows.map((r) => ({
      id: r.id,
      customerName: r.user?.name ?? 'Member',
      customerContact: r.user?.phone ?? r.user?.email ?? null,
      product: r.variant.product.name,
      variantLabel: r.variant.label,
      qty: r.qty,
      frequency: r.cadence.label,
      nextDelivery: r.nextDeliveryAt,
      status: r.status,
      savedTotal: r.savedTotal,
      chargeAmount: r.chargeAmount,
      razorpaySubscriptionId: r.razorpaySubscriptionId,
      mandateActive: r.mandateAuthedAt != null,
    }))
  } catch {
    return []
  }
}

/** True when `s` is one of the three statuses a plan can be cancelled FROM.
 *  `cancelled` itself and `pending_mandate` — never authorised, nothing to
 *  stop — are excluded so the console never offers a cancel that would do
 *  nothing (the gateway has no cancel-a-`created`-subscription call this
 *  reaches for) or that is already done. */
export const ADMIN_CANCELLABLE_STATUSES: readonly SubscriptionStatus[] = ['active', 'paused', 'halted']

/**
 * Cancel one subscription, brand-scoped, from the console.
 *
 * Returns `null` when the id does not resolve under this brand — the route
 * turns that into a 404, the same "not found" a customer's own cancel gives
 * for an id that is not hers, so this cannot be used to probe for a
 * subscription's existence either.
 */
export async function cancelSubscription(
  brand: Brand,
  id: string,
): Promise<{ id: string; status: SubscriptionStatus } | null> {
  const view = await adminCancel(brand, id)
  if (!view) return null
  return { id: view.id, status: view.status }
}
