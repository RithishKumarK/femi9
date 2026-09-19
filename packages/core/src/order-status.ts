import type { OrderStatus } from '@prisma/client'

/**
 * Every status that means "this order was paid for and not reversed".
 *
 * Order.status is a SINGLE linear pipeline — pending → paid → processing →
 * shipped → delivered — with no separate paid flag and no paidAt column. So
 * fulfilling an order OVERWRITES 'paid', and any query asking "has this
 * customer paid before?" by matching 'paid' alone silently loses every order
 * that has since been dispatched.
 *
 * That has bitten twice: it stopped Thara unlocking off a delivered order,
 * and it made the Bloom welcome bonus payable again to any repeat customer
 * whose earlier orders had shipped. Reach for this instead of a bare 'paid'
 * whenever the question is about payment history rather than about where an
 * order sits in fulfilment right now.
 *
 * 'cancelled' and 'refunded' stay out — those are reversals, not fulfilment.
 */
export const PAID_ORDER_STATUSES: OrderStatus[] = [
  'paid',
  'processing',
  'shipped',
  'delivered',
]
