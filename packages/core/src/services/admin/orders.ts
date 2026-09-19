import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import type { CouponType, OrderStatus, PaymentStatus, Prisma } from '@prisma/client'
import * as razorpay from '../../razorpay'
import { sendOrderStatusEmail } from '../order-mail'
import { sendOrderStatusWhatsapp } from '../order-whatsapp'
import {
  reverseTharaCreditForRefund,
  reverseTharaPointsForRefund,
} from '../thara'
import { reverseOrderCommission } from '../affiliate'
import { addressEditState } from '../order-address'
import {
  sendAddressChangeRequest,
  type AddressChangeNotifyResult,
} from '../order-address-notify'

/**
 * Admin orders service — the single seam between the DB and the Ops console's
 * sales views. List/detail are read models shaped for the table + detail page;
 * updateOrderStatus is the one write the module exposes.
 *
 * Money is stored as whole rupees (see schema), so no paise conversion happens
 * here — callers format for display.
 */

// Canonical status list — source of truth for the filter chips + the PATCH
// validator so the UI, service and API never drift. Matches the OrderStatus
// enum in schema.prisma exactly.
export const ORDER_STATUSES = [
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const

/** One row in the orders table (list view). */
export interface OrderListItem {
  id: string
  orderNo: string
  customerName: string
  city: string | null
  itemCount: number
  total: number
  status: OrderStatus
  placedAt: Date
}

export interface ListOrdersArgs {
  status?: string
  q?: string
  page?: number
}

export interface OrderListResult {
  orders: OrderListItem[]
  total: number
  page: number
  pageCount: number
  pageSize: number
}

const PAGE_SIZE = 20

/** True when `s` is a real OrderStatus — guards user-supplied filter values. */
function isStatus(s: string): s is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s)
}

/**
 * Paginated orders, newest first. Optional status filter and a free-text query
 * matched against order number, customer name or shipping city.
 */
export async function listOrders(brand: Brand, { status, q, page = 1 }: ListOrdersArgs = {}): Promise<OrderListResult> {
  const prisma = dbFor(brand)
  const current = Math.max(1, Math.floor(page) || 1)
  try {
    const where: Prisma.OrderWhereInput = {}

    // Silently ignore an unknown status so a stale/hand-edited URL never 500s.
    if (status && isStatus(status)) where.status = status

    const term = q?.trim()
    if (term) {
      where.OR = [
        { orderNo: { contains: term, mode: 'insensitive' } },
        { user: { name: { contains: term, mode: 'insensitive' } } },
        { address: { city: { contains: term, mode: 'insensitive' } } },
      ]
    }

    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (current - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: { select: { name: true } },
          address: { select: { city: true } },
          // Item count without hauling the line rows into the list query.
          _count: { select: { items: true } },
        },
      }),
    ])

    return {
      orders: rows.map((r) => ({
        id: r.id,
        orderNo: r.orderNo,
        customerName: r.user?.name ?? 'Guest',
        city: r.address?.city ?? null,
        itemCount: r._count.items,
        total: r.total,
        status: r.status,
        placedAt: r.placedAt,
      })),
      total,
      page: current,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      pageSize: PAGE_SIZE,
    }
  } catch (err) {
    console.error('Failed to list orders:', err)
    return {
      orders: [],
      total: 0,
      page: current,
      pageCount: 1,
      pageSize: PAGE_SIZE,
    }
  }
}

export interface OrderLine {
  id: string
  productName: string
  variantLabel: string
  unitPrice: number
  qty: number
  lineTotal: number
}

export interface OrderCustomer {
  name: string
  email: string | null
  phone: string | null
}

export interface OrderAddress {
  name: string
  line: string
  city: string
  state: string | null
  pincode: string | null
  phone: string | null
}

/**
 * The coupon an order was placed with, when one still exists.
 *
 * `discount` on the order is the money that actually came off, and it is the
 * only part that is a fact about the ORDER. This is read through the relation,
 * so `type`/`value` are the coupon's rule as it stands TODAY, not necessarily
 * the rule that priced this order - a 10% code later edited to 15% reports 15%
 * beside a discount computed at 10%. The code is the useful half; the rule is
 * context for it, never a recomputation of the total.
 */
export interface OrderCoupon {
  code: string
  type: CouponType
  value: number
}

export interface OrderDetail {
  id: string
  orderNo: string
  status: OrderStatus
  channel: string
  placedAt: Date
  subtotal: number
  discount: number
  /** Null when the order carried no coupon, or when that coupon has since been
   *  hard-deleted - the relation is optional, so the delete nulls `couponId`
   *  and leaves `discount` behind with nothing naming it. */
  coupon: OrderCoupon | null
  shipping: number
  total: number
  customer: OrderCustomer | null
  address: OrderAddress | null
  items: OrderLine[]
  /**
   * The one-time address correction — see `services/order-address.ts`.
   *
   * Surfaced here because support is the only party who can open it, and they
   * decide from this screen. `usedAt` is as important as `grantedAt`: without
   * it the console cannot tell "she has not got round to it" from "she has
   * already changed it once", and those want opposite answers on a call.
   */
  addressEdit: {
    grantedAt: Date | null
    grantedBy: string | null
    usedAt: Date | null
    /** Whether the customer can act on it right now, status included. */
    open: boolean
  }
  /**
   * Whether `refundOrder` would accept this order right now.
   *
   * Computed here rather than as `status === 'paid'` in the console, because
   * the rule is no longer readable from the status alone: a CANCELLED order is
   * refundable exactly while a payment row is still `captured`, and the console
   * has no business seeing payment rows to work that out. Deriving it in two
   * places is how the button came to disagree with the service in the first
   * place — the old `current === 'paid'` hid the only control that could return
   * money on the orders that most needed it.
   */
  refundable: boolean
  /**
   * What actually happened to the MONEY, as opposed to what the status says.
   *
   * The status is one enum on a linear pipeline, and it loses the two facts an
   * operator most needs on a dispute. A `cancelled` order does not say whether
   * it was ever paid — and cancelling never returned the money, so "cancelled"
   * covered both "she never paid" and "she paid and we still have it". A
   * `refunded` order does not say which gateway refund returned it, because
   * `refundPayment` returned an id that nothing wrote down.
   *
   * So this reads the Payment rows, which know both.
   */
  money: {
    /** Rupees the gateway captured, or null if it never did. */
    captured: number | null
    /** The gateway's payment id, to quote at Razorpay. */
    gatewayPaymentId: string | null
    /** Set once the money has gone back. */
    refundedAt: Date | null
    /** The gateway's refund id — the thing to search the dashboard for. */
    gatewayRefundId: string | null
    /**
     * She paid, the order was cancelled, and the money is still ours.
     *
     * The state that most needs saying out loud, because nothing else on the
     * screen says it: cancelling gives back the stock and the coupon and never
     * touches the gateway. `refundable` is true here too, but this is the half
     * that explains WHY a Refund button is showing on a cancelled order.
     */
    paidThenCancelled: boolean
  }
}

/** Full order — items (purchase-time snapshots), customer and shipping. */
export async function getOrder(brand: Brand, id: string): Promise<OrderDetail | null> {
  const prisma = dbFor(brand)
  try {
    const r = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        address: true,
        coupon: { select: { code: true, type: true, value: true } },
        items: { orderBy: { productName: 'asc' } },
        // `refundable` and `money` are both derived from these; the rows
        // themselves never reach the console. See the note on `refundable` for
        // why it must not derive that rule itself.
        payments: {
          select: {
            status: true,
            amount: true,
            razorpayPaymentId: true,
            razorpayRefundId: true,
            refundedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!r) return null

    return {
      id: r.id,
      orderNo: r.orderNo,
      status: r.status,
      channel: r.channel,
      placedAt: r.placedAt,
      subtotal: r.subtotal,
      discount: r.discount,
      coupon: r.coupon
        ? { code: r.coupon.code, type: r.coupon.type, value: r.coupon.value }
        : null,
      shipping: r.shipping,
      total: r.total,
      customer: r.user
        ? { name: r.user.name ?? 'Guest', email: r.user.email, phone: r.user.phone }
        : null,
      address: r.address
        ? {
            name: r.address.name,
            line: r.address.line,
            city: r.address.city,
            state: r.address.state,
            pincode: r.address.pincode,
            phone: r.address.phone,
          }
        : null,
      addressEdit: {
        grantedAt: r.addressEditGrantedAt,
        grantedBy: r.addressEditGrantedBy,
        usedAt: r.addressEditUsedAt,
        open: addressEditState(r).open,
      },
      // The same function refundOrder's guard calls, so the button and the
      // service cannot disagree about what is refundable.
      refundable: refundableFrom(r) !== null,
      money: moneyTrail(r),
      items: r.items.map((it) => ({
        id: it.id,
        productName: it.productName,
        variantLabel: it.variantLabel,
        unitPrice: it.unitPrice,
        qty: it.qty,
        lineTotal: it.lineTotal,
      })),
    }
  } catch (err) {
    console.error(`Failed to get order ${id}:`, err)
    return null
  }
}

/**
 * States that still hold a stock reservation (checkout/renewal decremented on
 * order create; it isn't given back until the order is cancelled or refunded).
 * Cancelling FROM one of these must restore stock; cancelling from any other
 * state (already cancelled/refunded ⇒ released; delivered ⇒ goods shipped) must
 * not, so a re-cancel never double-restores.
 */
const STOCK_RESERVING_STATUSES: OrderStatus[] = ['pending', 'paid', 'processing', 'shipped']

/**
 * Set an order's status. Returns the refreshed detail, or null when no such
 * order exists (a missing id becomes a clean 404 at the route rather than a 500).
 *
 * Transitioning TO 'cancelled' also RELEASES the reserved stock — the mirror of
 * checkout's decrement, mirroring refundOrder's give-back. It runs in one
 * transaction and is gated by a compare-and-swap: only the caller that actually
 * flips a reservation-holding order to 'cancelled' restores stock, so concurrent
 * or repeated cancels can't restore the same lines twice.
 */
export async function updateOrderStatus(brand: Brand, id: string, status: OrderStatus): Promise<OrderDetail | null> {
  const prisma = dbFor(brand)
  // Non-cancellation transitions are a plain status flip (no stock effect).
  if (status !== 'cancelled') {
    // Only send on a REAL transition — the update is scoped to a differing
    // status so an ops double-click cannot re-notify the customer. That, plus
    // the dedupeKey on NotificationLog, makes the dispatch email single-shot.
    const res = await prisma.order.updateMany({
      where: { id, status: { not: status } },
      data: { status },
    })
    if (res.count === 0) {
      // Either the order does not exist or it was already in this status.
      return getOrder(brand, id)
    }
    if (status === 'shipped' || status === 'delivered') {
      const order = await prisma.order.findUnique({ where: { id }, select: { orderNo: true } })
      // Dispatch is email-only: there is no approved WhatsApp template for
      // `shipped`, and the delivered one says the order "has been" completed.
      if (order && status === 'shipped') await sendOrderStatusEmail(brand, order.orderNo, 'shipped')
      if (order && status === 'delivered') await sendOrderStatusWhatsapp(brand, order.orderNo, 'delivered')
    }
    return getOrder(brand, id)
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: { select: { variantId: true, qty: true } } },
    })
    if (!order) return { kind: 'missing' as const }

    // CAS gate: flip to 'cancelled' ONLY from a reservation-holding state. The
    // updateMany row-locks, so exactly one concurrent caller gets count 1 (and
    // restores stock); a second attempt re-evaluates against the now-'cancelled'
    // row, matches nothing, and skips the restore.
    const claimed = await tx.order.updateMany({
      where: { id, status: { in: STOCK_RESERVING_STATUSES } },
      data: { status: 'cancelled' },
    })

    if (claimed.count > 0) {
      // Give the reserved stock back — one atomic increment per line.
      for (const it of order.items) {
        await tx.productVariant.update({
          where: { id: it.variantId },
          data: { stock: { increment: it.qty } },
        })
      }
      if (order.couponId) {
        await tx.coupon.updateMany({
          where: { id: order.couponId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        })
      }
    } else if (order.status !== 'cancelled') {
      // Not holding a reservation (e.g. delivered/refunded) and not already
      // cancelled — honor the requested status change without touching stock.
      await tx.order.update({ where: { id }, data: { status: 'cancelled' } })
    }

    // Only a REAL transition tells the customer. An order that was already
    // cancelled goes through this branch every time an ops click re-submits it,
    // and "we're sorry to inform you" is not a message to send twice. The
    // dedupeKey would catch it too; this keeps the row out of the log entirely.
    const transitioned = claimed.count > 0 || order.status !== 'cancelled'
    return { kind: 'ok' as const, transitioned, orderNo: order.orderNo }
  })

  if (outcome.kind === 'missing') return null
  // Outside the transaction: a Meta round-trip has no business holding a stock
  // restore open, and sendOrderStatusWhatsapp never throws.
  if (outcome.transitioned) await sendOrderStatusWhatsapp(brand, outcome.orderNo, 'cancelled')
  return getOrder(brand, id)
}

/**
 * Thrown when a refund is requested on an order that isn't in a refundable
 * state. A distinct type (rather than a bare Error) lets the route map it to a
 * 400 "can't refund" instead of a generic 500 — the id exists, the action just
 * isn't allowed right now.
 */
export class NotRefundableError extends Error {
  constructor(status: OrderStatus) {
    super(
      `This order cannot be refunded (it is "${status}" and holds no captured payment). ` +
        `Only a paid order, or a cancelled one whose payment was never returned, can be.`,
    )
    this.name = 'NotRefundableError'
  }
}

/**
 * The states a refund may be issued FROM, and what each one has already undone.
 *
 * `paid` is the ordinary case and nothing has been reversed.
 *
 * `cancelled` is the case that had no way out at all. Cancelling a PAID order
 * restores its stock and gives the coupon back — and touches neither the
 * gateway nor the payment row, so the money stays with us. The order then reads
 * `cancelled`, `refundOrder`'s guard was `status === 'paid'`, and the console
 * only rendered the Refund button on a paid order: the money was stranded,
 * unreturnable through this system, on an order whose books already said the
 * sale was reversed. Recovering it meant a refund by hand in the Razorpay
 * dashboard and a manual database correction, and nothing anywhere said so.
 *
 * The distinction matters for exactly one thing, and getting it wrong is a
 * stock bug rather than a money one: a cancel from a reservation-holding status
 * ALREADY restored the stock and the coupon, so refunding from `cancelled` must
 * NOT do it a second time. Where the cancel did not restore them — a cancel
 * from `delivered`, where the goods have gone — not restoring is also the right
 * answer, so the same rule holds in both directions.
 */
type RefundableFrom = 'paid' | 'cancelled'

/**
 * Which state a refund may be issued from, or `null` for "not refundable".
 *
 * The single definition of the rule. `getOrder` calls it to decide whether the
 * console draws a Refund button and `refundOrder` calls it to decide whether to
 * act — the button used to say `status === 'paid'` on its own, and that second
 * copy of a rule is how it came to hide the only control that could return
 * money on the orders that most needed it.
 *
 * ── Why a cancelled order counts a REFUNDED payment as money to give back ───
 * It reads backwards and it is the resume marker. `refundOrder` returns the
 * money BEFORE it reverses the books, so a crash in between leaves the payment
 * `refunded` while the order is still what it was; running it again re-enters
 * at the gateway, adopts the existing refund, and finishes. For a `paid` order
 * that resume works because the guard is the ORDER's status, which the
 * interruption did not touch. Keying the cancelled case on `captured` alone
 * would have broken it in a new way — the retry would be refused and the order
 * stranded again — so it asks whether the payment ever REACHED capture instead.
 *
 * That admits nothing it should not: reversing the books is what moves an order
 * to `refunded`, so a `cancelled` order by definition has unreversed books, and
 * a cancelled order that was never paid for has no payment past `created` or
 * `failed` and stays correctly unrefundable.
 */
/** One Payment row, as much of it as the two derivations below need. */
interface PaymentFacts {
  status: PaymentStatus
  amount: number
  razorpayPaymentId: string | null
  razorpayRefundId: string | null
  refundedAt: Date | null
}

/**
 * Read the money story off the Payment rows.
 *
 * The "captured" row is the one that reached the gateway — `captured` today, or
 * `refunded` if the money has since gone back. A `created` or `failed` row is
 * an intent that never became money and must not be reported as an amount, or
 * an abandoned checkout would read as a payment we are holding.
 *
 * Rows are already ordered newest-first by the caller, so `find` takes the most
 * recent real one. An order can carry several intents: a shopper who dismissed
 * the gateway and retried leaves a `created` row behind each time.
 */
function moneyTrail(order: {
  status: OrderStatus
  payments: readonly PaymentFacts[]
}): OrderDetail['money'] {
  const settled = order.payments.find(
    (p) => p.status === 'captured' || p.status === 'refunded',
  )
  return {
    captured: settled?.amount ?? null,
    gatewayPaymentId: settled?.razorpayPaymentId ?? null,
    refundedAt: settled?.refundedAt ?? null,
    gatewayRefundId: settled?.razorpayRefundId ?? null,
    // Money reached us and the order was cancelled without giving it back.
    // `settled.status === 'captured'` rather than merely "a settled row exists":
    // once it reads `refunded` the money has gone back and this is no longer
    // the state that needs shouting about.
    paidThenCancelled: order.status === 'cancelled' && settled?.status === 'captured',
  }
}

function refundableFrom(order: {
  status: OrderStatus
  payments: readonly { status: PaymentStatus }[]
}): RefundableFrom | null {
  if (order.status === 'paid') return 'paid'
  if (order.status !== 'cancelled') return null
  const reachedCapture = order.payments.some(
    (p) => p.status === 'captured' || p.status === 'refunded',
  )
  return reachedCapture ? 'cancelled' : null
}

/**
 * Refund a paid order end-to-end and return the refreshed detail.
 *
 * ORDER OF OPERATIONS MATTERS HERE, and it is not the obvious one. The whole
 * reversal used to sit inside a single transaction with the gateway call in the
 * middle of it, which read as maximally safe and was the opposite: an
 * interactive transaction has a 5s budget (see PRISMA_TRANSACTION_TIMEOUT_MS),
 * `fetch` had no timeout, and a slow-but-successful refund therefore rolled the
 * database back AFTER the money had already left. The order stayed 'paid', so
 * the status guard — the thing standing between an operator and a second
 * refund — waved the retry straight through. Money gone twice, nothing in the
 * data to say so.
 *
 * So the money moves OUTSIDE any transaction, and the sequence is built to be
 * safely repeatable rather than atomic-or-nothing:
 *
 *   1. Read and REQUIRE a refundable state — 'paid', or 'cancelled' while a
 *      payment row is still 'captured' (see RefundableFrom: cancelling a paid
 *      order never returned the money, and this is the only way to give it
 *      back). A completed refund leaves 'refunded' and no captured payment, so
 *      a double-click is still rejected here.
 *   2. CLAIM the payment row ('captured' -> 'refunded') with a compare-and-swap.
 *      This is what serialises two operators clicking at the same instant: only
 *      one update returns count 1, and it happens before any money moves.
 *   3. Reverse the money at the gateway, with a bounded timeout and no
 *      transaction open. razorpay.refundPayment adopts an existing refund
 *      rather than creating a second one, so a retry converges.
 *   4. Reverse the books in ONE transaction — order + payments to 'refunded',
 *      stock restored, loyalty/Thara/commission clawed back — gated by its own
 *      compare-and-swap so those side effects run exactly once.
 *
 * The in-between state (payment 'refunded', order still 'paid') is deliberate
 * and is the resume marker: it means the money went back but the books did not
 * finish. Running the refund again from there re-enters at step 3, adopts the
 * existing gateway refund, and completes step 4. A stuck order is therefore
 * fixed by clicking Refund again — never by refunding a second time.
 *
 * A refund taken in the Razorpay DASHBOARD instead lands on the same step 4 via
 * `recordGatewayRefund`, which the `refund.processed` webhook calls.
 *
 * Returns null when no such order exists (clean 404 at the route); throws
 * NotRefundableError when the order isn't 'paid'.
 */
export async function refundOrder(brand: Brand, id: string): Promise<OrderDetail | null> {
  const prisma = dbFor(brand)

  // ── 1. Read + guard ────────────────────────────────────────────────────────
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNo: true,
      status: true,
      total: true,
      payments: { select: { id: true, status: true, razorpayPaymentId: true } },
    },
  })
  if (!order) return null
  const from = refundableFrom(order)
  if (!from) throw new NotRefundableError(order.status)

  // Prefer the row carrying a gateway payment id — that is the captured one.
  const payment = order.payments.find((p) => p.razorpayPaymentId) ?? order.payments[0] ?? null

  // ── 2. Claim ───────────────────────────────────────────────────────────────
  // Scoped to `status: not refunded` so exactly one caller can win. A count of
  // 0 means either a concurrent operator won the race or an earlier attempt
  // died between here and step 4 — both are resumed, not refused, because the
  // order is demonstrably still 'paid' and therefore its books are unreversed.
  let claimed = false
  if (payment) {
    const claim = await prisma.payment.updateMany({
      where: { id: payment.id, status: { not: 'refunded' } },
      data: { status: 'refunded' },
    })
    claimed = claim.count === 1
    if (!claimed) {
      console.warn(
        `[refund] ${order.orderNo}: payment already marked refunded while the order is still paid — ` +
          `resuming an interrupted refund rather than starting a new one.`,
      )
    }
  }

  // ── 3. Gateway — no transaction open, bounded, idempotent ──────────────────
  if (payment?.razorpayPaymentId) {
    try {
      const refund = await razorpay.refundPayment(brand, payment.razorpayPaymentId, order.total)
      if (refund.adopted) {
        console.warn(
          `[refund] ${order.orderNo}: adopted existing gateway refund ${refund.id} — ` +
            `a previous attempt had already returned the money.`,
        )
      }
      // Write the gateway's own id down BEFORE the books are reversed, and
      // outside their transaction. This is the only moment it exists: the id
      // used to reach one console.warn and then be discarded, which left an
      // operator holding a disputed refund with nothing to quote at Razorpay.
      // Recorded even on the adopted path — an adopted refund is still the
      // refund that returned this money, and it is the one the dashboard shows.
      await prisma.payment.updateMany({
        where: { id: payment.id },
        data: { razorpayRefundId: refund.id, refundedAt: new Date() },
      })
    } catch (err) {
      // Give the claim back ONLY when the gateway is known not to have acted.
      // A timeout or a 5xx is ambiguous: the refund may well have gone through
      // and the reply been lost, so the claim stays and the operator retries
      // into the adoption path above instead of into a second refund.
      if (claimed && err instanceof razorpay.GatewayNotExecutedError) {
        await prisma.payment.updateMany({
          where: { id: payment.id },
          data: { status: payment.status },
        })
      } else if (claimed) {
        console.error(
          `[refund] ${order.orderNo}: gateway outcome UNKNOWN for payment ${payment.razorpayPaymentId}. ` +
            `The claim is held and the order left 'paid' — retry the refund to converge.`,
          err,
        )
      }
      throw err
    }
  }

  // ── 4. Reverse the books ───────────────────────────────────────────────────
  const outcome = await reverseBooksForRefund(brand, id, from, order.orderNo)

  if (outcome === 'already') {
    console.warn(`[refund] ${order.orderNo}: books were already reversed by a concurrent refund.`)
  }
  return getOrder(brand, id)
}

/**
 * Step 4 of a refund, on its own so the two ways a refund can happen share it.
 *
 * `refundOrder` above is one of them. The other is `recordGatewayRefund`, for a
 * refund somebody issued in the Razorpay dashboard — money that has genuinely
 * left our account and that, before the webhook existed, nothing in this
 * database ever heard about.
 *
 * Everything here is gated by ONE compare-and-swap on the status we came from,
 * which is what makes it exactly-once under a redelivered webhook, a
 * double-clicked button, or both at the same instant. `from` is not merely the
 * expected status: it also decides whether the stock and coupon give-back runs
 * at all — see `RefundableFrom` for why a cancelled order must not get its
 * stock back twice.
 */
async function reverseBooksForRefund(
  brand: Brand,
  id: string,
  from: RefundableFrom,
  orderNo: string,
): Promise<'ok' | 'already'> {
  const prisma = dbFor(brand)
  return prisma.$transaction(async (tx) => {
    // Compare-and-swap on the status we read — the once-only gate for every
    // side effect below, so a concurrent caller that also got past the guard
    // cannot double-restore stock or double-reverse points.
    const claimedOrder = await tx.order.updateMany({
      where: { id, status: from },
      data: { status: 'refunded' },
    })
    if (claimedOrder.count === 0) return 'already'

    const detail = await tx.order.findUnique({
      where: { id },
      select: {
        couponId: true,
        items: { select: { variantId: true, qty: true } },
        points: { select: { userId: true, delta: true } },
      },
    })
    if (!detail) return 'already'

    await tx.payment.updateMany({ where: { orderId: id }, data: { status: 'refunded' } })

    // Stock and the coupon, ONLY when the cancel path has not already given
    // them back. Running these on a cancelled order would invent inventory that
    // does not exist and hand back a coupon use twice.
    if (from === 'paid') {
      if (detail.couponId) {
        await tx.coupon.updateMany({
          where: { id: detail.couponId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        })
      }

      // Give the reserved stock back.
      for (const it of detail.items) {
        await tx.productVariant.update({
          where: { id: it.variantId },
          data: { stock: { increment: it.qty } },
        })
      }
    }

    // Reverse the loyalty award. Summing the ledger rows tied to this order gives
    // exactly what checkout granted (a single positive row: base points + bonus);
    // the compare-and-swap above means no prior refund row can be in this set.
    // Skip when nothing was awarded — a guest order carries no user, and
    // PointsLedger.userId is non-null, so there is no row to reverse against.
    //
    // This one runs for BOTH origins, unlike stock: cancelling an order does not
    // touch the loyalty ledger, so a cancelled-then-refunded customer is still
    // holding points for a purchase that was undone.
    const awarded = detail.points.reduce((sum, p) => sum + p.delta, 0)
    if (awarded > 0) {
      // Every award row shares the customer's id; take it from the row rather
      // than the nullable Order.userId so the reversal lands on the right ledger.
      const userId = detail.points[0].userId
      const prior = await tx.pointsLedger.aggregate({
        where: { userId },
        _sum: { delta: true },
      })
      const balanceAfter = (prior._sum.delta ?? 0) - awarded
      await tx.pointsLedger.create({
        data: {
          userId,
          delta: -awarded,
          reason: `Refund ${orderNo}`,
          orderId: id,
          balanceAfter,
        },
      })
    }

    // Thara: reverse any commission that was accrued for this order, AND give
    // back any Thara credit that was spent on this order (so a refund is whole
    // for the buyer). Both live on the TharaCreditLedger; the helper reads it.
    await reverseTharaCreditForRefund(tx, id)

    // Thara: reverse any reward-points earned for this order (mirror-signed).
    await reverseTharaPointsForRefund(tx, id)

    // The creator's commission, same treatment: a refunded order is not a sale,
    // and the console's Earnings column is what an operator pays out from.
    await reverseOrderCommission(tx, id)

    return 'ok'
  })
}

/**
 * Book a refund that was issued OUTSIDE this console — in the Razorpay
 * dashboard — and that we learn about from a `refund.processed` webhook.
 *
 * ── Why this has to exist ───────────────────────────────────────────────────
 * The money has already gone back. Until this, nothing consumed that event:
 * the order stayed `paid` (or `cancelled`), its `Payment` row stayed
 * `captured`, the customer kept her loyalty points, the creator kept the
 * commission, and every sales figure in the console counted a sale that had
 * been reversed. Nothing looked wrong on any screen — which is the same shape
 * as the missing-cron failures, and the reason the ops notes already tell you
 * to subscribe to `refund.processed`.
 *
 * ── Why it refuses to guess ─────────────────────────────────────────────────
 * It books a reversal from exactly the two states the console's own Refund can
 * act on. A refund taken against a `processing`, `shipped` or `delivered` order
 * is an action this platform has never modelled — whether the stock comes back
 * depends on where the parcel physically is, and no webhook payload knows that.
 * So the payment row is marked refunded (that much is simply true) and the rest
 * is left alone and logged LOUDLY, for a human. Silently restoring stock for a
 * box that is on a van is worse than an alert.
 *
 * Idempotent by the same compare-and-swap as the console path, because Razorpay
 * redelivers an event until it is acknowledged and a partial refund raises one
 * `refund.processed` per refund.
 */
export async function recordGatewayRefund(
  brand: Brand,
  razorpayPaymentId: string,
  /** The gateway's id for the refund itself, and when IT says the money went
   *  back. Both come off the `refund.processed` entity. Optional so a caller
   *  with only a payment id still books the reversal; the trail is then thinner
   *  but the money is still right. */
  refund?: { id?: string; at?: Date },
): Promise<void> {
  const prisma = dbFor(brand)
  const payment = await prisma.payment.findUnique({
    where: { razorpayPaymentId },
    select: { id: true, status: true, order: { select: { id: true, orderNo: true, status: true } } },
  })
  // A refund for a payment this brand's schema has never seen. Both brands'
  // webhooks call this, and each one only knows its own payments, so this is
  // the normal answer on the wrong brand rather than an error.
  if (!payment?.order) return

  const { order } = payment
  if (order.status === 'refunded') return

  // True regardless of what happens to the order below: the gateway has
  // returned this payment. The refund id and timestamp are written on the same
  // pass — this is the one place a DASHBOARD refund's id is ever visible to us,
  // and without it the order would say 'refunded' with nothing to reconcile
  // against. `refundedAt` prefers the gateway's own timestamp over ours: a
  // redelivered webhook can arrive long after the money moved.
  await prisma.payment.updateMany({
    where: { id: payment.id, status: { not: 'refunded' } },
    data: {
      status: 'refunded',
      ...(refund?.id ? { razorpayRefundId: refund.id } : {}),
      refundedAt: refund?.at ?? new Date(),
    },
  })

  // Re-read AFTER the payment write, and put the answer through the same
  // function the console's guard uses rather than re-stating the rule here —
  // the point of the whole change was that this rule existed in two places and
  // the two disagreed.
  const refreshed = await prisma.order.findUnique({
    where: { id: order.id },
    select: { status: true, payments: { select: { status: true } } },
  })
  if (!refreshed) return

  const from = refundableFrom(refreshed)
  if (!from) {
    console.error(
      `[refund] ${order.orderNo}: a gateway refund arrived for an order that is "${refreshed.status}". ` +
        `The payment row is marked refunded; the order status, stock and loyalty are UNCHANGED ` +
        `because whether the goods can come back is not something this event knows. Resolve by hand.`,
    )
    return
  }

  const outcome = await reverseBooksForRefund(brand, order.id, from, order.orderNo)
  if (outcome === 'already') {
    console.warn(
      `[refund] ${order.orderNo}: gateway refund event arrived after the books were already reversed.`,
    )
  }
}

/**
 * Open or close the one-time address correction on a single order.
 *
 * Granting CLEARS `addressEditUsedAt`. That is deliberate and is the only way
 * a second correction is possible: the customer gets one save per grant, and
 * support consciously giving her another is a different thing from her having
 * an open-ended right to edit. Revoking leaves `usedAt` alone, because it is
 * history — whether she already changed the address once stays true after the
 * window is shut.
 *
 * `grantedBy` records which admin opened it. It is the admin's email as free
 * text, not a relation: admin identity lives in the `platform` schema, which a
 * brand's Prisma client cannot reach, so a foreign key is not expressible.
 *
 * ── Granting also TELLS her ─────────────────────────────────────────────────
 * The control renders on the customer's own order page, behind a sign-in, on a
 * page she has no reason to open again after paying. So a grant on its own was
 * an act with no observable effect: the window opened, she never learned it
 * had, and the parcel stayed unshippable until somebody phoned her. The send
 * runs OUTSIDE the update and never throws — a Meta outage or an unverified
 * mail identity must not undo a grant that is already written, nor turn the
 * click into a 500 that has an operator re-clicking a button that worked.
 *
 * `notified` therefore comes back with the grant, and its `unreachable` flag is
 * the one an operator must act on: a customer with no email and no phone on
 * file exists, and for her the only remaining channel is the telephone. It is
 * null on a revoke, and also when there was nothing to tell her about — see
 * `sendAddressChangeRequest` for the cases, of which a GUEST order (no user
 * row, so no session can ever own it) is the one that surprises people.
 *
 * Returns null when no such order exists, so the route answers 404 rather than
 * reporting success for an order it never touched.
 */
export async function setOrderAddressEditGrant(
  brand: Brand,
  id: string,
  granted: boolean,
  grantedBy: string,
): Promise<{
  orderNo: string
  grantedAt: Date | null
  usedAt: Date | null
  notified: AddressChangeNotifyResult | null
} | null> {
  const prisma = dbFor(brand)
  let updated
  try {
    updated = await prisma.order.update({
      where: { id },
      data: granted
        ? { addressEditGrantedAt: new Date(), addressEditGrantedBy: grantedBy, addressEditUsedAt: null }
        : { addressEditGrantedAt: null, addressEditGrantedBy: null },
      select: { orderNo: true, addressEditGrantedAt: true, addressEditUsedAt: true },
    })
  } catch {
    // Prisma throws P2025 for a missing row; the caller only needs "not found".
    return null
  }

  // Only on the way OPEN. A revoke has nothing to announce, and "you may no
  // longer change your address" is a message that invites the call it would be
  // sent to prevent.
  const notified = granted ? await sendAddressChangeRequest(brand, updated.orderNo) : null

  return {
    orderNo: updated.orderNo,
    grantedAt: updated.addressEditGrantedAt,
    usedAt: updated.addressEditUsedAt,
    notified,
  }
}
