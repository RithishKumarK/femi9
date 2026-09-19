import 'server-only'
import { orderPrefix } from '../brands'
import { cookies } from 'next/headers'
import { dbFor, type Brand } from '@femi9/db'
import { logger } from '../logger'
import { PAID_ORDER_STATUSES } from '../order-status'
import { IdentityConflictError, attachIdentity } from './auth'
import { sendOrderStatusEmail } from './order-mail'
import { sendOrderStatusWhatsapp } from './order-whatsapp'
import { getSettings } from './settings'
import { refCookieName, attributeOrder, bookOrderCommission } from './affiliate'
import { applyZonePrice, resolveZone } from './pricing'
import * as razorpay from '../razorpay'
import {
  activateAndLockIfEligible,
  applyTharaCredit,
  accrueTharaCommission,
  accrueTharaPoints,
  computeTharaDiscount,
} from './thara'
import type { OrderStatus } from '@prisma/client'

/**
 * Checkout service — turns a server-backed guest cart into a real Order, then
 * opens a Razorpay payment order against it.
 *
 * The order is written in status 'pending' (awaiting payment) and only flips to
 * 'paid' once payment is verified — either synchronously via /api/payments/verify
 * or asynchronously via the Razorpay webhook (see markOrderPaid). Everything
 * money-related (line prices, subtotal, shipping, the amount charged) is
 * RECOMPUTED here from ProductVariant.price — the client payload is only ever
 * trusted for who/where to ship, never for what to charge.
 */

// Flat courier fee below the free-shipping threshold, for a basket `shippingFor`
// cannot weigh — a brand whose variants carry no `weightKg` (Femi9's pads, or a
// Lumi9 row seeded before the column existed). The threshold itself is editable
// via Settings.
export const SHIPPING_FEE = 49

/**
 * Courier weight-slab rate card — what a diaper parcel costs to ship, by its
 * OWN weight rather than a flat per-order fee. Sourced from the courier's rate
 * card (Sept 2026): up to 0.5kg / 1kg / 2kg / 3kg. A basket heavier than the
 * top slab is still charged the top slab's fee — the rate card gives us no
 * per-kg rate past 3kg, and guessing one would be inventing a charge, not
 * reading one off a document.
 */
const SHIPPING_WEIGHT_SLABS: readonly { upToKg: number; fee: number }[] = [
  { upToKg: 0.5, fee: 30 },
  { upToKg: 1, fee: 50 },
  { upToKg: 2, fee: 70 },
  { upToKg: 3, fee: 100 },
]

/** The slab fee for a basket weighing `totalWeightKg` in total. */
export function shippingForWeight(totalWeightKg: number): number {
  const slab = SHIPPING_WEIGHT_SLABS.find((s) => totalWeightKg <= s.upToKg)
  return (slab ?? SHIPPING_WEIGHT_SLABS[SHIPPING_WEIGHT_SLABS.length - 1]!).fee
}

/**
 * What this brand charges to deliver a `subtotal`-worth, `totalWeightKg`-heavy
 * basket.
 *
 * Exported because "kept in sync with the storefront's cart hint" is not a
 * mechanism, and both storefronts proved it: each carried its own copy of the
 * fee and the threshold, so a console change to `freeShipThreshold` moved what
 * the shopper was CHARGED without moving what she was SHOWN. Lumi9 went further
 * and offered an "Express delivery ₹79" the server had never heard of — the
 * summary added it to the total, and the Razorpay order was opened for the
 * standard amount.
 *
 * One function, called by `placeOrder` and by the quote endpoint the checkout
 * summary reads. A shipping rule that can be shown and charged from two
 * different expressions will eventually show and charge two different numbers.
 *
 * `totalWeightKg` is null for a basket that cannot be weighed — see the field's
 * own doc comment on `CartDTO` — and the flat `SHIPPING_FEE` is what a Lumi9
 * shopper was charged before this existed, so it stays the honest fallback
 * rather than pricing an unweighed basket at the lightest (or heaviest) slab.
 */
export function shippingFor(
  subtotal: number,
  freeShipThreshold: number,
  totalWeightKg: number | null,
): number {
  if (subtotal >= freeShipThreshold) return 0
  return totalWeightKg !== null ? shippingForWeight(totalWeightKg) : SHIPPING_FEE
}

/**
 * Is this coupon usable right now, and what is it worth on `subtotal`?
 *
 * Read-only — it never increments `usedCount`. `placeOrder` re-checks every one
 * of these conditions inside its transaction AND claims the use with a
 * compare-and-set, because two shoppers can quote the last remaining use of the
 * same code at the same moment. This is what the shopper is SHOWN; that is what
 * she is CHARGED, and the two are separate on purpose.
 *
 * `userId` is the signed-in shopper, or null for a guest. A coupon minted by
 * redeeming Bloom points carries the id of whoever paid for it, so a guest must
 * not be told a `BLOOM-` code they overheard is worth anything.
 */
export function couponDiscountFor(
  coupon: {
    active: boolean
    expiresAt: Date | null
    minOrder: number
    maxUses: number | null
    usedCount: number
    userId: string | null
    type: string
    value: number
  } | null,
  subtotal: number,
  userId: string | null,
): number | null {
  if (!coupon) return null
  if (!coupon.active) return null
  if (coupon.expiresAt !== null && coupon.expiresAt <= new Date()) return null
  if (subtotal < coupon.minOrder) return null
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return null
  if (coupon.userId !== null && coupon.userId !== userId) return null

  const raw =
    coupon.type === 'pct'
      ? Math.round((subtotal * Math.min(100, coupon.value)) / 100)
      : coupon.value
  return Math.min(subtotal, Math.max(0, raw))
}

/** What the checkout summary renders, computed the way the order will be. */
export interface CheckoutQuote {
  subtotal: number
  /** Coupon value applied to this basket. 0 when no code, or none that applies. */
  discount: number
  shipping: number
  freeShipThreshold: number
  total: number
  /** The code that produced `discount`, echoed back so the UI can show it. */
  couponCode: string | null
  /** Set when a code WAS supplied and does not apply, so the form can say why. */
  couponError: string | null
}

/**
 * Price the current cart exactly as `placeOrder` would, without placing it.
 *
 * Read-only and side-effect free: no order row, no stock decrement, no gateway
 * call. It exists so the summary beside the checkout form can stop guessing.
 * Coupons are NOT applied here — a code is validated at placement, where the
 * failure has somewhere to go; quoting a discount that placement then refuses
 * would reintroduce the same class of lie in a new place.
 */
/**
 * Cookie holding the coupon code a shopper has applied to her current basket.
 *
 * Per brand, like the session and referral cookies, and for the same reason:
 * the two storefronts share a hostname in development and in the E2E suites,
 * where cookies ignore the port. A Lumi9 code carried into a Femi9 quote would
 * resolve against the wrong schema and come back refused — harmless, but it
 * would also silently drop whatever Femi9 coupon was actually applied.
 *
 * ── Why this is a cookie and not client storage ─────────────────────────────
 * The provider's own note used to say the coupon was deliberately NOT persisted,
 * because "a stale one restored from storage on a later visit would put a
 * discount on screen that placement then refuses". That objection is right, and
 * it is an objection to restoring a PRICE, not to remembering a CODE.
 *
 * What is stored here is the code alone. Every quote re-asks the server what it
 * is worth against this basket and this shopper, so an expired, spent or
 * deactivated code comes back as `couponCode: null` with a `couponError`,
 * exactly as if she had just typed it. Nothing stale is ever shown as money.
 *
 * Not persisting it at all was the worse failure: the code lived only in React
 * state in a provider mounted in the root layout, so it survived a soft
 * navigation and was lost on any hard one — a refresh of /checkout, a second
 * tab, a return from an external redirect. The shopper then saw a higher total
 * than the one she had agreed to, and because the checkout form submits the
 * quote's `couponCode`, the order was PLACED at full price.
 */
export function couponCookieName(brand: Brand): string {
  return `${brand}_coupon`
}

/** 7 days: long enough to survive a shopper coming back to an abandoned bag,
 *  short enough that a code she has forgotten about does not resurface. */
export const COUPON_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

export async function quoteCart(
  brand: Brand,
  token: string | null,
  options: { couponCode?: string; userId?: string } = {},
): Promise<CheckoutQuote> {
  const { freeShipThreshold } = await getSettings(brand)
  const empty: CheckoutQuote = {
    subtotal: 0,
    discount: 0,
    shipping: 0,
    freeShipThreshold,
    total: 0,
    couponCode: null,
    couponError: null,
  }
  if (!token) return empty

  // Dynamic import: ./cart imports this module for its own types, and a static
  // import here would close the cycle at module-init time.
  //
  // No `zone` argument, so getCart resolves the AMBIENT zone from the request
  // headers — the same zone the cart page already shows. Placement re-resolves
  // from the typed state/pincode, so a shopper whose address lands in a
  // different zone than her IP suggests can still see the total move once she
  // fills the form. That is the pre-existing behaviour of every price on the
  // site, not something this quote introduces; what it removes is a shipping
  // line the server had never agreed to.
  const { getCart } = await import('./cart')
  const cart = await getCart(brand, token)
  if (cart.items.length === 0) return empty

  const shipping = shippingFor(cart.subtotal, freeShipThreshold, cart.totalWeightKg)

  let discount = 0
  let couponCode: string | null = null
  let couponError: string | null = null
  const code = options.couponCode?.trim().toUpperCase()
  if (code) {
    const coupon = await dbFor(brand).coupon.findUnique({ where: { code } })
    const value = couponDiscountFor(coupon, cart.subtotal, options.userId ?? null)
    if (value === null) {
      // ONE message for every reason a code does not apply — expired, spent,
      // below its minimum, or somebody else's. Saying which would let a caller
      // probe the coupon table by trying codes and reading the difference.
      couponError = 'That code is invalid, expired, or no longer available.'
    } else {
      discount = value
      couponCode = code
    }
  }

  return {
    subtotal: cart.subtotal,
    discount,
    shipping,
    freeShipThreshold,
    total: Math.max(0, cart.subtotal - discount) + shipping,
    couponCode,
    couponError,
  }
}

/** No cart / empty cart at checkout time. Route layer maps this to a 400. */
export class EmptyCartError extends Error {
  constructor() {
    super('Your bag is empty.')
    this.name = 'EmptyCartError'
  }
}

/** A line whose quantity now exceeds available stock. Route maps this to a 409
 *  so the shopper sees exactly which item to adjust rather than a generic 500. */
export class OutOfStockError extends Error {
  constructor(itemName: string) {
    super(`Sorry, "${itemName}" just went out of stock. Please reduce the quantity or remove it to continue.`)
    this.name = 'OutOfStockError'
  }
}

export class InvalidCouponError extends Error {
  constructor(message = 'That coupon is invalid, expired, or no longer available.') {
    super(message)
    this.name = 'InvalidCouponError'
  }
}

/** The order number in a payment callback doesn't resolve to any order. Route
 *  maps this to a 400 (bad reference) rather than surfacing a 500. */
export class OrderNotFoundError extends Error {
  constructor(orderNo: string) {
    super(`Order ${orderNo} not found.`)
    this.name = 'OrderNotFoundError'
  }
}

/** A capture arrived for an order that has no matching payment-intent row. We
 *  never fabricate one (that would mark an order paid with no money behind it),
 *  so the caller must reject. Route maps this to a 400. */
export class PaymentIntentMissingError extends Error {
  constructor(orderNo: string) {
    super(`No matching payment found for order ${orderNo}.`)
    this.name = 'PaymentIntentMissingError'
  }
}

/** The captured payment's amount doesn't equal the order total we charged. A
 *  tampered/mismatched capture — never mark such an order paid. Route → 400. */
export class PaymentAmountMismatchError extends Error {
  constructor(orderNo: string) {
    super(`Payment amount does not match order ${orderNo}.`)
    this.name = 'PaymentAmountMismatchError'
  }
}

export class OrderNotPayableError extends Error {
  constructor(orderNo: string) {
    super(`Order ${orderNo} is not awaiting payment.`)
    this.name = 'OrderNotPayableError'
  }
}

/**
 * The basket came to ₹0, and there is no way to take a payment for that.
 *
 * ── Why this is an error and not a free order ───────────────────────────────
 * Razorpay's minimum is ₹1: an Orders API call for 0 paise is refused. Before
 * this guard the refusal happened LATE — after the order row was written, the
 * stock reserved and (on Femi9) store credit already debited — and it surfaced
 * to the shopper as an opaque gateway failure at the last step of checkout,
 * with no indication that her discount code was the cause. The compensation
 * path then deleted the order, so nobody could see afterwards that it had
 * happened either.
 *
 * Reaching ₹0 is easy and does not need anything exotic: `couponDiscountFor`
 * permits a percent coupon of exactly 100 (the admin schema allows it), a flat
 * coupon is capped only at the subtotal, and `shippingFor` reads the
 * PRE-discount subtotal — so a fully-discounted basket that clears the
 * free-shipping threshold has nothing left to charge.
 *
 * Refusing early, before a single side effect, is the honest version of what
 * already happened. It is NOT a free-order flow: giving away an order for
 * nothing needs a settled-without-payment path that this platform does not
 * have — `markOrderPaid` requires a payment intent, and the receipt and
 * confirmation both assume a capture. See
 * `apps/femi9-web/docs/money-flow-audit.md` §3.1 for what building that would
 * involve, and §2.2 for the one route to ₹0 that is still open (store credit,
 * Femi9 only).
 */
export class ZeroTotalOrderError extends Error {
  constructor() {
    super(
      'This basket comes to ₹0, and we can only take payments of ₹1 or more. ' +
        'Please remove the discount code or add an item — and do get in touch if ' +
        'you were expecting this order to be free.',
    )
    this.name = 'ZeroTotalOrderError'
  }
}

/** Shipping/customer details captured on the checkout form. */
export interface CheckoutCustomer {
  name: string
  phone: string
  email?: string
  line: string
  city: string
  state?: string
  pincode?: string
  couponCode?: string
  /** The shopper's own name for this address ("Home" / "Work" / free text).
   *  Every address used to be stamped 'Home' regardless. */
  addressLabel?: string
}

/** The payment intent the client needs to open the Razorpay Checkout widget
 *  (or, in mock mode, to POST the dev "mark paid" call). `configured` tells the
 *  UI which flow to run; `keyId` is empty unless a real publishable key is set. */
export interface PaymentIntent {
  razorpayOrderId: string
  amount: number // rupees (matches Order.total)
  keyId: string
  configured: boolean
}

export interface PlaceOrderResult {
  orderNo: string
  payment: PaymentIntent
}

/**
 * Re-open the existing Razorpay intent for a pending order. Checkout already
 * persisted this intent before consuming the cart, so a shopper who dismissed
 * the gateway can safely retry without creating a second order or reserving
 * stock again.
 */
export async function pendingPaymentIntent(brand: Brand, orderNo: string): Promise<PaymentIntent> {
  const prisma = dbFor(brand)
  const order = await prisma.order.findUnique({
    where: { orderNo },
    select: {
      status: true,
      total: true,
      payments: {
        where: { status: 'created' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { razorpayOrderId: true, amount: true },
      },
    },
  })
  if (!order) throw new OrderNotFoundError(orderNo)
  if (order.status !== 'pending') throw new OrderNotPayableError(orderNo)

  const payment = order.payments[0]
  if (!payment?.razorpayOrderId) throw new PaymentIntentMissingError(orderNo)
  if (payment.amount !== order.total) throw new PaymentAmountMismatchError(orderNo)

  return {
    razorpayOrderId: payment.razorpayOrderId,
    amount: order.total,
    keyId: razorpay.publicKeyId(brand),
    configured: razorpay.isConfigured(brand),
  }
}

/** True only for a P2002 unique-constraint violation on Order.orderNo, so the
 *  caller can retry orderNo allocation without masking other unique collisions. */
function isOrderNoUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; meta?: { target?: unknown } }
  if (e.code !== 'P2002') return false
  const target = e.meta?.target
  const fields = Array.isArray(target)
    ? target.map((t) => String(t))
    : typeof target === 'string'
      ? [target]
      : []
  return fields.some((f) => f.toLowerCase().includes('orderno'))
}

/**
 * Place an order for the guest identified by `token`, then open a Razorpay
 * payment order against it.
 *
 * The price/stock recompute, customer upsert, order write and stock decrement
 * run inside a single transaction so a mid-flight failure can never leave a
 * half-created order or a double-decremented variant. The cart remains intact
 * until the gateway intent has also been persisted. The gateway network call
 * happens outside a DB transaction; if it fails, a compensating transaction
 * restores stock and removes the pending order while preserving the shopper's
 * cart for a retry.
 */
export async function placeOrder(brand: Brand, 
  token: string,
  customer: CheckoutCustomer,
  sessionUserId?: string,
): Promise<PlaceOrderResult> {
  const prisma = dbFor(brand)
  // Settings are a read of business config, not part of the atomic order write —
  // fetch them before opening the transaction to keep it short. (Loyalty points
  // are no longer awarded here; they are granted on capture in markOrderPaid.)
  const { freeShipThreshold } = await getSettings(brand)
  const zone = await resolveZone(brand, { state: customer.state, pincode: customer.pincode })

  // Referral attribution rides in an httpOnly cookie dropped by /a/[code]. Read
  // it here (request scope) so the transaction can stamp the order's affiliate.
  // Brand-scoped: this order is being placed for ONE brand and may only ever be
  // attributed to that brand's creators, so it reads that brand's cookie and no
  // other. `attributeOrder` then resolves the code against the same brand's
  // schema, which is where the isolation is actually enforced.
  const refCode = (await cookies()).get(refCookieName(brand))?.value?.trim() || undefined

  // Never persist an empty email; it would clash with the User.email @unique
  // index (many guests, no email) and blank a returning customer's real email.
  const email = customer.email?.trim() || undefined

  // Concurrent checkouts can compute the same next orderNo and collide on the
  // @unique index. Retry the whole transaction a few times on THAT specific
  // P2002 so the number is re-allocated instead of surfacing a 500.
  const MAX_ORDERNO_ATTEMPTS = 5
  let placed: { orderId: string; orderNo: string; total: number; cartId: string } | undefined
  for (let attempt = 1; attempt <= MAX_ORDERNO_ATTEMPTS; attempt++) {
   try {
    placed = await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { guestToken: token },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: { variant: { include: { product: { select: { name: true } } } } },
        },
      },
    })
    if (!cart || cart.items.length === 0) throw new EmptyCartError()

    // Re-read within the transaction: current price + current stock. Snapshot
    // the line fields as we go so the OrderItem records survive later catalog edits.
    let subtotal = 0
    const lines = cart.items.map((item) => {
      const { variant } = item
      // Stock is NOT checked here — a read-then-decrement would race two
      // concurrent checkouts into overselling. The reservation below is a
      // conditional atomic decrement that is the sole guard against oversell.
      // Keyed by variant so the zone's custom price (when the admin set one for
      // this variant) is what is charged — the same number the cart showed.
      const unitPrice = applyZonePrice(variant.price, zone, { variantId: variant.id })
      const lineTotal = unitPrice * item.qty
      subtotal += lineTotal
      return {
        variantId: variant.id,
        productName: variant.product.name,
        variantLabel: variant.label,
        unitPrice,
        qty: item.qty,
        lineTotal,
      }
    })

    // Same "every line or none" rule as `getCart`'s `totalWeightKg` — a basket
    // mixing a weighed and an unweighed variant has no honest total to slab.
    const everyLineWeighed = cart.items.every((item) => item.variant.weightKg !== null)
    const totalWeightKg = everyLineWeighed
      ? cart.items.reduce((sum, item) => sum + (item.variant.weightKg ?? 0) * item.qty, 0)
      : null
    const shipping = shippingFor(subtotal, freeShipThreshold, totalWeightKg)

    // ── WHO IS BUYING ────────────────────────────────────────────────────────
    // A signed-in shopper's order belongs to HER session row, full stop. This
    // used to identify the buyer purely by the phone typed into the form, so a
    // magic-link or Google customer (phone null) minted a SECOND User row on
    // every order and her /account order history, spend chart and points ledger
    // stayed empty forever no matter how much she bought.
    //
    // We also stopped blind-writing the second identity column. The old
    // `emailFree` guard compared `phone: { not: <string> }` against a NULL
    // phone, so depending on how Prisma emits that it either tripped the
    // User.email unique index (500 on a paid-intent checkout) or silently
    // discarded the email. attachIdentity checks ownership first and refuses a
    // value that belongs to someone else, so neither branch can happen.
    let user: { id: string }
    if (sessionUserId) {
      const existing = await tx.user.findUnique({
        where: { id: sessionUserId },
        select: { id: true, name: true, email: true, phone: true },
      })
      if (!existing) throw new Error('Signed-in user no longer exists.')
      user = { id: existing.id }

      // Backfill ONLY the gaps. A stored name/phone/email is the verified truth;
      // a checkout form is not a place to overwrite it.
      if (!existing.name?.trim()) {
        await tx.user.update({ where: { id: user.id }, data: { name: customer.name } })
      }
      // A phone typed at checkout is unverified, so it is only ever written when
      // the account has none at all — and never over a verified one.
      const gaps: { email?: string; phone?: string } = {}
      if (!existing.email && email) gaps.email = email
      if (!existing.phone) gaps.phone = customer.phone
      if (Object.keys(gaps).length > 0) {
        try {
          await attachIdentity(tx, user.id, gaps)
        } catch (err) {
          // Someone else already owns that email or number. That is a real
          // account-merge question and a payment flow is the worst possible
          // place to answer it — the order still belongs to the session user.
          if (!(err instanceof IdentityConflictError)) throw err
        }
      }
    } else {
      // Genuine guest: the phone is the only identity we have, so it keys a
      // durable customer record that a repeat buyer will reuse.
      const byPhone = await tx.user.findUnique({
        where: { phone: customer.phone },
        select: { id: true, email: true },
      })
      if (byPhone) {
        user = { id: byPhone.id }
        await tx.user.update({ where: { id: user.id }, data: { name: customer.name } })
        if (!byPhone.email && email) {
          try {
            await attachIdentity(tx, user.id, { email })
          } catch (err) {
            if (!(err instanceof IdentityConflictError)) throw err
          }
        }
      } else {
        // A brand-new guest row. The email is only claimed when free; a
        // collision means it belongs to a returning customer who did not sign
        // in, and we must not steal it onto this new row.
        const emailOwner = email
          ? await tx.user.findUnique({ where: { email }, select: { id: true } })
          : null
        user = await tx.user.create({
          data: {
            phone: customer.phone,
            name: customer.name,
            role: 'customer',
            ...(email && !emailOwner ? { email } : {}),
          },
          select: { id: true },
        })
      }
    }

    // Thara personal discount — applies to the buyer's own orders when they are
    // an active member and the cart clears ₹3,000. Zero when the flag is off,
    // the user isn't a member, or the member is not yet active.
    const tharaDiscount = await computeTharaDiscount(tx, user.id, subtotal)
    let discount = tharaDiscount.discountPaise
    let couponId: string | undefined
    const couponCode = customer.couponCode?.trim().toUpperCase()
    if (couponCode) {
      const coupon = await tx.coupon.findUnique({ where: { code: couponCode } })
      // The same predicate the quote endpoint shows the shopper — active, in
      // date, over its minimum, uses remaining, and HERS (a coupon minted by
      // redeeming Bloom points carries the id of whoever paid for it; without
      // that check anyone who learned a BLOOM- code could spend someone else's
      // single use, while a null userId is a public campaign code open to all).
      //
      // Evaluated here again rather than trusted from the quote, because the
      // quote ran outside this transaction and the last remaining use may have
      // gone to somebody else in between. The compare-and-set below is what
      // actually settles that race; this only decides whether to attempt it.
      const couponDiscount = couponDiscountFor(coupon, subtotal, user.id)
      if (!coupon || couponDiscount === null) throw new InvalidCouponError()

      const claimed = await tx.coupon.updateMany({
        // Ownership is re-asserted in the claim itself so the check above cannot
        // be raced by a concurrent checkout on the same code.
        where: {
          id: coupon.id,
          usedCount: coupon.usedCount,
          active: true,
          OR: [{ userId: null }, { userId: user.id }],
        },
        data: { usedCount: { increment: 1 } },
      })
      if (claimed.count !== 1) throw new InvalidCouponError()
      couponId = coupon.id
      // Capped at what is LEFT after any Thara credit, so two discounts on one
      // basket can never take the subtotal below zero.
      const remainingSubtotal = Math.max(0, subtotal - discount)
      discount += Math.min(remainingSubtotal, couponDiscount)
    }
    let total = Math.max(0, subtotal - discount + shipping)

    // Refuse a ₹0 basket HERE, which is the last moment nothing has to be undone.
    //
    // Everything below this line commits something: the order row, the stock
    // decrement, and on Femi9 the store-credit debit. The coupon's usedCount was
    // already incremented above, but that is inside this transaction and rolls
    // back with the throw — which is exactly why the guard sits at this line and
    // not after the order is created. See ZeroTotalOrderError.
    if (total <= 0) throw new ZeroTotalOrderError()

    // Reuse an address the customer already has rather than minting a new row on
    // every order. Three orders to the same flat used to leave three identical
    // "Home" cards in her address book, all of them undeletable because each was
    // referenced by an order.
    const label = customer.addressLabel?.trim().slice(0, 40) || 'Home'
    const existingAddress = await tx.address.findFirst({
      where: {
        userId: user.id,
        archivedAt: null,
        line: customer.line,
        city: customer.city,
        pincode: customer.pincode ?? null,
        phone: customer.phone,
      },
      select: { id: true },
    })
    // First address for a user is their primary; later ones are added alongside.
    const addressCount = await tx.address.count({ where: { userId: user.id, archivedAt: null } })
    const address =
      existingAddress ??
      (await tx.address.create({
        data: {
          userId: user.id,
          label,
          name: customer.name,
          line: customer.line,
          city: customer.city,
          state: customer.state ?? null,
          pincode: customer.pincode ?? null,
          phone: customer.phone,
          isPrimary: addressCount === 0,
        },
        select: { id: true },
      }))

    // Human-friendly, sequential order number continuing past the current max.
    // Zero-padded to a fixed width so lexical desc ordering == numeric ordering.
    //
    // The prefix is the BRAND's. It is customer-facing — read back to support,
    // quoted in email — so a Lumi9 order must not arrive numbered FM-. The two
    // sequences are independent anyway, living in different schemas, and the
    // `startsWith` below is what keeps each counting its own.
    const prefix = orderPrefix(brand) + '-'
    const last = await tx.order.findFirst({
      where: { orderNo: { startsWith: prefix } },
      orderBy: { orderNo: 'desc' },
      select: { orderNo: true },
    })
    const lastNum = last ? Number.parseInt(last.orderNo.slice(prefix.length), 10) : 0
    const nextNum = (Number.isFinite(lastNum) ? lastNum : 0) + 1
    const orderNo = prefix + String(nextNum).padStart(5, '0')

    const order = await tx.order.create({
      data: {
        orderNo,
        userId: user.id,
        addressId: address.id,
        couponId,
        status: 'pending', // awaiting payment — Razorpay capture comes later
        channel: 'web',
        subtotal,
        discount,
        shipping,
        total,
        items: {
          create: lines.map((l) => ({
            variantId: l.variantId,
            productName: l.productName,
            variantLabel: l.variantLabel,
            unitPrice: l.unitPrice,
            qty: l.qty,
            lineTotal: l.lineTotal,
          })),
        },
      },
      select: { id: true, orderNo: true },
    })

    // Thara wallet — apply available store credit to the buyer's own bill, up
    // to whatever total is left after the personal-discount slab. Ledger debit
    // and the order's discount/total are updated in the same tx.
    const creditApplied = await applyTharaCredit(tx, user.id, order.id, total)
    if (creditApplied > 0) {
      discount = discount + creditApplied
      total = Math.max(0, total - creditApplied)
      await tx.order.update({
        where: { id: order.id },
        data: { discount, total },
      })
    }

    // Reserve stock atomically. Each line is a CONDITIONAL decrement that only
    // succeeds while enough stock remains (WHERE stock >= qty), so two concurrent
    // checkouts can never both drive the same variant negative. A count of 0 means
    // the guard failed → out of stock, and the transaction rolls back.
    for (const l of lines) {
      const res = await tx.productVariant.updateMany({
        where: { id: l.variantId, stock: { gte: l.qty } },
        data: { stock: { decrement: l.qty } },
      })
      if (res.count === 0) throw new OutOfStockError(`${l.productName} - ${l.variantLabel}`)
    }

    // ── LOYALTY ──────────────────────────────────────────────────────────────
    // Points are NOT awarded here. The order is only 'pending' at this point; the
    // Bloom points award now lives in markOrderPaid so it's granted exactly once,
    // when (and only when) the order actually becomes 'paid'.

    // ── AFFILIATE ────────────────────────────────────────────────────────────
    // ATTRIBUTION only — who referred this order. The commission itself is a
    // payable and is booked in markOrderPaid, for exactly the reason stated
    // three lines above about Bloom points: this order is still 'pending' and
    // may never be paid at all. See `bookOrderCommission`.
    if (refCode) {
      const affiliateId = await attributeOrder(brand, refCode, tx)
      if (affiliateId) {
        await tx.order.update({ where: { id: order.id }, data: { affiliateId } })
      }
    }

    // Do NOT consume the cart yet. The gateway order is opened after this
    // transaction; keeping the cart until that succeeds means a gateway outage
    // does not erase the shopper's bag.
    return { orderId: order.id, orderNo: order.orderNo, total, cartId: cart.id }
    })
    break
   } catch (err) {
    // Re-allocate only on the orderNo unique collision; any other P2002 is a
    // real error and must surface.
    if (isOrderNoUniqueViolation(err) && attempt < MAX_ORDERNO_ATTEMPTS) continue
    throw err
   }
  }
  if (!placed) throw new Error('Could not allocate an order number. Please try again.')
  const { orderId, orderNo, total, cartId } = placed

  let gatewayOrder: Awaited<ReturnType<typeof razorpay.createOrder>>
  try {
    // Open the gateway order for the exact server-computed total, using our
    // orderNo as the receipt so callbacks can tie it back to our order.
    gatewayOrder = await razorpay.createOrder(brand, { amountRupees: total, receipt: orderNo })

    // Persist the payment intent and consume the cart atomically. If either
    // write fails, the transaction rolls back and the compensation below
    // restores the reserved stock/order.
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId,
          provider: 'razorpay',
          razorpayOrderId: gatewayOrder.id,
          amount: total,
          status: 'created',
        },
      })
      await tx.cartItem.deleteMany({ where: { cartId } })
      await tx.cart.deleteMany({ where: { id: cartId } })
    })
  } catch (gatewayError) {
    // Compensate the already-committed reservation. The cart was deliberately
    // left untouched, so the shopper can retry once the gateway is available.
    try {
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { items: { select: { variantId: true, qty: true } } },
        })
        if (!order) return
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.qty } },
          })
        }
        if (order.couponId) {
          await tx.coupon.updateMany({
            where: { id: order.couponId, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } },
          })
        }
        await tx.order.delete({ where: { id: orderId } })
      })
    } catch (compensationError) {
      const combined = new Error(
        `Gateway setup failed for ${orderNo}, and checkout compensation also failed.`,
      )
      Object.assign(combined, { gatewayError, compensationError })
      throw combined
    }
    throw gatewayError
  }

  return {
    orderNo,
    payment: {
      razorpayOrderId: gatewayOrder.id,
      amount: total,
      keyId: razorpay.publicKeyId(brand),
      configured: razorpay.isConfigured(brand),
    },
  }
}

/**
 * Mark an order paid from a verified payment signal (sync verify OR webhook).
 *
 * Idempotent by design — a re-delivered webhook, a client double-submit, or the
 * verify call racing the webhook must all converge on a single 'paid' order with
 * one captured Payment row:
 *  - If the order is already 'paid', return ok WITHOUT writing anything again.
 *  - Otherwise require the PRE-EXISTING payment-intent row for this order (and,
 *    when supplied, its gateway order id) and confirm its amount equals the order
 *    total — we never fabricate a Payment (that would mark an order paid with no
 *    money behind it). Then flip that row to 'captured' (stamping the @unique
 *    razorpayPaymentId — the DB is the final backstop against a duplicate
 *    capture), set the order to 'paid', and award loyalty points, all in one
 *    transaction. Points are granted here (on capture) exactly once.
 */
export async function markOrderPaid(brand: Brand, {
  orderNo,
  razorpayPaymentId,
  razorpayOrderId,
  signatureVerified,
  method,
  capturedAmountPaise,
}: {
  orderNo: string
  razorpayPaymentId: string
  razorpayOrderId?: string
  signatureVerified: boolean
  method?: string
  /**
   * What the GATEWAY says it actually captured, in paise.
   *
   * Everything else this function checks is our own data: `payment.amount` was
   * written by our checkout and compared against our own `order.total`, which
   * catches a stale intent but cannot catch a short capture. Nothing verified
   * that the money Razorpay took matched the money we asked for.
   *
   * That gap is currently covered by Razorpay's own invariant — a payment
   * against an Order must settle it in full — but that is an ACCOUNT SETTING
   * (partial payments), not something this code enforces, and it is not ours to
   * assume stays off. The webhook has the number and simply was not passing it.
   *
   * Optional because the synchronous verify path genuinely does not have it:
   * Razorpay Checkout hands the browser an order id, a payment id and a
   * signature, and no amount. The webhook always fires, so the check always
   * runs eventually — and an order marked paid by the sync path is re-examined
   * when the webhook lands, where a mismatch surfaces rather than being lost.
   */
  capturedAmountPaise?: number
}): Promise<{ ok: true; status: 'paid'; alreadyPaid: boolean }> {
  const prisma = dbFor(brand)
  // Loyalty rate/bonus for the on-capture award. A plain config read — kept
  // outside the transaction to keep it short.
  const { pointsPerRupee, firstOrderBonusPoints } = await getSettings(brand)

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNo },
      select: { id: true, status: true, total: true, userId: true },
    })
    if (!order) throw new OrderNotFoundError(orderNo)

    // Idempotency gate: already-paid orders short-circuit so re-delivery / retries
    // never double-write (points, capture, etc. stay single-shot).
    if (order.status === 'paid') {
      return { ok: true as const, status: 'paid' as const, alreadyPaid: true }
    }

    // Require the checkout payment-intent row for THIS order (matched on the
    // gateway order id when the caller has one). No row → refuse to mark paid;
    // we never invent a captured Payment out of nothing.
    const payment = await tx.payment.findFirst({
      where: { orderId: order.id, ...(razorpayOrderId ? { razorpayOrderId } : {}) },
      orderBy: { createdAt: 'desc' },
    })
    if (!payment) throw new PaymentIntentMissingError(orderNo)

    // The intent must have been opened for exactly what we charged; a mismatch is
    // a tampered/stale capture and must not flip the order to paid.
    if (payment.amount !== order.total) throw new PaymentAmountMismatchError(orderNo)

    // And the GATEWAY must have taken that same amount. Rounded to whole rupees
    // because that is the unit every total on this platform is stored in, and
    // the gateway speaks paise. Only checked when the caller has the number —
    // see the note on capturedAmountPaise.
    if (capturedAmountPaise != null && Math.round(capturedAmountPaise / 100) !== order.total) {
      throw new PaymentAmountMismatchError(orderNo)
    }

    // Claim the pending order with a compare-and-set BEFORE updating the payment
    // or points. Sync verification and the webhook can arrive concurrently; the
    // row-level update lets exactly one transaction perform capture side effects.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'paid' },
    })
    if (claimed.count === 0) {
      const current = await tx.order.findUnique({
        where: { id: order.id },
        select: { status: true },
      })
      if (current?.status === 'paid') {
        return { ok: true as const, status: 'paid' as const, alreadyPaid: true }
      }
      throw new Error(`Order ${orderNo} cannot be paid from status ${current?.status ?? 'missing'}.`)
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'captured',
        razorpayPaymentId,
        signatureVerified,
        ...(method ? { method } : {}),
      },
    })

    // ── LOYALTY (granted on capture, exactly once) ─────────────────────────────
    // Now that the order is paid, award Bloom points: a rate on the order total
    // plus a one-time welcome bonus on the user's FIRST paid order. The already-
    // paid short-circuit above guarantees this runs at most once per order.
    if (order.userId) {
      const basePoints = Math.round(order.total * pointsPerRupee)
      // First paid order = the user has no OTHER paid order (this one is being
      // flipped to paid right now, so exclude it from the count). The count has
      // to span the whole paid-onward range, not just 'paid': status is a single
      // linear pipeline, so a previous order that has since shipped no longer
      // reads as 'paid' and used to vanish from this check — handing the
      // one-time welcome bonus to repeat customers again on every order.
      const priorPaidCount = await tx.order.count({
        where: {
          userId: order.userId,
          status: { in: PAID_ORDER_STATUSES },
          id: { not: order.id },
        },
      })
      const isFirstPaidOrder = priorPaidCount === 0
      const pointsDelta = basePoints + (isFirstPaidOrder ? firstOrderBonusPoints : 0)
      if (pointsDelta > 0) {
        const prior = await tx.pointsLedger.aggregate({
          where: { userId: order.userId },
          _sum: { delta: true },
        })
        const balanceAfter = (prior._sum.delta ?? 0) + pointsDelta
        await tx.pointsLedger.create({
          data: {
            userId: order.userId,
            delta: pointsDelta,
            reason: isFirstPaidOrder ? `Order ${orderNo} + welcome bonus` : `Order ${orderNo}`,
            orderId: order.id,
            balanceAfter,
          },
        })
      }
    }

    // Thara: activate membership and lock incoming referral for qualifying orders.
    await activateAndLockIfEligible(tx, order.id)

    // Thara: 10% commission to the referrer's Femi9 credit ledger, if this
    // paid order is a locked downline purchase of an active member.
    await accrueTharaCommission(tx, order.id)

    // Thara: 1% reward points to the referrer's current-cycle ledger. Same
    // eligibility as commission; empties into an Amazon voucher at cycle close.
    await accrueTharaPoints(brand, tx, order.id)

    // The creator's commission, booked HERE and not at placement — the order is
    // paid, so the payable is real. Idempotent, and a no-op for an order with
    // no referring affiliate.
    await bookOrderCommission(brand, tx, order.id)

    return { ok: true as const, status: 'paid' as const, alreadyPaid: false }
  })

  // Outside the transaction: a provider round-trip has no business holding a
  // payment-capture lock open, and both senders are idempotent on their own
  // dedupeKey so the webhook/verify/cron race cannot triple-send.
  //
  // WhatsApp is not a duplicate of the email — it is the only confirmation a
  // phone-only account ever gets, because `order.user.email` is null for every
  // OTP signup and sendOrderStatusEmail returns without sending.
  if (!result.alreadyPaid) {
    await sendOrderStatusEmail(brand, orderNo, 'paid')
    await sendOrderStatusWhatsapp(brand, orderNo, 'paid')
  }
  return result
}

/**
 * Reconcile old pending orders with Razorpay. Captured payments are fulfilled;
 * orders with no capture after the expiry window are cancelled and release the
 * stock/coupon reservation exactly once.
 *
 * ── What "pending" does NOT mean here ───────────────────────────────────────
 * This sweep exists for ONE shape: a shopper who reached the gateway and never
 * came back. Its whole premise is that the order has a payment intent to ask
 * Razorpay about. It used to select on `status: 'pending'` alone, and a second
 * kind of pending order exists that it therefore destroyed:
 * `generateDueOrders()` writes a subscription renewal as `status: 'pending'`
 * with NO Payment row at all — a pay-later box, not an abandoned checkout.
 *
 * With no intent there is nothing to ask the gateway, so `capture` stayed
 * undefined and every renewal fell straight through to the cancel branch below.
 * Lumi9 runs both jobs — `lumi9-renew-subscriptions` nightly and
 * `lumi9-reconcile` hourly — so each box was created and then cancelled within
 * the hour, its stock returned, for the whole life of the subscription. Nothing
 * reported it: the cancellation is a normal outcome for this sweep, and
 * `runRenewalTxn` has already advanced `nextDeliveryAt` and incremented
 * `savedTotal` by then, so the account page keeps showing an active plan with a
 * next delivery date and a growing saving against zero boxes ever shipped.
 *
 * `placeOrder` always writes its intent before it commits (and compensates the
 * reservation if the gateway write fails), so an order with no intent is never
 * an abandoned checkout. Skipping it is safe, and it is counted rather than
 * silently passed over so the count going up is visible to ops.
 */
export async function reconcilePendingOrders(
  brand: Brand,
  olderThanMinutes = 60,
): Promise<{ paid: number; cancelled: number; skippedPayLater: number }> {
  const prisma = dbFor(brand)
  const cutoff = new Date(Date.now() - Math.max(15, olderThanMinutes) * 60_000)
  const orders = await prisma.order.findMany({
    where: { status: 'pending', placedAt: { lt: cutoff } },
    include: {
      items: { select: { variantId: true, qty: true } },
      payments: { where: { status: 'created' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    take: 100,
  })
  let paid = 0
  let cancelled = 0
  let skippedPayLater = 0

  for (const order of orders) {
    const intent = order.payments[0]

    // No intent ⇒ nothing was ever opened at the gateway ⇒ this is not an
    // abandoned checkout. See the header: cancelling these silently deleted
    // every subscription renewal Lumi9 has ever generated.
    if (!intent) {
      skippedPayLater += 1
      continue
    }
    let capture: Awaited<ReturnType<typeof razorpay.listOrderPayments>>[number] | undefined
    if (intent.razorpayOrderId && !intent.razorpayOrderId.startsWith('mock_')) {
      const payments = await razorpay.listOrderPayments(brand, intent.razorpayOrderId)
      capture = payments.find((p) => p.status === 'captured' && p.amount === order.total * 100)
    }
    if (capture && intent.razorpayOrderId) {
      await markOrderPaid(brand, {
        orderNo: order.orderNo,
        razorpayPaymentId: capture.id,
        razorpayOrderId: intent.razorpayOrderId,
        signatureVerified: true,
        method: capture.method,
      })
      paid += 1
      continue
    }

    const released = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({ where: { id: order.id, status: 'pending' }, data: { status: 'cancelled' } })
      if (claim.count !== 1) return false
      for (const item of order.items) {
        await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.qty } } })
      }
      await tx.payment.updateMany({ where: { orderId: order.id, status: 'created' }, data: { status: 'failed' } })
      if (order.couponId) {
        await tx.coupon.updateMany({ where: { id: order.couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } })
      }
      return true
    })
    if (released) cancelled += 1
  }
  return { paid, cancelled, skippedPayLater }
}

/**
 * Resolve our public orderNo from a Razorpay order id, via the Payment row
 * stamped at checkout. The webhook only carries gateway ids, so this is how it
 * finds which of our orders to mark paid. Returns null when nothing references it.
 */
export async function orderNoForRazorpayOrderId(brand: Brand, razorpayOrderId: string): Promise<string | null> {
  const prisma = dbFor(brand)
  const payment = await prisma.payment.findFirst({
    where: { razorpayOrderId },
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { orderNo: true } } },
  })
  return payment?.order.orderNo ?? null
}

/** One purchased line, shaped for the confirmation page. */
export interface ConfirmationLine {
  /** The variant bought. Carried so a storefront can join the line back to its
   *  catalogue entry — for the pack photo, which is not snapshotted on the
   *  order the way the name and price are. */
  variantId: string
  productName: string
  variantLabel: string
  unitPrice: number
  qty: number
  lineTotal: number
}

/** Order confirmation read model — order + items + address + customer name. */
export interface OrderConfirmation {
  orderNo: string
  status: OrderStatus
  placedAt: Date
  subtotal: number
  shipping: number
  total: number
  customerName: string
  items: ConfirmationLine[]
  address: {
    name: string
    line: string
    city: string
    state: string | null
    pincode: string | null
    phone: string | null
  } | null
}

/** Load an order by its public order number for the confirmation page, or null. */
export async function getOrderByNo(brand: Brand, orderNo: string): Promise<OrderConfirmation | null> {
  const prisma = dbFor(brand)
  const order = await prisma.order.findUnique({
    where: { orderNo },
    include: {
      user: { select: { name: true } },
      address: true,
      items: { orderBy: { id: 'asc' } },
    },
  })
  if (!order) return null

  return {
    orderNo: order.orderNo,
    status: order.status,
    placedAt: order.placedAt,
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    customerName: order.user?.name ?? order.address?.name ?? 'there',
    items: order.items.map((it) => ({
      variantId: it.variantId,
      productName: it.productName,
      variantLabel: it.variantLabel,
      unitPrice: it.unitPrice,
      qty: it.qty,
      lineTotal: it.lineTotal,
    })),
    address: order.address
      ? {
          name: order.address.name,
          line: order.address.line,
          city: order.address.city,
          state: order.address.state,
          pincode: order.address.pincode,
          phone: order.address.phone,
        }
      : null,
  }
}
